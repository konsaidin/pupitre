// Анализ входа движка (01-architecture §8.3, этап 43 — первая версия): сухой сигнал из аудиопотока (rtrb) → атаки и
// высота в потоке управления (не в реальном времени). Атака — по блокам 64 сэмпла: пик блока в 1.5 раза выше огибающей
// предыдущих 21 мс (скользящий максимум — длиннее периода самой низкой ноты гитары, на длинной ноте огибающая ровная) или
// всплеск производной (щелчок медиатора — широкополосный: так ловится повторный щипок той же громкости) вдвое выше её
// огибающей; громче порога, не чаще раза в 60 мс. Пороги — по замеру на переборе, где новая нота звучит поверх прошлой
// (рост на началах нот ×1.1–2.2); то, что не поймано, судья берёт по смене высоты. Высота — вокальное ядро packages/dsp (YIN с октавной коррекцией, шаг
// 256 сэмплов): у гитары — сырой midi (без сглаживания ленты), время кадра — середина окна. Время сэмпла — по меткам
// цикла JACK (время начала цикла и номер его первого кадра) минус задержка захвата.
use pupitre_dsp::Analyzer;

/// Блок огибающей атак, сэмплы.
const ONSET_BLOCK: usize = 64;
/// Огибающая — максимум пиков за столько блоков (≈ 21 мс при 48 кГц: дольше периода 47 Гц).
const ONSET_SPAN: usize = 16;
/// Рост пика над огибающей — атака (×1.5 ≈ 3.5 дБ); у производной — ×2.
const ONSET_RISE: f32 = 2.5;
const ONSET_RISE_HF: f32 = 4.0;
/// Пауза после атаки, с.
const ONSET_REFRACTORY_S: f64 = 0.06;
/// Пороги громкости атаки: сигнал −50 dBFS, производная — −56.
const ONSET_GATE: f32 = 0.0032;
const ONSET_GATE_HF: f32 = 0.0016;
/// Окно YIN вокального ядра: середина — на столько сэмплов раньше конца окна.
const YIN_HALF_WINDOW: f64 = 896.0;

/// Кадр анализа наружу: время — микросекунды часов JACK (CLOCK_MONOTONIC у pipewire-jack).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameOut {
    pub at_us: f64,
    /// MIDI-высота при A4 = 440 Гц, NaN — высоты нет.
    pub midi: f32,
    pub clarity: f32,
    pub level_db: f32,
    pub onset: bool,
}

/// Метка цикла: номер первого кадра цикла в потоке движка и время начала цикла, мкс.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Stamp {
    pub frame: u64,
    pub usecs: u64,
}

/// Детектор атак (тот же алгоритм — в ворклете браузерного пути, audio/instrument/onsetProcessorSource.ts).
pub struct Onsets {
    peaks: [f32; ONSET_SPAN],
    peaks_hf: [f32; ONSET_SPAN],
    pos: usize,
    block_peak: f32,
    block_peak_hf: f32,
    block_fill: usize,
    prev: f32,
    /// Номер первого сэмпла последней атаки.
    last_at: Option<u64>,
    refractory: u64,
}

impl Onsets {
    pub fn new(sample_rate: u32) -> Onsets {
        Onsets {
            peaks: [0.0; ONSET_SPAN],
            peaks_hf: [0.0; ONSET_SPAN],
            pos: 0,
            block_peak: 0.0,
            block_peak_hf: 0.0,
            block_fill: 0,
            prev: 0.0,
            last_at: None,
            refractory: (ONSET_REFRACTORY_S * f64::from(sample_rate)) as u64,
        }
    }

