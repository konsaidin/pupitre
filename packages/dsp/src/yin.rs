// YIN (de Cheveigné & Kawahara, 2002) с CMNDF и параболической интерполяцией.
// Порт JS-детектора из pitchProcessorSource.ts + детекция субгармоник.
//
// Окно 1024, maxTau 768 (нижняя граница ~62 Гц при 48 кГц).

pub const WIN: usize = 1024;
pub const MAX_TAU: usize = 768;
/// Сколько сэмплов нужно детектору на один анализ.
pub const BUF_SIZE: usize = WIN + MAX_TAU;

const THRESHOLD: f32 = 0.15;
/// Жёсткий пол RMS ниже минимального гейта UI.
const RMS_FLOOR: f32 = 0.002;

pub struct RawPitch {
    pub freq: f32,
    /// периодичность полного периода (1 - cmndf): честный признак «голос есть»
    /// даже при расщеплении, когда мелодический полупериод зашумлён
    pub clarity: f32,
    pub rms: f32,
    /// сила субгармоники (расщепление): насколько полный период глубже
    /// мелодического полупериода в CMNDF; 0 для чистого тона
    pub subh: f32,
}

pub struct Yin {
    sample_rate: f32,
    tau_min: usize,
    diff: Vec<f32>,
    cmndf: Vec<f32>,
}

impl Yin {
    pub fn new(sample_rate: f32) -> Self {
        // короче периода ~1100 Гц голос не поём: поиск ниже tauMin ловит
        // только обертоны и даёт октавные срывы вверх
        let tau_min = ((sample_rate / 1100.0).round() as usize).max(4);
        Self {
            sample_rate,
            tau_min,
            diff: vec![0.0; MAX_TAU + 1],
            cmndf: vec![0.0; MAX_TAU + 1],
        }
    }

    /// buf.len() == BUF_SIZE
    pub fn analyze(&mut self, buf: &[f32]) -> RawPitch {
        debug_assert_eq!(buf.len(), BUF_SIZE);
        let mut rms = 0.0f32;
        for &s in &buf[..WIN] {
            rms += s * s;
        }
        rms = (rms / WIN as f32).sqrt();
        if rms < RMS_FLOOR {
            return RawPitch { freq: 0.0, clarity: 0.0, rms, subh: 0.0 };
        }

        self.diff[0] = 0.0;
        for tau in 1..=MAX_TAU {
            let mut sum = 0.0f32;
            for i in 0..WIN {
                let d = buf[i] - buf[i + tau];
                sum += d * d;
            }
            self.diff[tau] = sum;
        }
        self.cmndf[0] = 1.0;
        let mut running = 0.0f32;
        for tau in 1..=MAX_TAU {
            running += self.diff[tau];
            self.cmndf[tau] = if running > 0.0 { self.diff[tau] * tau as f32 / running } else { 1.0 };
        }

        // первый локальный минимум ниже порога
        let mut tau_est = usize::MAX;
        let mut tau = self.tau_min;
        while tau < MAX_TAU {
            if self.cmndf[tau] < THRESHOLD {
                while tau + 1 < MAX_TAU && self.cmndf[tau + 1] < self.cmndf[tau] {
                    tau += 1;
                }
                tau_est = tau;
                break;
            }
            tau += 1;
        }
        if tau_est == usize::MAX {
            // fallback: глобальный минимум, если он достаточно выражен
            let mut best = self.tau_min;
            for t in self.tau_min + 1..MAX_TAU {
                if self.cmndf[t] < self.cmndf[best] {
                    best = t;
                }
            }
            if self.cmndf[best] < 0.35 {
                tau_est = best;
            } else {
                return RawPitch { freq: 0.0, clarity: 0.0, rms, subh: 0.0 };
            }
        }

        // анти-октава вверх: если минимум у двойного периода заметно глубже,
        // мы поймали 2-ю гармонику — берём вдвое больший период
        let tau2 = tau_est * 2;
        if tau2 + 1 <= MAX_TAU {
            let mut t2 = tau2;
            while t2 + 1 < MAX_TAU && self.cmndf[t2 + 1] < self.cmndf[t2] {
                t2 += 1;
            }
            while t2 > tau_est + 1 && self.cmndf[t2 - 1] < self.cmndf[t2] {
                t2 -= 1;
            }
            if self.cmndf[t2] < self.cmndf[tau_est] - 0.07 {
                tau_est = t2;
            }
        }

        // Субгармоники (расщепление): период удвоился — CMNDF у полного периода
        // очень глубокий, а у половинного (мелодическая высота) лишь умеренный.
        // Чистый тон так не выглядит: там оба минимума либо глубокие (октавная
        // неоднозначность), либо половинного минимума нет вовсе.
        let mut subh = 0.0f32;
        let mut tau_mel = tau_est;
        let half = tau_est / 2;
        if half >= self.tau_min && half > 2 {
            let r = (half / 64).max(3);
            let lo = half.saturating_sub(r).max(self.tau_min);
            let hi = (half + r).min(MAX_TAU - 1);
            let mut th = lo;
            for t in lo..=hi {
                if self.cmndf[t] < self.cmndf[th] {
                    th = t;
                }
            }
            let c_half = self.cmndf[th];
            let c_full = self.cmndf[tau_est];
            if c_half > 0.12 && c_half < 0.55 && c_half > c_full + 0.08 {
                subh = c_half - c_full;
                tau_mel = th;
            }
        }

        // параболическая интерполяция вокруг мелодического минимума
        let mut tau_f = tau_mel as f32;
        if tau_mel > 1 && tau_mel < MAX_TAU {
            let a = self.cmndf[tau_mel - 1];
            let b = self.cmndf[tau_mel];
            let c = self.cmndf[tau_mel + 1];
            let denom = a - 2.0 * b + c;
            if denom.abs() > 1e-12 {
                tau_f += 0.5 * (a - c) / denom;
            }
        }
        RawPitch {
            freq: self.sample_rate / tau_f,
            clarity: 1.0 - self.cmndf[tau_est],
            rms,
            subh,
        }
    }
}
