// Детекция вибрато по СЫРОМУ f0-контуру (сглаженный путь его давит).
//
// Скользящее окно ~1 с: убрать тренд вычитанием скользящего среднего,
// автокорреляция остатка в полосе 3.5–9 Гц → частота (параболическая
// интерполяция пика), глубина в центах (амплитуда синуса из дисперсии),
// регулярность (нормированный пик автокорреляции).

/// окно анализа, мс
const WINDOW_MS: f32 = 1024.0;
/// окно скользящего среднего для детренда, мс (ФВЧ с срезом ~1.8 Гц)
const DETREND_MS: f32 = 250.0;
/// полоса поиска частоты модуляции, Гц
const RATE_MIN_HZ: f32 = 3.5;
const RATE_MAX_HZ: f32 = 9.0;
/// критерии «вибрато есть»
const ACTIVE_RATE_MIN: f32 = 3.8;
const ACTIVE_RATE_MAX: f32 = 8.5;
const ACTIVE_DEPTH_CENTS: f32 = 18.0;
const ACTIVE_REGULARITY: f32 = 0.45;
/// доля озвученных кадров в окне, ниже которой анализ не имеет смысла
const MIN_VOICED_FRAC: f32 = 0.85;
/// гистерезис активности, кадры
const ON_STREAK: u32 = 8;
const OFF_STREAK: u32 = 15;

const MAX_WIN: usize = 256;

#[derive(Clone, Copy, Default)]
pub struct VibratoOut {
    pub active: bool,
    pub rate_hz: f32,
    pub depth_cents: f32,
    pub regularity: f32,
}

pub struct Vibrato {
    frame_rate: f32,
    win: usize,
    detrend: usize,
    lag_min: usize,
    lag_max: usize,
    /// контур в центах; в неозвученных кадрах — удержанное значение
    ring: [f32; MAX_WIN],
    voiced: [bool; MAX_WIN],
    pos: usize,
    filled: usize,
    last_cents: f32,
    on_streak: u32,
    off_streak: u32,
    active: bool,
    // скретч-буферы (без аллокаций на кадр)
    lin: [f32; MAX_WIN],
    det: [f32; MAX_WIN],
    prefix: [f32; MAX_WIN + 1],
}

impl Vibrato {
    pub fn new(frame_rate: f32) -> Self {
        let win = ((WINDOW_MS / 1000.0 * frame_rate) as usize).clamp(32, MAX_WIN);
        let detrend = ((DETREND_MS / 1000.0 * frame_rate) as usize).clamp(8, win / 2) | 1;
        Self {
            frame_rate,
            win,
            detrend,
            lag_min: (frame_rate / RATE_MAX_HZ).floor() as usize,
            lag_max: (frame_rate / RATE_MIN_HZ).ceil() as usize,
            ring: [0.0; MAX_WIN],
            voiced: [false; MAX_WIN],
            pos: 0,
            filled: 0,
            last_cents: 0.0,
            on_streak: 0,
            off_streak: 0,
            active: false,
            lin: [0.0; MAX_WIN],
            det: [0.0; MAX_WIN],
            prefix: [0.0; MAX_WIN + 1],
        }
    }

    pub fn process(&mut self, midi_raw: f32, is_voiced: bool) -> VibratoOut {
        let v = is_voiced && !midi_raw.is_nan();
        if v {
            self.last_cents = midi_raw * 100.0;
        }
        self.ring[self.pos] = self.last_cents;
        self.voiced[self.pos] = v;
        self.pos = (self.pos + 1) % self.win;
        if self.filled < self.win {
            self.filled += 1;
        }

        let inst = self.measure();
        let inst_active = v && match inst {
            Some(m) => {
                m.depth_cents >= ACTIVE_DEPTH_CENTS
                    && m.rate_hz >= ACTIVE_RATE_MIN
                    && m.rate_hz <= ACTIVE_RATE_MAX
                    && m.regularity >= ACTIVE_REGULARITY
            }
            None => false,
        };
        // гистерезис в кадрах: короткая случайная «волна» бейдж не зажигает
        if inst_active {
            self.on_streak += 1;
            self.off_streak = 0;
            if self.on_streak >= ON_STREAK {
                self.active = true;
            }
        } else {
            self.off_streak += 1;
            self.on_streak = 0;
            if self.off_streak >= OFF_STREAK {
                self.active = false;
            }
        }
        match inst {
            Some(m) if self.active => VibratoOut { active: true, ..m },
            Some(m) => VibratoOut { active: false, ..m },
            None => VibratoOut { active: self.active, ..Default::default() },
        }
    }

    fn measure(&mut self) -> Option<VibratoOut> {
        let n = self.win;
        if self.filled < n {
            return None;
        }
        let mut voiced_cnt = 0usize;
        for i in 0..n {
            // линеаризуем ring: lin[0] — самый старый кадр
            let idx = (self.pos + i) % n;
            self.lin[i] = self.ring[idx];
            if self.voiced[idx] {
                voiced_cnt += 1;
            }
        }
        if (voiced_cnt as f32) < MIN_VOICED_FRAC * n as f32 {
            return None;
        }

        // детренд: вычитаем скользящее среднее (префиксные суммы)
        self.prefix[0] = 0.0;
        for i in 0..n {
            self.prefix[i + 1] = self.prefix[i] + self.lin[i];
        }
        let half = self.detrend / 2;
        for i in 0..n {
            let lo = i.saturating_sub(half);
            let hi = (i + half + 1).min(n);
            let ma = (self.prefix[hi] - self.prefix[lo]) / (hi - lo) as f32;
            self.det[i] = self.lin[i] - ma;
        }

        let mut r0 = 0.0f32;
        for i in 0..n {
            r0 += self.det[i] * self.det[i];
        }
        if r0 < 1e-3 {
            return Some(VibratoOut::default());
        }

        // автокорреляция в полосе поиска
        let lag_max = self.lag_max.min(n - 1);
        let mut best_lag = self.lag_min;
        let mut best_r = f32::MIN;
        let mut rs = [0.0f32; MAX_WIN];
        for lag in self.lag_min..=lag_max {
            let mut r = 0.0f32;
            for i in lag..n {
                r += self.det[i] * self.det[i - lag];
            }
            rs[lag] = r / r0;
            if rs[lag] > best_r {
                best_r = rs[lag];
                best_lag = lag;
            }
        }

        // параболическое уточнение пика
        let mut lag_f = best_lag as f32;
        if best_lag > self.lag_min && best_lag < lag_max {
            let a = rs[best_lag - 1];
            let b = rs[best_lag];
            let c = rs[best_lag + 1];
            let denom = a - 2.0 * b + c;
            if denom.abs() > 1e-12 {
                lag_f += 0.5 * (a - c) / denom;
            }
        }

        let std = (r0 / n as f32).sqrt();
        Some(VibratoOut {
            active: false, // решается гистерезисом выше
            rate_hz: self.frame_rate / lag_f,
            depth_cents: std * core::f32::consts::SQRT_2, // амплитуда синуса из σ
            regularity: best_r.clamp(0.0, 1.0),
        })
    }
}