    /// Сэмпл с номером n; вернёт номер первого сэмпла блока с атакой и пик блока.
    pub fn push(&mut self, x: f32, n: u64) -> Option<(u64, f32)> {
        self.block_peak = self.block_peak.max(x.abs());
        self.block_peak_hf = self.block_peak_hf.max((x - self.prev).abs());
        self.prev = x;
        self.block_fill += 1;
        if self.block_fill < ONSET_BLOCK {
            return None;
        }
        let (peak, peak_hf) = (self.block_peak, self.block_peak_hf);
        let start = n + 1 - ONSET_BLOCK as u64;
        self.block_peak = 0.0;
        self.block_peak_hf = 0.0;
        self.block_fill = 0;
        let envelope = self.peaks.iter().copied().fold(0.0, f32::max);
        let envelope_hf = self.peaks_hf.iter().copied().fold(0.0, f32::max);
        self.peaks[self.pos] = peak;
        self.peaks_hf[self.pos] = peak_hf;
        self.pos = (self.pos + 1) % ONSET_SPAN;
        let rose = peak > ONSET_GATE && peak > envelope * ONSET_RISE;
        let clicked = peak_hf > ONSET_GATE_HF && peak_hf > envelope_hf * ONSET_RISE_HF;
        let rested = self.last_at.map_or(true, |last| start - last >= self.refractory);
        if (rose || clicked) && rested {
            self.last_at = Some(start);
            return Some((start, peak));
        }
        None
    }
}

fn db(v: f32) -> f32 {
    if v > 0.0 {
        20.0 * v.log10()
    } else {
        f32::NEG_INFINITY
    }
}

pub struct Analysis {
    analyzer: Analyzer,
    onsets: Onsets,
    rate: f64,
    /// Сэмплов разобрано — номер следующего сэмпла в потоке движка (с открытия).
    sample: u64,
    stamp: Stamp,
    /// Задержка захвата (вход устройства → движок), кадры.
    capture_latency: f64,
}

impl Analysis {
    pub fn new(sample_rate: u32) -> Analysis {
        let mut analyzer = Analyzer::new(sample_rate as f32);
        // гейт ядра: тише −50 dBFS или мутнее 0.5 — высоты нет
        analyzer.set_gate(0.003, 0.5);
        Analysis { analyzer, onsets: Onsets::new(sample_rate), rate: f64::from(sample_rate), sample: 0, stamp: Stamp::default(), capture_latency: 0.0 }
    }

    pub fn set_capture_latency(&mut self, frames: u32) {
        self.capture_latency = f64::from(frames);
    }

    /// Новая метка цикла (последняя известная).
    pub fn stamp(&mut self, stamp: Stamp) {
        self.stamp = stamp;
    }

    /// Время захвата сэмпла с номером n, мкс часов JACK.
    fn usecs(&self, n: f64) -> f64 {
        self.stamp.usecs as f64 + (n - self.stamp.frame as f64 - self.capture_latency) * 1e6 / self.rate
    }

    /// Порция сухого сигнала → кадры (атаки и высота) в out.
    pub fn process(&mut self, samples: &[f32], out: &mut Vec<FrameOut>) {
        let base = self.sample;
        for (i, &x) in samples.iter().enumerate() {
            let n = base + i as u64;
            if let Some((start, peak)) = self.onsets.push(x, n) {
                out.push(FrameOut { at_us: self.usecs(start as f64), midi: f32::NAN, clarity: 0.0, level_db: db(peak), onset: true });
            }
        }
        let rate = self.rate;
        let capture_latency = self.capture_latency;
        let stamp = self.stamp;
        self.analyzer.process(samples, |frame| {
            // t ядра — секунды от старта по последнему сэмплу окна; середина окна — раньше на полокна
            let center = f64::from(frame.t) * rate - YIN_HALF_WINDOW;
            let at_us = stamp.usecs as f64 + (center - stamp.frame as f64 - capture_latency) * 1e6 / rate;
            out.push(FrameOut {
                at_us,
                midi: if frame.voiced && frame.midi_raw.is_finite() { frame.midi_raw } else { f32::NAN },
                clarity: frame.clarity,
                level_db: db(frame.rms),
                onset: false,
            });
        });
        self.sample += samples.len() as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Щипок струны (Karplus–Strong): частота f, громкость amp, длительность n сэмплов.
    fn pluck(f: f32, amp: f32, n: usize, seed: u32) -> Vec<f32> {
        let period = (48000.0 / f).round() as usize;
        let mut state = seed;
        let mut line: Vec<f32> = (0..period)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                ((state >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 2.0 * amp
            })
            .collect();
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let j = i % period;
            let next = line[(j + 1) % period];
            let y = line[j];
            out.push(y);
            line[j] = 0.996 * 0.5 * (y + next);
        }
        out
    }

