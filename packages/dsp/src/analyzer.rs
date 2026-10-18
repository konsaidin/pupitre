// Оркестратор: сэмплы → кадры анализа каждые HOP сэмплов (~5.3 мс при 48 кГц).
//
// Инвариант курса 2: детекция техник (вибрато, расщепление) читает СЫРОЙ
// f0-контур; медиана+EMA — только для сглаженного центра ленты.

use crate::distortion::Distortion;
use crate::decimate::Decimator;
use crate::loudness::Loudness;
use crate::smooth::Smoother;
use crate::vibrato::Vibrato;
use crate::yin::{Yin, BUF_SIZE, WIN};

/// шаг анализа в сэмплах: 256 при 48 кГц ≈ 5.3 мс на кадр
pub const HOP: usize = 256;
/// число f32 в сериализованном кадре (см. AnalysisFrame::write)
pub const FRAME_FLOATS: usize = 15;

#[derive(Clone, Copy)]
pub struct AnalysisFrame {
    /// секунды от старта анализатора (время ПОСЛЕДНЕГО сэмпла окна)
    pub t: f32,
    pub f0: f32,
    /// сглаженный midi (центр ленты, скоринг); NaN если голоса нет
    pub midi: f32,
    /// сырой midi после октавной коррекции (волнистость ленты); NaN если голоса нет
    pub midi_raw: f32,
    pub clarity: f32,
    pub rms: f32,
    pub voiced: bool,
    pub loud_db: f32,
    pub vib_active: bool,
    pub vib_rate_hz: f32,
    pub vib_depth_cents: f32,
    pub vib_regularity: f32,
    pub dist_active: bool,
    pub dist_score: f32,
    pub breathiness: f32,
}

impl AnalysisFrame {
    /// Плоская укладка для передачи через границу WASM/JNI.
    /// Порядок обязан совпадать с декодером в WorkletAudioInput.ts.
    pub fn write(&self, out: &mut [f32]) {
        out[0] = self.t;
        out[1] = self.f0;
        out[2] = self.midi;
        out[3] = self.midi_raw;
        out[4] = self.clarity;
        out[5] = self.rms;
        out[6] = if self.voiced { 1.0 } else { 0.0 };
        out[7] = self.loud_db;
        out[8] = if self.vib_active { 1.0 } else { 0.0 };
        out[9] = self.vib_rate_hz;
        out[10] = self.vib_depth_cents;
        out[11] = self.vib_regularity;
        out[12] = if self.dist_active { 1.0 } else { 0.0 };
        out[13] = self.dist_score;
        out[14] = self.breathiness;
    }
}

pub struct Analyzer {
    sample_rate: f32,
    decimator: Decimator,
    input_rate: f32,
    yin: Yin,
    smoother: Smoother,
    vibrato: Vibrato,
    loudness: Loudness,
    distortion: Distortion,
    buf: [f32; BUF_SIZE],
    filled: usize,
    /// всего сэмплов принято — источник времени кадров
    total: u64,
    breath_ema: f32,
    breath_alpha: f32,
}

impl Analyzer {
    pub fn new(sample_rate: f32) -> Self {
        let input_rate = sample_rate;
        let decimator = Decimator::new(sample_rate);
        let sample_rate = sample_rate / decimator.factor as f32;
        let frame_rate = sample_rate / HOP as f32;
        let frame_ms = 1000.0 / frame_rate;
        Self {
            sample_rate,
            input_rate,
            decimator,
            yin: Yin::new(sample_rate),
            smoother: Smoother::new(frame_rate),
            vibrato: Vibrato::new(frame_rate),
            loudness: Loudness::new(frame_rate),
            distortion: Distortion::new(frame_rate),
            buf: [0.0; BUF_SIZE],
            filled: 0,
            total: 0,
            breath_ema: 0.0,
            breath_alpha: 1.0 - (-frame_ms / 120.0f32).exp(),
        }
    }

    pub fn set_gate(&mut self, gate_rms: f32, gate_clarity: f32) {
        self.smoother.set_gate(gate_rms, gate_clarity);
    }

    /// Оценка задержки сглаженного контура: окно YIN + медиана/EMA + ФНЧ.
    /// Захват, доставка и дополнительные 85 мс при смене октавы сюда не входят.
    pub fn latency_ms(&self) -> f32 {
        ((BUF_SIZE - WIN / 2) as f32 / self.sample_rate
            + self.smoother.latency_frames() * HOP as f32 / self.sample_rate
            + self.decimator.delay_samples() as f32 / self.input_rate) * 1000.0
    }

    /// Прогнать порцию сэмплов; на каждый готовый кадр зовётся emit.
    pub fn process<F: FnMut(AnalysisFrame)>(&mut self, samples: &[f32], mut emit: F) {
        if self.decimator.factor == 1 {
            self.process_analysis_samples(samples, &mut emit);
        } else {
            for &sample in samples {
                if let Some(value) = self.decimator.push(sample) {
                    self.process_analysis_samples(&[value], &mut emit);
                }
            }
        }
    }

    fn process_analysis_samples<F: FnMut(AnalysisFrame)>(&mut self, samples: &[f32], emit: &mut F) {
        let mut offset = 0usize;
        while offset < samples.len() {
            let take = (BUF_SIZE - self.filled).min(samples.len() - offset);
            self.buf[self.filled..self.filled + take]
                .copy_from_slice(&samples[offset..offset + take]);
            self.filled += take;
            self.total += take as u64;
            offset += take;
            if self.filled == BUF_SIZE {
                emit(self.analyze());
                self.buf.copy_within(HOP.., 0);
                self.filled -= HOP;
            }
        }
    }

    fn analyze(&mut self) -> AnalysisFrame {
        let raw = self.yin.analyze(&self.buf);
        let sm = self.smoother.process(raw.freq, raw.clarity, raw.rms);
        let vib = self.vibrato.process(sm.midi_raw, sm.voiced);
        let loud_db = self.loudness.process(raw.rms);
        let dist = self.distortion.process(raw.subh, sm.midi_raw, raw.rms, sm.voiced);
        // придыхание: доля непериодичности при уверенном голосе (грубый HNR-прокси)
        let breath_target = if sm.voiced { ((1.0 - raw.clarity - 0.05) / 0.5).clamp(0.0, 1.0) } else { 0.0 };
        self.breath_ema += self.breath_alpha * (breath_target - self.breath_ema);

        AnalysisFrame {
            t: self.total as f32 / self.sample_rate,
            f0: if sm.voiced { raw.freq } else { 0.0 },
            midi: sm.midi,
            midi_raw: sm.midi_raw,
            clarity: raw.clarity,
            rms: raw.rms,
            voiced: sm.voiced,
            loud_db,
            vib_active: vib.active,
            vib_rate_hz: vib.rate_hz,
            vib_depth_cents: vib.depth_cents,
            vib_regularity: vib.regularity,
            dist_active: dist.active,
            dist_score: dist.score,
            breathiness: self.breath_ema,
        }
    }
}
