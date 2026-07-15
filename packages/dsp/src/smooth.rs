// Гейт, подавление октавных срывов и сглаживание f0 — порт сглаживания
// из бывшего PitchTracker.onRaw (JS, курс 1).
//
// Отдаёт два пути: midi_raw (после октавной коррекции, БЕЗ сглаживания —
// для детекции техник: медиана+EMA давят вибрато) и midi (сглаженный центр
// для ленты/скоринга). Константы времени заданы в мс и пересчитываются в кадры
// от фактического hop.

/// окно медианы, мс (в JS было 5 кадров по ~10.7 мс)
const MEDIAN_MS: f32 = 53.0;
/// постоянная EMA: в JS alpha 0.45 на кадр 10.7 мс
const EMA_MS: f32 = 10.7;
const EMA_ALPHA_REF: f32 = 0.45;
/// октавный срыв: скачок ≥ ниже, который свёрткой на ±12 попадает близко к медиане
const OCTAVE_JUMP_SEMIS: f32 = 7.0;
const OCTAVE_NEAR_SEMIS: f32 = 3.0;
/// столько мс подряд «глюк» держится — считаем сменой октавы, а не срывом
const OCTAVE_ACCEPT_MS: f32 = 85.0;

const MAX_MEDIAN_WIN: usize = 15;

pub fn hz_to_midi(hz: f32) -> f32 {
    69.0 + 12.0 * (hz / 440.0).log2()
}

pub struct Smoothed {
    pub voiced: bool,
    /// midi после октавной коррекции, без сглаживания; NaN если голоса нет
    pub midi_raw: f32,
    /// сглаженный midi (медиана + EMA); NaN если голоса нет
    pub midi: f32,
}

pub struct Smoother {
    gate_rms: f32,
    clarity_enter: f32,
    clarity_hold: f32,
    was_voiced: bool,
    recent: [f32; MAX_MEDIAN_WIN],
    recent_len: usize,
    median_win: usize,
    ema_alpha: f32,
    accept_frames: u32,
    smoothed: f32,
    fold_streak: u32,
}

impl Smoother {
    pub fn new(frame_rate: f32) -> Self {
        let frame_ms = 1000.0 / frame_rate;
        // нечётное окно медианы, эквивалентное MEDIAN_MS
        let mut median_win = (MEDIAN_MS / frame_ms).round() as usize | 1;
        median_win = median_win.clamp(3, MAX_MEDIAN_WIN);
        // EMA с той же постоянной времени при другом шаге кадра
        let ema_alpha = 1.0 - (1.0 - EMA_ALPHA_REF).powf(frame_ms / EMA_MS);
        Self {
            gate_rms: 0.006,
            clarity_enter: 0.6,
            clarity_hold: 0.48,
            was_voiced: false,
            recent: [0.0; MAX_MEDIAN_WIN],
            recent_len: 0,
            median_win,
            ema_alpha,
            accept_frames: (OCTAVE_ACCEPT_MS / frame_ms).round() as u32,
            smoothed: f32::NAN,
            fold_streak: 0,
        }
    }

    /// Пороги гейта применяются на лету.
    pub fn set_gate(&mut self, gate_rms: f32, gate_clarity: f32) {
        self.gate_rms = gate_rms;
        self.clarity_enter = gate_clarity;
        self.clarity_hold = (gate_clarity - 0.12).max(0.3);
    }

    pub fn process(&mut self, freq: f32, clarity: f32, rms: f32) -> Smoothed {
        // гистерезис: войти в voiced сложнее, чем удержаться — кружок не мерцает
        let clarity_min = if self.was_voiced { self.clarity_hold } else { self.clarity_enter };
        let voiced = freq > 0.0 && clarity >= clarity_min && rms >= self.gate_rms;
        self.was_voiced = voiced;
        if !voiced {
            self.recent_len = 0;
            self.smoothed = f32::NAN;
            self.fold_streak = 0;
            return Smoothed { voiced: false, midi_raw: f32::NAN, midi: f32::NAN };
        }

        let mut m = hz_to_midi(freq);
        // подавление октавных срывов: скачок, который свёрткой на ±12 ложится
        // рядом с недавней медианой — глюк детектора. Если «глюк» держится
        // ~85 мс подряд — это настоящая смена октавы, принимаем её.
        if self.recent_len >= 3 {
            let med = self.median();
            let folded = m - 12.0 * ((m - med) / 12.0).round();
            if (m - med).abs() >= OCTAVE_JUMP_SEMIS && (folded - med).abs() <= OCTAVE_NEAR_SEMIS {
                self.fold_streak += 1;
                if self.fold_streak <= self.accept_frames {
                    m = folded;
                } else {
                    self.recent_len = 0;
                    self.smoothed = f32::NAN;
                    self.fold_streak = 0;
                }
            } else {
                self.fold_streak = 0;
            }
        }

        if self.recent_len == self.median_win {
            self.recent.copy_within(1..self.median_win, 0);
            self.recent_len -= 1;
        }
        self.recent[self.recent_len] = m;
        self.recent_len += 1;

        // медиана гасит одиночные выбросы, EMA — мелкую дрожь
        let med = self.median();
        self.smoothed = if self.smoothed.is_nan() {
            med
        } else {
            self.smoothed + self.ema_alpha * (med - self.smoothed)
        };
        Smoothed { voiced: true, midi_raw: m, midi: self.smoothed }
    }

    fn median(&self) -> f32 {
        let mut sorted = [0.0f32; MAX_MEDIAN_WIN];
        sorted[..self.recent_len].copy_from_slice(&self.recent[..self.recent_len]);
        sorted[..self.recent_len].sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());
        sorted[self.recent_len / 2]
    }
}