    fn midi_of(f: f32) -> f32 {
        69.0 + 12.0 * (f / 440.0).log2()
    }

    /// Ноты (начало, с; частота) в одну дорожку с тишиной в начале.
    fn melody(notes: &[(f64, f32)], total_s: f64) -> Vec<f32> {
        let mut out = vec![0.0f32; (total_s * 48000.0) as usize];
        for (k, &(at, f)) in notes.iter().enumerate() {
            let start = (at * 48000.0) as usize;
            let tone = pluck(f, 0.3, out.len() - start, 7 + k as u32);
            // новая нота глушит прошлую (как на одной струне)
            for (i, v) in tone.into_iter().enumerate() {
                out[start + i] = v;
            }
        }
        out
    }

    fn analyze(signal: &[f32]) -> Vec<FrameOut> {
        let mut a = Analysis::new(48000);
        // метка: кадр 0 — в момент 1 с часов JACK; задержки захвата нет
        a.stamp(Stamp { frame: 0, usecs: 1_000_000 });
        let mut out = Vec::new();
        for chunk in signal.chunks(128) {
            a.process(chunk, &mut out);
        }
        out
    }

    #[test]
    fn onsets_of_plucks_within_3_ms() {
        let notes = [(0.5, 110.0), (1.0, 146.83), (1.25, 196.0), (1.5, 196.0), (2.0, 329.63)];
        let frames = analyze(&melody(&notes, 3.0));
        let onsets: Vec<f64> = frames.iter().filter(|f| f.onset).map(|f| (f.at_us - 1_000_000.0) / 1e6).collect();
        assert_eq!(onsets.len(), notes.len(), "атаки: {onsets:?}");
        for (got, (want, _)) in onsets.iter().zip(notes) {
            assert!((got - want).abs() < 0.003, "атака {got} вместо {want}");
        }
    }

    #[test]
    fn pitch_of_plucks_after_onset() {
        let notes = [(0.5, 82.41), (1.0, 110.0), (1.5, 196.0), (2.0, 392.0)];
        let frames = analyze(&melody(&notes, 2.6));
        for (k, &(at, f)) in notes.iter().enumerate() {
            let window: Vec<f32> = frames
                .iter()
                .filter(|fr| !fr.onset && fr.midi.is_finite())
                .filter(|fr| {
                    let t = (fr.at_us - 1_000_000.0) / 1e6;
                    t > at + 0.03 && t < at + 0.15
                })
                .map(|fr| fr.midi)
                .collect();
            assert!(window.len() >= 5, "нота {k}: мало кадров высоты ({})", window.len());
            let mut sorted = window.clone();
            sorted.sort_by(f32::total_cmp);
            let median = sorted[sorted.len() / 2];
            let want = midi_of(f);
            let fold = (median - want) - 12.0 * ((median - want) / 12.0).round();
            assert!(fold.abs() < 0.5, "нота {k}: медиана {median}, ожидалось {want} (до октавы)");
        }
    }

    #[test]
    fn capture_latency_shifts_time_back() {
        let signal = melody(&[(0.5, 110.0)], 1.0);
        let mut a = Analysis::new(48000);
        a.stamp(Stamp { frame: 0, usecs: 1_000_000 });
        a.set_capture_latency(480); // 10 мс
        let mut out = Vec::new();
        a.process(&signal, &mut out);
        let onset = out.iter().find(|f| f.onset).unwrap();
        assert!(((onset.at_us - 1_000_000.0) / 1e6 - 0.49).abs() < 0.003);
    }

    #[test]
    fn steady_hum_and_sustain_are_not_onsets() {
        // гул 50 Гц и длинная низкая нота: после включения (первые 50 мс) — ни одной атаки
        let hum: Vec<f32> = (0..96000).map(|i| 0.05 * (2.0 * std::f32::consts::PI * 50.0 * i as f32 / 48000.0).sin()).collect();
        let late = |frames: &[FrameOut]| frames.iter().filter(|f| f.onset && f.at_us - 1_000_000.0 > 50_000.0).count();
        assert_eq!(late(&analyze(&hum)), 0);
        let low_e = pluck(82.41, 0.5, 96000, 3);
        assert_eq!(late(&analyze(&low_e)), 0);
    }
}
