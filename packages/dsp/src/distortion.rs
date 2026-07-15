// Расщепление (drive/growl/rattle) без ML — по трём признакам:
//   1) субгармоники из YIN (период удвоился, но мелодический тон различим);
//   2) джиттер: шероховатость f0 кадр-к-кадру. Берём ВТОРУЮ разность —
//      она давит гладкую модуляцию вибрато (5–6 Гц), но пропускает рваную;
//   3) шиммер: рваность амплитуды кадр-к-кадру.
// Score 0..1 с EMA и гистерезисом — флаг не мерцает на границе.

const SUBH_LO: f32 = 0.06;
const SUBH_HI: f32 = 0.30;
const JITTER_LO_CENTS: f32 = 4.0;
const JITTER_HI_CENTS: f32 = 22.0;
const SHIMMER_LO: f32 = 0.06;
const SHIMMER_HI: f32 = 0.30;
const EMA_MS: f32 = 90.0;
const ON_SCORE: f32 = 0.5;
const OFF_SCORE: f32 = 0.3;

#[derive(Clone, Copy, Default)]
pub struct DistortionOut {
    pub active: bool,
    pub score: f32,
}

pub struct Distortion {
    ema_alpha: f32,
    prev_midi: [f32; 2],
    prev_rms: f32,
    jit_ema: f32,
    shim_ema: f32,
    score: f32,
    active: bool,
}

impl Distortion {
    pub fn new(frame_rate: f32) -> Self {
        let frame_ms = 1000.0 / frame_rate;
        Self {
            ema_alpha: 1.0 - (-frame_ms / EMA_MS).exp(),
            prev_midi: [f32::NAN; 2],
            prev_rms: 0.0,
            jit_ema: 0.0,
            shim_ema: 0.0,
            score: 0.0,
            active: false,
        }
    }

    pub fn process(&mut self, subh: f32, midi_raw: f32, rms: f32, voiced: bool) -> DistortionOut {
        if voiced {
            // вторая разность f0 в центах: у синусоидального вибрато ≤ ~2 центов,
            // у рваного тона — на порядок больше
            let d2 = if self.prev_midi[0].is_nan() || self.prev_midi[1].is_nan() {
                0.0
            } else {
                ((midi_raw - 2.0 * self.prev_midi[0] + self.prev_midi[1]) * 100.0).abs()
            };
            self.jit_ema += self.ema_alpha * (d2 - self.jit_ema);
            let shim = if self.prev_rms > 0.0 {
                (rms - self.prev_rms).abs() / rms.max(self.prev_rms)
            } else {
                0.0
            };
            self.shim_ema += self.ema_alpha * (shim - self.shim_ema);

            let subh_score = ramp(subh, SUBH_LO, SUBH_HI);
            let jit_score = ramp(self.jit_ema, JITTER_LO_CENTS, JITTER_HI_CENTS);
            let shim_score = ramp(self.shim_ema, SHIMMER_LO, SHIMMER_HI);
            // субгармоники — главный признак; шероховатость подтверждает,
            // но одна лишь амплитудная рябь (тремоло) расщеплением не считается
            let inst = (subh_score + jit_score * (0.4 + 0.6 * shim_score)).min(1.0);
            self.score += self.ema_alpha * (inst - self.score);
            self.prev_midi = [midi_raw, self.prev_midi[0]];
        } else {
            self.score *= 0.9;
            self.jit_ema = 0.0;
            self.shim_ema = 0.0;
            self.prev_midi = [f32::NAN; 2];
        }
        self.prev_rms = rms;

        if self.score > ON_SCORE {
            self.active = true;
        } else if self.score < OFF_SCORE {
            self.active = false;
        }
        DistortionOut { active: self.active, score: self.score }
    }
}

fn ramp(x: f32, lo: f32, hi: f32) -> f32 {
    ((x - lo) / (hi - lo)).clamp(0.0, 1.0)
}
