// Гитарный процессор: моно-вход инструмента → педали перед усилителем → усилитель (пред-EQ, два каскада клиппинга с
// двукратным оверсемплингом, тонстек) → кабинет 4×12 → педали в петле эффектов → громкость. Педали — гейт, скример
// (овердрайв в духе TS808), фузз, буст, дилей, комната; их порядок и граница петли — параметры (PARAM_SLOT_*,
// PARAM_LOOP). Комплект (PARAM_RIG) — гитара или бас: у баса свои голоса усилителя на тех же каскадах, компрессор одной
// ручкой до них, Blend с чистым DI, тонстек с выбором частоты середины и Ultra Lo/Hi, кабинет 4×10 с рупором; ручки
// GAIN/BASS/MID/TREBLE/LEVEL/CAB — общие номера (UI хранит их для каждого комплекта и отдаёт активный). Одно ядро на JACK-движок (нативно, по сэмплу:
// tick) и AudioWorklet (wasm, блоком: process). Реальное время: все буферы выделяются в new(), tick не аллоцирует;
// гейны и подмешивания сглаживаются, коэффициенты фильтров пересчитываются в set() (несколько cos/sin — дёшево).
// Номера параметров (PARAM_*) — контракт с apps/web/src/audio/guitar/tone.ts: меняются только синхронно.

use core::f32::consts::PI;

pub const PARAM_BYPASS: u32 = 0;
/// 0 — чистый, 1 — кранч, 2 — хай-гейн.
pub const PARAM_MODEL: u32 = 1;
/// Порог гейта, дБ полной шкалы; ниже −96 — гейт выключен.
pub const PARAM_GATE: u32 = 2;
/// Ручки 0…1 (тонстек: 0.5 — ровно).
pub const PARAM_GAIN: u32 = 3;
pub const PARAM_BASS: u32 = 4;
pub const PARAM_MID: u32 = 5;
pub const PARAM_TREBLE: u32 = 6;
pub const PARAM_PRESENCE: u32 = 7;
/// Громкость выхода, дБ.
pub const PARAM_LEVEL: u32 = 8;
/// Кабинет: 0/1 (без него — для своего импульса кабинета снаружи).
pub const PARAM_CAB: u32 = 9;
pub const PARAM_DELAY_MIX: u32 = 10;
/// Время дилея, мс (20…1500).
pub const PARAM_DELAY_MS: u32 = 11;
/// Обратная связь дилея 0…0.9.
pub const PARAM_DELAY_FEEDBACK: u32 = 12;
pub const PARAM_ROOM_MIX: u32 = 13;
/// Скример: 0/1, драйв, тон, уровень (ручки 0…1; уровень 0.5 — 0 дБ).
pub const PARAM_SCREAMER_ON: u32 = 14;
pub const PARAM_SCREAMER_DRIVE: u32 = 15;
pub const PARAM_SCREAMER_TONE: u32 = 16;
pub const PARAM_SCREAMER_LEVEL: u32 = 17;
/// Фузз: 0/1, фузз, тон (0 — низ, 1 — верх, посередине провал середины), уровень (0.5 — −15 дБ).
pub const PARAM_FUZZ_ON: u32 = 18;
pub const PARAM_FUZZ: u32 = 19;
pub const PARAM_FUZZ_TONE: u32 = 20;
pub const PARAM_FUZZ_LEVEL: u32 = 21;
/// Буст: 0/1 и четыре одинаковые ручки уровня (0.5 — 0 дБ, каждая ±7.5 дБ; складываются).
pub const PARAM_BOOST_ON: u32 = 22;
pub const PARAM_BOOST_LEVEL_0: u32 = 23;
const PARAM_BOOST_LEVEL_LAST: u32 = PARAM_BOOST_LEVEL_0 + 3;
/// Порядок педалей: слоты слева направо по сигналу — номер педали (PEDAL_*). Новый порядок применяется, когда слоты
/// снова составляют перестановку (смена приходит по одному слоту).
pub const PARAM_SLOT_0: u32 = 27;
const PARAM_SLOT_LAST: u32 = PARAM_SLOT_0 + PEDALS as u32 - 1;
/// Первый слот петли эффектов (0…PEDALS): слоты до него — перед усилителем, с него — после усилителя и кабинета.
pub const PARAM_LOOP: u32 = 33;
/// Комплект: 0 — гитара, 1 — бас. PARAM_MODEL у баса — номер басового голоса (BASS_VOICINGS).
pub const PARAM_RIG: u32 = 34;
/// Бас: частота середины — положение переключателя (MID_FREQS: 220 · 450 · 800 · 1 600 · 3 000 Гц).
pub const PARAM_MID_FREQ: u32 = 35;
/// Бас: Ultra Lo (подъём 40 Гц и вырез 500 Гц) и Ultra Hi (подъём 8 кГц) — 0/1.
pub const PARAM_ULTRA_LO: u32 = 36;
pub const PARAM_ULTRA_HI: u32 = 37;
/// Бас: доля усилителя против чистого DI (0 — только DI, 1 — только усилитель).
pub const PARAM_BLEND: u32 = 38;
/// Бас: компрессор одной ручкой (0 — выключен: порог и степень растут вместе).
pub const PARAM_COMP: u32 = 39;
/// Бас: рупор кабинета 4×10 (0/1).
pub const PARAM_HORN: u32 = 40;
pub const PARAM_COUNT: u32 = 41;

pub const RIG_GUITAR: u32 = 0;
pub const RIG_BASS: u32 = 1;

pub const PEDAL_GATE: u32 = 0;
pub const PEDAL_SCREAMER: u32 = 1;
pub const PEDAL_DELAY: u32 = 2;
pub const PEDAL_ROOM: u32 = 3;
pub const PEDAL_FUZZ: u32 = 4;
pub const PEDAL_BOOST: u32 = 5;
pub const PEDALS: usize = 6;

/// Обнуляет числа меньше ≈ 1e−25: в паузах (гейт закрыт) состояния фильтров иначе уходят в субнормальные числа.
const FLUSH: f32 = 1e-18;
#[inline]
fn flush(x: f32) -> f32 {
    x + FLUSH - FLUSH
}

/// Мягкое насыщение: рациональное приближение tanh (точное на ±3, дальше ±1).
#[inline]
fn soft(x: f32) -> f32 {
    if x <= -3.0 {
        -1.0
    } else if x >= 3.0 {
        1.0
    } else {
        x * (27.0 + x * x) / (27.0 + 9.0 * x * x)
    }
}

#[derive(Clone, Copy)]
enum Kind {
    LowPass,
    HighPass,
    Peaking,
    LowShelf,
    HighShelf,
}

/// Биквад RBJ (Audio EQ Cookbook), транспонированная прямая форма II.
#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn new(kind: Kind, f: f32, fs: f32, q: f32, db: f32) -> Self {
        let mut b = Biquad::default();
        b.design(kind, f, fs, q, db);
        b
    }

    /// Новые коэффициенты, состояние сохраняется (смена ручки без щелчка обнуления).
    fn design(&mut self, kind: Kind, f: f32, fs: f32, q: f32, db: f32) {
        let w = 2.0 * PI * f.min(fs * 0.49) / fs;
        let (sin, cos) = w.sin_cos();
        let alpha = sin / (2.0 * q);
        let a = 10f32.powf(db / 40.0);
        let (b0, b1, b2, a0, a1, a2) = match kind {
            Kind::LowPass => ((1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
            Kind::HighPass => ((1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
            Kind::Peaking => (1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a),
            Kind::LowShelf => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cos + s),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
                    a * ((a + 1.0) - (a - 1.0) * cos - s),
                    (a + 1.0) + (a - 1.0) * cos + s,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cos),
                    (a + 1.0) + (a - 1.0) * cos - s,
                )
            }
            Kind::HighShelf => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cos + s),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
                    a * ((a + 1.0) + (a - 1.0) * cos - s),
                    (a + 1.0) - (a - 1.0) * cos + s,
                    2.0 * ((a - 1.0) - (a + 1.0) * cos),
                    (a + 1.0) - (a - 1.0) * cos - s,
                )
            }
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    #[inline]
    fn tick(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = flush(self.b1 * x - self.a1 * y + self.z2);
        self.z2 = flush(self.b2 * x - self.a2 * y);
        y
    }
}

/// Одно сглаживание к цели (однополюсное, ≈ 10 мс): гейны и подмешивания без «молнии».
#[derive(Clone, Copy, Default)]
struct Smooth {
    value: f32,
    target: f32,
}

impl Smooth {
    #[inline]
    fn tick(&mut self, k: f32) -> f32 {
        self.value = flush(self.target + k * (self.value - self.target));
        self.value
    }

    /// Подмешивание педали (вкл/выкл): у цели — ровно в неё. Простое сглаживание с flush застревает у нуля (≈ 2.5e−23:
    /// шаг меньше половины кванта flush) — выключенная педаль после включения никогда не уходила в обход.
    #[inline]
    fn tick_snap(&mut self, k: f32) -> f32 {
        let v = self.tick(k);
        if (v - self.target).abs() < 1e-6 {
            self.value = self.target;
        }
        self.value
    }
}

struct Voicing {
    /// Срез низа до клиппинга, подъём середины [Гц, дБ], срез верха — как в offline-модели синт-минуса (guitar/backing/tone.ts).
    tight: f32,
    push: (f32, f32),
    fizz: f32,
    /// Усиление первого каскада при ручке 0 и 1, дБ; второго — множитель; смещения входа каскадов.
    gain_db: (f32, f32),
    stage2: (f32, f32),
    bias: (f32, f32),
    /// Базовый вырез середины тонстека, дБ.
    scoop: f32,
    /// Чистому — выход в долю от усиления (громкость не скачет от ручки), перегруженным — постоянный.
    makeup_by_gain: bool,
    makeup: f32,
}

const VOICINGS: [Voicing; 3] = [
    Voicing { tight: 40.0, push: (700.0, 0.0), fizz: 12000.0, gain_db: (0.0, 18.0), stage2: (1.0, 1.0), bias: (0.005, 0.0), scoop: 0.0, makeup_by_gain: true, makeup: 1.0 },
    Voicing { tight: 70.0, push: (700.0, 3.0), fizz: 8000.0, gain_db: (12.0, 30.0), stage2: (1.5, 3.0), bias: (0.02, 0.02), scoop: -2.0, makeup_by_gain: false, makeup: 0.35 },
    Voicing { tight: 110.0, push: (800.0, 6.0), fizz: 6500.0, gain_db: (24.0, 42.0), stage2: (4.0, 8.0), bias: (0.01, 0.005), scoop: -5.0, makeup_by_gain: false, makeup: 0.3 },
];

/// Басовый голос усилителя: те же каскады, что у гитары, своя настройка. Выход — makeup / g1^makeup_exp (1 — громкость
/// не зависит от ручки в линейной зоне, 0 — постоянная).
struct BassVoicing {
    tight: f32,
    push: (f32, f32),
    fizz: f32,
    gain_db: (f32, f32),
    stage2: (f32, f32),
    bias: (f32, f32),
    makeup: f32,
    makeup_exp: f32,
}

/// vintage — ламповый: тёплый, перегрузка с середины ручки; modern — чистый транзисторный, широкая полоса; grit —
/// перегруз верхней середины (низ держит Blend).
const BASS_VOICINGS: [BassVoicing; 3] = [
    BassVoicing { tight: 28.0, push: (500.0, 2.0), fizz: 7000.0, gain_db: (0.0, 26.0), stage2: (1.0, 2.0), bias: (0.04, 0.01), makeup: 1.0, makeup_exp: 0.6 },
    BassVoicing { tight: 32.0, push: (1200.0, 1.0), fizz: 12000.0, gain_db: (-6.0, 12.0), stage2: (1.0, 1.0), bias: (0.0, 0.0), makeup: 1.0, makeup_exp: 1.0 },
    BassVoicing { tight: 120.0, push: (900.0, 5.0), fizz: 5500.0, gain_db: (14.0, 36.0), stage2: (2.0, 5.0), bias: (0.01, 0.005), makeup: 0.35, makeup_exp: 0.0 },
];
/// Положения переключателя частоты середины баса, Гц.
pub const MID_FREQS: [f32; 5] = [220.0, 450.0, 800.0, 1600.0, 3000.0];

/// Комната: FDN из 8 линий с матрицей Адамара; длины — взаимно простые 23–65 мс на 44.1 кГц.
const FDN_LENGTHS: [usize; 8] = [1031, 1327, 1523, 1801, 2063, 2333, 2593, 2879];
const ROOM_RT60: f32 = 1.3;
const ROOM_DAMP: f32 = 0.3;
const DELAY_MAX_S: f32 = 1.5;
/// Смещение первого каскада фузза: несимметричный срез.
const FUZZ_BIAS: f32 = 0.35;
/// Предел буста (в долях полной шкалы), выше которого он мягко насыщается.
const BOOST_HEADROOM: f32 = 2.0;

pub struct Tone {
    fs: f32,
    params: [f32; PARAM_COUNT as usize],
    bypass: bool,
    model: usize,
    // гейт
    gate_open: f32,
    gate_close: f32,
    gate_on: bool,
    env: f32,
    gate_gain: f32,
    held: u32,
    hold: u32,
    k_env_atk: f32,
    k_env_rel: f32,
    k_gate_atk: f32,
    k_gate_rel: f32,
    // скример: срез низа до диодов (горб середины), тон, постоянная после клиппинга, плавное включение
    scr_hp: [Biquad; 2],
    scr_tone: Biquad,
    scr_dc: Biquad,
    scr_gain: Smooth,
    scr_level: Smooth,
    scr_mix: Smooth,
    // фузз: входной конденсатор, клиппинг на удвоенной частоте, тон-блок (смесь низа и верха), постоянная
    fz_hp: Biquad,
    fz_up: [Biquad; 2],
    fz_down: [Biquad; 2],
    fz_prev: f32,
    fz_lo: Biquad,
    fz_hi: Biquad,
    fz_dc: Biquad,
    fz_tone: f32,
    fz_gain: Smooth,
    fz_level: Smooth,
    fz_mix: Smooth,
    // буст
    bst_hp: Biquad,
    bst_gain: Smooth,
    bst_mix: Smooth,
    // порядок педалей и граница петли
    order: [u8; PEDALS],
    loop_at: usize,
    // усилитель
    pre: [Biquad; 3],
    up: [Biquad; 2],
    down: [Biquad; 2],
    g1: Smooth,
    g2: Smooth,
    b1: f32,
    b2: f32,
    prev: f32,
    dc_in: f32,
    dc_out: f32,
    dc_r: f32,
    stack: [Biquad; 4],
    cab: [Biquad; 5],
    cab_on: bool,
    makeup: Smooth,
    // бас: комплект, тонстек (бас, середина, верх, Ultra Lo — полка и вырез, Ultra Hi), кабинет 4×10, Blend, постоянная
    rig: u32,
    bass_stack: [Biquad; 6],
    ultra_lo: bool,
    ultra_hi: bool,
    bass_cab: [Biquad; 6],
    bass_dc: Biquad,
    blend: Smooth,
    // компрессор баса: огибающая, гейн, порог, наклон (1 − 1/степень), подъём; подмешивание — включение без щелчка
    comp_env: f32,
    comp_gain: f32,
    comp_thr: f32,
    comp_slope: f32,
    comp_makeup: f32,
    comp_mix: Smooth,
    k_comp_atk: f32,
    k_comp_rel: f32,
    k_comp_gain: f32,
    // дилей
    delay: Vec<f32>,
    delay_pos: usize,
    delay_len: f32,
    delay_target: f32,
    delay_lp: f32,
    delay_damp: f32,
    delay_mix: Smooth,
    // комната
    lines: [Vec<f32>; 8],
    line_pos: [usize; 8],
    line_gain: [f32; 8],
    line_lp: [f32; 8],
    room_mix: Smooth,
    room_hp: Biquad,
    // выход
    level: Smooth,
    k_smooth: f32,
}

impl Tone {
    pub fn new(sample_rate: f32) -> Self {
        let fs = if sample_rate.is_finite() && sample_rate > 8000.0 { sample_rate } else { 48000.0 };
        let k = |sec: f32| (-1.0 / (sec * fs)).exp();
        let lines: [Vec<f32>; 8] = core::array::from_fn(|i| vec![0.0; ((FDN_LENGTHS[i] as f32 * fs / 44100.0) as usize).max(1)]);
        let line_gain = core::array::from_fn(|i| 10f32.powf(-3.0 * lines[i].len() as f32 / (ROOM_RT60 * fs)));
        let fs2 = fs * 2.0;
        let butter = [0.5412, 1.3066];
        let mut tone = Tone {
            fs,
            params: [0.0; PARAM_COUNT as usize],
            bypass: false,
            model: 2,
            gate_open: 0.0,
            gate_close: 0.0,
            gate_on: false,
            env: 0.0,
            gate_gain: 1.0,
            held: 0,
            hold: (0.03 * fs) as u32,
            k_env_atk: k(0.0005),
            k_env_rel: k(0.03),
            k_gate_atk: k(0.001),
            k_gate_rel: k(0.05),
            scr_hp: [Biquad::new(Kind::HighPass, 720.0, fs, 0.6, 0.0), Biquad::new(Kind::HighPass, 60.0, fs, 0.707, 0.0)],
            scr_tone: Biquad::default(),
            scr_dc: Biquad::new(Kind::HighPass, 25.0, fs, 0.707, 0.0),
            scr_gain: Smooth::default(),
            scr_level: Smooth::default(),
            scr_mix: Smooth::default(),
            fz_hp: Biquad::new(Kind::HighPass, 90.0, fs, 0.707, 0.0),
            fz_up: butter.map(|q| Biquad::new(Kind::LowPass, 0.45 * fs, fs2, q, 0.0)),
            fz_down: butter.map(|q| Biquad::new(Kind::LowPass, 0.45 * fs, fs2, q, 0.0)),
            fz_prev: 0.0,
            fz_lo: Biquad::new(Kind::LowPass, 450.0, fs, 0.5, 0.0),
            fz_hi: Biquad::new(Kind::HighPass, 1100.0, fs, 0.5, 0.0),
            fz_dc: Biquad::new(Kind::HighPass, 25.0, fs, 0.707, 0.0),
            fz_tone: 0.5,
            fz_gain: Smooth::default(),
            fz_level: Smooth::default(),
            fz_mix: Smooth::default(),
            bst_hp: Biquad::new(Kind::HighPass, 40.0, fs, 0.707, 0.0),
            bst_gain: Smooth::default(),
            bst_mix: Smooth::default(),
            order: [0, 1, 2, 3, 4, 5],
            loop_at: 2,
            pre: [Biquad::default(); 3],
            up: butter.map(|q| Biquad::new(Kind::LowPass, 0.45 * fs, fs2, q, 0.0)),
            down: butter.map(|q| Biquad::new(Kind::LowPass, 0.45 * fs, fs2, q, 0.0)),
            g1: Smooth::default(),
            g2: Smooth::default(),
            b1: 0.0,
            b2: 0.0,
            prev: 0.0,
            dc_in: 0.0,
            dc_out: 0.0,
            dc_r: 1.0 - 2.0 * PI * 20.0 / fs2,
            stack: [Biquad::default(); 4],
            cab: [
                Biquad::new(Kind::HighPass, 75.0, fs, 0.707, 0.0),
                Biquad::new(Kind::Peaking, 110.0, fs, 1.0, 4.0),
                Biquad::new(Kind::Peaking, 2800.0, fs, 1.6, 4.0),
                Biquad::new(Kind::LowPass, 5200.0, fs, 0.8, 0.0),
                Biquad::new(Kind::LowPass, 6500.0, fs, 0.6, 0.0),
            ],
            cab_on: true,
            makeup: Smooth::default(),
            rig: RIG_GUITAR,
            bass_stack: [Biquad::default(); 6],
            ultra_lo: false,
            ultra_hi: false,
            bass_cab: [Biquad::default(); 6],
            bass_dc: Biquad::new(Kind::HighPass, 15.0, fs, 0.707, 0.0),
            blend: Smooth::default(),
            comp_env: 0.0,
            comp_gain: 1.0,
            comp_thr: 1.0,
            comp_slope: 0.0,
            comp_makeup: 1.0,
            comp_mix: Smooth::default(),
            k_comp_atk: k(0.005),
            k_comp_rel: k(0.12),
            k_comp_gain: k(0.002),
            delay: vec![0.0; (DELAY_MAX_S * fs) as usize + 4],
            delay_pos: 0,
            delay_len: 0.0,
            delay_target: 0.0,
            delay_lp: 0.0,
            delay_damp: (-2.0 * PI * 4000.0 / fs).exp(),
            delay_mix: Smooth::default(),
            lines,
            line_pos: [0; 8],
            line_gain,
            line_lp: [0.0; 8],
            room_mix: Smooth::default(),
            room_hp: Biquad::new(Kind::HighPass, 250.0, fs, 0.707, 0.0),
            level: Smooth::default(),
            k_smooth: k(0.01),
        };
        for (id, value) in DEFAULTS {
            tone.set(id, value);
        }
        // стартовые значения — сразу в цели, без разгона от нуля
        for s in [&mut tone.g1, &mut tone.g2, &mut tone.makeup, &mut tone.delay_mix, &mut tone.room_mix, &mut tone.level,
            &mut tone.scr_gain, &mut tone.scr_level, &mut tone.scr_mix, &mut tone.fz_gain, &mut tone.fz_level, &mut tone.fz_mix,
            &mut tone.bst_gain, &mut tone.bst_mix, &mut tone.blend, &mut tone.comp_mix] {
            s.value = s.target;
        }
        tone.delay_len = tone.delay_target;
        tone
    }

    pub fn param(&self, id: u32) -> f32 {
        self.params.get(id as usize).copied().unwrap_or(f32::NAN)
    }

    /// Параметр по номеру; вне диапазона — к краю, NaN и неизвестный номер — игнорируются.
    pub fn set(&mut self, id: u32, value: f32) {
        if !value.is_finite() || id >= PARAM_COUNT {
            return;
        }
        let value = match id {
            PARAM_BYPASS | PARAM_CAB | PARAM_SCREAMER_ON | PARAM_FUZZ_ON | PARAM_BOOST_ON | PARAM_ULTRA_LO | PARAM_ULTRA_HI | PARAM_HORN => {
                if value >= 0.5 { 1.0 } else { 0.0 }
            }
            PARAM_RIG => value.round().clamp(0.0, 1.0),
            PARAM_MID_FREQ => value.round().clamp(0.0, (MID_FREQS.len() - 1) as f32),
            PARAM_SLOT_0..=PARAM_SLOT_LAST => value.round().clamp(0.0, (PEDALS - 1) as f32),
            PARAM_LOOP => value.round().clamp(0.0, PEDALS as f32),
            PARAM_MODEL => value.round().clamp(0.0, (VOICINGS.len() - 1) as f32),
            PARAM_GATE => value.clamp(-120.0, 0.0),
            PARAM_LEVEL => value.clamp(-60.0, 12.0),
            PARAM_DELAY_MS => value.clamp(20.0, DELAY_MAX_S * 1000.0),
            PARAM_DELAY_FEEDBACK => value.clamp(0.0, 0.9),
            _ => value.clamp(0.0, 1.0),
        };
        self.params[id as usize] = value;
        match id {
            PARAM_BYPASS => self.bypass = value >= 0.5,
            PARAM_CAB => self.cab_on = value >= 0.5,
            PARAM_GATE => {
                self.gate_on = value > -96.0;
                self.gate_open = 10f32.powf(value / 20.0);
                self.gate_close = 10f32.powf((value - 8.0) / 20.0);
            }
            PARAM_LEVEL => self.level.target = 10f32.powf(value / 20.0),
            PARAM_DELAY_MIX => self.delay_mix.target = value,
            PARAM_DELAY_MS => self.delay_target = value / 1000.0 * self.fs,
            PARAM_ROOM_MIX => self.room_mix.target = value,
            PARAM_DELAY_FEEDBACK => {}
            PARAM_SCREAMER_ON => self.scr_mix.target = value,
            PARAM_SCREAMER_DRIVE => self.scr_gain.target = 10f32.powf((12.0 + 30.0 * value) / 20.0),
            PARAM_SCREAMER_TONE => self.scr_tone.design(Kind::LowPass, 650.0 + 5200.0 * value * value, self.fs, 0.6, 0.0),
            PARAM_SCREAMER_LEVEL => self.scr_level.target = 10f32.powf((value - 0.5) * 24.0 / 20.0),
            PARAM_FUZZ_ON => self.fz_mix.target = value,
            PARAM_FUZZ => self.fz_gain.target = 10f32.powf((20.0 + 40.0 * value) / 20.0),
            PARAM_FUZZ_TONE => self.fz_tone = value,
            PARAM_FUZZ_LEVEL => self.fz_level.target = 10f32.powf((value - 1.0) * 30.0 / 20.0),
            PARAM_BOOST_ON => self.bst_mix.target = value,
            PARAM_BOOST_LEVEL_0..=PARAM_BOOST_LEVEL_LAST => {
                let db: f32 = self.params[PARAM_BOOST_LEVEL_0 as usize..=PARAM_BOOST_LEVEL_LAST as usize].iter().map(|v| (v - 0.5) * 15.0).sum();
                self.bst_gain.target = 10f32.powf(db / 20.0);
            }
            PARAM_SLOT_0..=PARAM_SLOT_LAST => self.reorder(),
            PARAM_LOOP => self.loop_at = value as usize,
            PARAM_BLEND => self.blend.target = value,
            PARAM_COMP => {
                // порог −8…−38 дБ, степень 1.5…8, подъём — половина снятого на пороге
                let thr_db = -8.0 - 30.0 * value;
                let ratio = 1.5 + 6.5 * value;
                self.comp_thr = 10f32.powf(thr_db / 20.0);
                self.comp_slope = 1.0 - 1.0 / ratio;
                self.comp_makeup = 10f32.powf(-thr_db * self.comp_slope * 0.5 / 20.0);
                self.comp_mix.target = if value > 0.0 { 1.0 } else { 0.0 };
            }
            _ => self.voice(),
        }
    }

    /// Порядок педалей из слотов — если они снова составляют перестановку.
    fn reorder(&mut self) {
        let mut next = [0u8; PEDALS];
        let mut seen = [false; PEDALS];
        for (i, slot) in next.iter_mut().enumerate() {
            let pedal = self.params[PARAM_SLOT_0 as usize + i] as usize;
            if seen[pedal] {
                return;
            }
            seen[pedal] = true;
            *slot = pedal as u8;
        }
        self.order = next;
    }

    /// Пересчёт усилителя и тонстека по комплекту, модели и ручкам.
    fn voice(&mut self) {
        self.model = self.params[PARAM_MODEL as usize] as usize;
        self.rig = self.params[PARAM_RIG as usize] as u32;
        if self.rig == RIG_BASS {
            self.voice_bass();
            return;
        }
        let v = &VOICINGS[self.model];
        let fs = self.fs;
        let params = self.params;
        let p = |id: u32| params[id as usize];
        let gain = p(PARAM_GAIN);
        self.pre[0].design(Kind::HighPass, v.tight, fs, 0.707, 0.0);
        self.pre[1].design(Kind::Peaking, v.push.0, fs, 0.8, v.push.1);
        self.pre[2].design(Kind::LowPass, v.fizz, fs, 0.707, 0.0);
        let g1 = 10f32.powf((v.gain_db.0 + (v.gain_db.1 - v.gain_db.0) * gain) / 20.0);
        self.g1.target = g1;
        self.g2.target = v.stage2.0 + (v.stage2.1 - v.stage2.0) * gain;
        self.b1 = v.bias.0;
        self.b2 = v.bias.1;
        self.makeup.target = if v.makeup_by_gain { v.makeup / g1 } else { v.makeup };
        let knob = |id: u32, range: f32| (p(id) - 0.5) * 2.0 * range;
        self.stack[0].design(Kind::LowShelf, 120.0, fs, 0.707, knob(PARAM_BASS, 12.0));
        self.stack[1].design(Kind::Peaking, 700.0, fs, 0.7, v.scoop + knob(PARAM_MID, 12.0));
        self.stack[2].design(Kind::HighShelf, 3200.0, fs, 0.707, knob(PARAM_TREBLE, 12.0));
        self.stack[3].design(Kind::Peaking, 3500.0, fs, 0.8, knob(PARAM_PRESENCE, 8.0));
    }

    /// Басовый усилитель: голос, тонстек и кабинет 4×10 (с рупором — шире вверх, без — срез 4.2 кГц круче).
    fn voice_bass(&mut self) {
        let v = &BASS_VOICINGS[self.model];
        let fs = self.fs;
        let params = self.params;
        let p = |id: u32| params[id as usize];
        let gain = p(PARAM_GAIN);
        self.pre[0].design(Kind::HighPass, v.tight, fs, 0.707, 0.0);
        self.pre[1].design(Kind::Peaking, v.push.0, fs, 0.8, v.push.1);
        self.pre[2].design(Kind::LowPass, v.fizz, fs, 0.707, 0.0);
        let g1 = 10f32.powf((v.gain_db.0 + (v.gain_db.1 - v.gain_db.0) * gain) / 20.0);
        self.g1.target = g1;
        self.g2.target = v.stage2.0 + (v.stage2.1 - v.stage2.0) * gain;
        self.b1 = v.bias.0;
        self.b2 = v.bias.1;
        self.makeup.target = v.makeup / g1.powf(v.makeup_exp);
        let knob = |id: u32, range: f32| (p(id) - 0.5) * 2.0 * range;
        let mid = MID_FREQS[p(PARAM_MID_FREQ) as usize];
        self.ultra_lo = p(PARAM_ULTRA_LO) >= 0.5;
        self.ultra_hi = p(PARAM_ULTRA_HI) >= 0.5;
        self.bass_stack[0].design(Kind::LowShelf, 40.0, fs, 0.707, knob(PARAM_BASS, 15.0));
        self.bass_stack[1].design(Kind::Peaking, mid, fs, 0.9, knob(PARAM_MID, 12.0));
        self.bass_stack[2].design(Kind::HighShelf, 4500.0, fs, 0.707, knob(PARAM_TREBLE, 15.0));
        self.bass_stack[3].design(Kind::LowShelf, 40.0, fs, 0.707, 2.0);
        self.bass_stack[4].design(Kind::Peaking, 500.0, fs, 0.7, -10.0);
        self.bass_stack[5].design(Kind::HighShelf, 8000.0, fs, 0.707, 9.0);
        let horn = p(PARAM_HORN) >= 0.5;
        self.bass_cab[0].design(Kind::HighPass, 38.0, fs, 0.8, 0.0);
        self.bass_cab[1].design(Kind::Peaking, 90.0, fs, 1.1, 3.0);
        self.bass_cab[2].design(Kind::Peaking, 400.0, fs, 1.0, -2.5);
        self.bass_cab[3].design(Kind::Peaking, 2200.0, fs, 1.4, 2.0);
        if horn {
            // рупор: верх до 12 кГц, его зона чуть приглушена (аттенюатор рупора)
            self.bass_cab[4].design(Kind::LowPass, 12000.0, fs, 0.7, 0.0);
            self.bass_cab[5].design(Kind::Peaking, 6500.0, fs, 0.8, -3.0);
        } else {
            self.bass_cab[4].design(Kind::LowPass, 4200.0, fs, 0.75, 0.0);
            self.bass_cab[5].design(Kind::LowPass, 5500.0, fs, 0.6, 0.0);
        }
    }

    /// Компрессор баса: пиковая огибающая (атака 5 мс, спад 120 мс), гейн выше порога — (порог / огибающая)^наклон,
    /// сглаженный; включение и выключение — подмешиванием. Выключенный забывает огибающую: включение после громкого
    /// места не давит первую ноту.
    #[inline]
    fn comp(&mut self, x: f32) -> f32 {
        let mix = self.comp_mix.tick_snap(self.k_smooth);
        if mix <= 0.0 && self.comp_mix.target <= 0.0 {
            self.comp_env = 0.0;
            self.comp_gain = 1.0;
            return x;
        }
        let a = x.abs();
        let k = if a > self.comp_env { self.k_comp_atk } else { self.k_comp_rel };
        self.comp_env = flush(a + k * (self.comp_env - a));
        let target = if self.comp_env > self.comp_thr { (self.comp_slope * (self.comp_thr / self.comp_env).ln()).exp() } else { 1.0 };
        self.comp_gain = flush(target + self.k_comp_gain * (self.comp_gain - target));
        let y = x * self.comp_gain * self.comp_makeup;
        x + mix * (y - x)
    }

    /// Басовый усилитель: компрессор → (пред-EQ, каскады на удвоенной частоте) с Blend чистого DI → тонстек → кабинет.
    #[inline]
    fn bass_amp(&mut self, x: f32, k: f32) -> f32 {
        let clean = self.comp(x);
        let mut s = clean;
        for f in &mut self.pre {
            s = f.tick(s);
        }
        let (g1, g2) = (self.g1.tick(k), self.g2.tick(k));
        let mid = 0.5 * (self.prev + s);
        self.prev = s;
        self.stages(mid, g1, g2);
        let amp = self.stages(s, g1, g2) * self.makeup.tick(k);
        let blend = self.blend.tick(k);
        let mut y = self.bass_dc.tick(clean + blend * (amp - clean));
        for f in &mut self.bass_stack[..3] {
            y = f.tick(y);
        }
        if self.ultra_lo {
            y = self.bass_stack[3].tick(y);
            y = self.bass_stack[4].tick(y);
        }
        if self.ultra_hi {
            y = self.bass_stack[5].tick(y);
        }
        if self.cab_on {
            for f in &mut self.bass_cab {
                y = f.tick(y);
            }
        }
        y
    }

    /// Нелинейная часть на удвоенной частоте для одного сэмпла x2.
    #[inline]
    fn stages(&mut self, s: f32, g1: f32, g2: f32) -> f32 {
        let u = self.up[0].tick(s);
        let x = self.up[1].tick(u);
        let y = soft(g1 * (x + self.b1)) - soft(g1 * self.b1);
        // смещение первого каскада сдвигает постоянную — снимаем её перед вторым
        self.dc_out = flush(y - self.dc_in + self.dc_r * self.dc_out);
        self.dc_in = y;
        let z = soft(g2 * (self.dc_out + self.b2)) - soft(g2 * self.b2);
        let d = self.down[0].tick(z);
        self.down[1].tick(d)
    }

    /// Гейт по огибающей своего входа.
    #[inline]
    fn gate(&mut self, x: f32) -> f32 {
        if self.gate_on {
            let a = x.abs();
            self.env = if a > self.env { self.k_env_atk * (self.env - a) + a } else { self.k_env_rel * (self.env - a) + a };
            if self.env > self.gate_open {
                self.held = self.hold;
            } else if self.env < self.gate_close && self.held > 0 {
                self.held -= 1;
            }
            let target = if self.held > 0 { 1.0 } else { 0.0 };
            let kk = if target > self.gate_gain { self.k_gate_atk } else { self.k_gate_rel };
            self.gate_gain = flush(target + kk * (self.gate_gain - target));
        } else {
            self.gate_gain = 1.0;
        }
        x * self.gate_gain
    }

    /// Скример: чистый сигнал плюс перегруженная середина (низ срезан до диодов — «горб» середины, как у TS808), тон,
    /// уровень; включение и выключение — плавным подмешиванием.
    #[inline]
    fn screamer(&mut self, x: f32) -> f32 {
        let k = self.k_smooth;
        let mix = self.scr_mix.tick_snap(k);
        let (g, level) = (self.scr_gain.tick(k), self.scr_level.tick(k));
        if mix <= 0.0 && self.scr_mix.target <= 0.0 {
            return x;
        }
        let hp0 = self.scr_hp[0].tick(x);
        let mids = self.scr_hp[1].tick(hp0);
        let clipped = 0.3 * soft(g * mids / 0.3);
        let shaped = self.scr_tone.tick(x + clipped);
        let wet = self.scr_dc.tick(shaped) * level;
        x + mix * (wet - x)
    }

    /// Клиппинг фузза для одного сэмпла x2: смещённая пара транзисторов — несимметричный срез (чётные гармоники), затем
    /// второй каскад почти до меандра.
    #[inline]
    fn fuzz_stage(&mut self, s: f32, g: f32) -> f32 {
        let u = self.fz_up[0].tick(s);
        let x = self.fz_up[1].tick(u);
        let y = soft(g * x + FUZZ_BIAS) - soft(FUZZ_BIAS);
        let z = soft(3.0 * y);
        let d = self.fz_down[0].tick(z);
        self.fz_down[1].tick(d)
    }

    /// Фузз: срез низа на входе, клиппинг на удвоенной частоте, тон-блок — смесь низа и верха с провалом середины
    /// посередине хода, уровень; включение — плавным подмешиванием.
    #[inline]
    fn fuzz(&mut self, x: f32) -> f32 {
        let k = self.k_smooth;
        let mix = self.fz_mix.tick_snap(k);
        let (g, level) = (self.fz_gain.tick(k), self.fz_level.tick(k));
        if mix <= 0.0 && self.fz_mix.target <= 0.0 {
            return x;
        }
        let s = self.fz_hp.tick(x);
        let mid = 0.5 * (self.fz_prev + s);
        self.fz_prev = s;
        self.fuzz_stage(mid, g);
        let y = self.fuzz_stage(s, g);
        let (lo, hi) = (self.fz_lo.tick(y), self.fz_hi.tick(y));
        let wet = self.fz_dc.tick(lo + self.fz_tone * (hi - lo)) * level;
        x + mix * (wet - x)
    }

    /// Буст: чистое усиление с запасом девятивольтовой педали — выше него мягко упирается.
    #[inline]
    fn boost(&mut self, x: f32) -> f32 {
        let k = self.k_smooth;
        let mix = self.bst_mix.tick_snap(k);
        let g = self.bst_gain.tick(k);
        if mix <= 0.0 && self.bst_mix.target <= 0.0 {
            return x;
        }
        let wet = BOOST_HEADROOM * soft(g * self.bst_hp.tick(x) / BOOST_HEADROOM);
        x + mix * (wet - x)
    }

    #[inline]
    fn pedal(&mut self, id: u8, x: f32) -> f32 {
        match id as u32 {
            PEDAL_GATE => self.gate(x),
            PEDAL_SCREAMER => self.screamer(x),
            PEDAL_DELAY => self.echo(x),
            PEDAL_FUZZ => self.fuzz(x),
            PEDAL_BOOST => self.boost(x),
            _ => self.room(x),
        }
    }

    /// Один сэмпл (JACK-движок): педали перед усилителем → усилитель и кабинет → педали в петле → громкость.
    #[inline]
    pub fn tick(&mut self, input: f32) -> f32 {
        if self.bypass {
            return input;
        }
        let mut s = if input.is_finite() { input } else { 0.0 };
        let k = self.k_smooth;
        let order = self.order;
        for &id in &order[..self.loop_at] {
            s = self.pedal(id, s);
        }
        s = if self.rig == RIG_BASS { self.bass_amp(s, k) } else { self.amp(s, k) };
        for &id in &order[self.loop_at..] {
            s = self.pedal(id, s);
        }
        s * self.level.tick(k)
    }

    /// Усилитель: пред-EQ, каскады на удвоенной частоте, тонстек, кабинет.
    #[inline]
    fn amp(&mut self, x: f32, k: f32) -> f32 {
        let mut s = x;
        for f in &mut self.pre {
            s = f.tick(s);
        }
        let (g1, g2) = (self.g1.tick(k), self.g2.tick(k));
        // 2×: линейная интерполяция до середины и сам сэмпл; на выход — второй (прореживание)
        let mid = 0.5 * (self.prev + s);
        self.prev = s;
        self.stages(mid, g1, g2);
        let mut y = self.stages(s, g1, g2) * self.makeup.tick(k);
        for f in &mut self.stack {
            y = f.tick(y);
        }
        if self.cab_on {
            for f in &mut self.cab {
                y = f.tick(y);
            }
        }
        y
    }

    /// Дилей с плавной сменой времени (чтение с интерполяцией, длина ползёт к цели) и затухающим верхом в петле.
    #[inline]
    fn echo(&mut self, x: f32) -> f32 {
        let mix = self.delay_mix.tick(self.k_smooth);
        let n = self.delay.len();
        self.delay_len += (self.delay_target - self.delay_len) * 0.0005;
        let read = self.delay_pos as f32 + n as f32 - self.delay_len;
        let i = read as usize;
        let frac = read - i as f32;
        let (a, b) = (self.delay[i % n], self.delay[(i + 1) % n]);
        let tap = a + (b - a) * frac;
        self.delay_lp = flush(tap + self.delay_damp * (self.delay_lp - tap));
        let fb = self.params[PARAM_DELAY_FEEDBACK as usize];
        self.delay[self.delay_pos] = flush(x + self.delay_lp * fb);
        self.delay_pos = (self.delay_pos + 1) % n;
        x + mix * tap
    }

    /// Комната: FDN-8, посыл без низа; моно-выход — разность пар линий.
    #[inline]
    fn room(&mut self, x: f32) -> f32 {
        let mix = self.room_mix.tick(self.k_smooth);
        if mix <= 0.0 && self.room_mix.target <= 0.0 {
            return x;
        }
        let send = self.room_hp.tick(x);
        let mut o = [0f32; 8];
        for k in 0..8 {
            let v = self.lines[k][self.line_pos[k]];
            self.line_lp[k] = flush(v + ROOM_DAMP * (self.line_lp[k] - v));
            o[k] = self.line_lp[k];
        }
        let out = (o[0] - o[1] + o[2] - o[3] + o[4] - o[5] + o[6] - o[7]) * 0.353_553_4;
        let mut h = 1;
        while h < 8 {
            let mut a = 0;
            while a < 8 {
                for b in a..a + h {
                    let (u, w) = (o[b], o[b + h]);
                    o[b] = u + w;
                    o[b + h] = u - w;
                }
                a += h << 1;
            }
            h <<= 1;
        }
        for k in 0..8 {
            let len = self.lines[k].len();
            self.lines[k][self.line_pos[k]] = send + self.line_gain[k] * 0.353_553_4 * o[k];
            self.line_pos[k] = if self.line_pos[k] + 1 == len { 0 } else { self.line_pos[k] + 1 };
        }
        x + mix * out
    }

    /// Блок на месте (AudioWorklet).
    pub fn process(&mut self, buf: &mut [f32]) {
        for s in buf.iter_mut() {
            *s = self.tick(*s);
        }
    }
}

/// Звук по умолчанию: гитара, хай-гейн с кабинетом, гейт −60 дБ, скример, фузз и буст выключены, без дилея, лёгкая
/// комната; фузз, скример, буст и гейт — перед усилителем, дилей и комната — в петле. Бас (когда выбран): середина
/// 800 Гц, без Ultra, только усилитель (Blend 1), без компрессора, с рупором.
pub const DEFAULTS: [(u32, f32); PARAM_COUNT as usize] = [
    (PARAM_BYPASS, 0.0),
    (PARAM_MODEL, 2.0),
    (PARAM_GATE, -60.0),
    (PARAM_GAIN, 0.5),
    (PARAM_BASS, 0.5),
    (PARAM_MID, 0.5),
    (PARAM_TREBLE, 0.5),
    (PARAM_PRESENCE, 0.5),
    (PARAM_LEVEL, 0.0),
    (PARAM_CAB, 1.0),
    (PARAM_DELAY_MIX, 0.0),
    (PARAM_DELAY_MS, 350.0),
    (PARAM_DELAY_FEEDBACK, 0.3),
    (PARAM_ROOM_MIX, 0.15),
    (PARAM_SCREAMER_ON, 0.0),
    (PARAM_SCREAMER_DRIVE, 0.4),
    (PARAM_SCREAMER_TONE, 0.5),
    (PARAM_SCREAMER_LEVEL, 0.6),
    (PARAM_FUZZ_ON, 0.0),
    (PARAM_FUZZ, 0.6),
    (PARAM_FUZZ_TONE, 0.5),
    (PARAM_FUZZ_LEVEL, 0.5),
    (PARAM_BOOST_ON, 0.0),
    (PARAM_BOOST_LEVEL_0, 0.5),
    (PARAM_BOOST_LEVEL_0 + 1, 0.5),
    (PARAM_BOOST_LEVEL_0 + 2, 0.5),
    (PARAM_BOOST_LEVEL_0 + 3, 0.5),
    (PARAM_SLOT_0, PEDAL_FUZZ as f32),
    (PARAM_SLOT_0 + 1, PEDAL_SCREAMER as f32),
    (PARAM_SLOT_0 + 2, PEDAL_BOOST as f32),
    (PARAM_SLOT_0 + 3, PEDAL_GATE as f32),
    (PARAM_SLOT_0 + 4, PEDAL_DELAY as f32),
    (PARAM_SLOT_0 + 5, PEDAL_ROOM as f32),
    (PARAM_LOOP, 4.0),
    (PARAM_RIG, RIG_GUITAR as f32),
    (PARAM_MID_FREQ, 2.0),
    (PARAM_ULTRA_LO, 0.0),
    (PARAM_ULTRA_HI, 0.0),
    (PARAM_BLEND, 1.0),
    (PARAM_COMP, 0.0),
    (PARAM_HORN, 1.0),
];

#[cfg(test)]
mod tests {
    use super::*;

    const FS: f32 = 48000.0;
    fn sine(hz: f32, sec: f32, amp: f32) -> Vec<f32> {
        (0..(sec * FS) as usize).map(|i| amp * (2.0 * PI * hz * i as f32 / FS).sin()).collect()
    }
    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }
    /// Амплитуда на частоте hz (одна точка ДПФ).
    fn bin(x: &[f32], hz: f32) -> f32 {
        let (mut re, mut im) = (0f32, 0f32);
        for (i, v) in x.iter().enumerate() {
            let ph = 2.0 * PI * hz * i as f32 / FS;
            re += v * ph.cos();
            im += v * ph.sin();
        }
        re.hypot(im)
    }

    #[test]
    fn bypass_is_bit_exact() {
        let mut t = Tone::new(FS);
        t.set(PARAM_BYPASS, 1.0);
        let x = sine(220.0, 0.1, 0.3);
        let mut y = x.clone();
        t.process(&mut y);
        assert_eq!(x, y);
    }

    #[test]
    fn silence_stays_silent_and_finite() {
        let mut t = Tone::new(FS);
        let mut y = vec![0.0; 48000];
        t.process(&mut y);
        assert!(y.iter().all(|v| v.abs() < 1e-6));
        // мусор на входе (NaN, бесконечность) не отравляет состояние
        let mut z = vec![f32::NAN, f32::INFINITY, 0.1, -0.2];
        t.process(&mut z);
        assert!(z.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn high_gain_saturates_with_odd_and_even_harmonics() {
        let mut t = Tone::new(FS);
        t.set(PARAM_ROOM_MIX, 0.0);
        let mut y = sine(110.0, 1.0, 0.1);
        t.process(&mut y);
        let body = &y[12000..36000];
        let f0 = bin(body, 110.0);
        assert!(bin(body, 330.0) / f0 > 0.05, "нечётные гармоники");
        assert!(bin(body, 220.0) / f0 > 0.01, "чётные гармоники");
        assert!(body.iter().all(|v| v.abs() < 2.0));
    }

    #[test]
    fn clean_is_nearly_linear_at_low_gain() {
        let mut t = Tone::new(FS);
        for (id, v) in [(PARAM_MODEL, 0.0), (PARAM_GAIN, 0.0), (PARAM_ROOM_MIX, 0.0), (PARAM_CAB, 0.0), (PARAM_GATE, -120.0)] {
            t.set(id, v);
        }
        let mut y = sine(440.0, 0.5, 0.05);
        t.process(&mut y);
        let body = &y[6000..18000];
        assert!(bin(body, 1320.0) / bin(body, 440.0) < 0.01);
    }

    #[test]
    fn gate_closes_on_noise_between_notes() {
        let mut t = Tone::new(FS);
        t.set(PARAM_GATE, -50.0);
        t.set(PARAM_ROOM_MIX, 0.0);
        let mut x = sine(110.0, 0.5, 0.2);
        // шум на −80 дБ после ноты
        let mut seed = 1u32;
        x.extend((0..48000).map(|_| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed as f32 / u32::MAX as f32 - 0.5) * 2e-4
        }));
        t.process(&mut x);
        assert!(rms(&x[40000..]) < rms(&x[..24000]) * 1e-3);
    }

    #[test]
    fn chunked_equals_whole() {
        let x = sine(196.0, 0.3, 0.2);
        let (mut a, mut b) = (Tone::new(FS), Tone::new(FS));
        a.set(PARAM_DELAY_MIX, 0.4);
        b.set(PARAM_DELAY_MIX, 0.4);
        let mut whole = x.clone();
        a.process(&mut whole);
        let mut parts = x.clone();
        for chunk in parts.chunks_mut(128) {
            b.process(chunk);
        }
        assert_eq!(whole, parts);
    }

    #[test]
    fn delay_repeats_after_its_time() {
        let mut t = Tone::new(FS);
        for (id, v) in [(PARAM_MODEL, 0.0), (PARAM_GAIN, 0.0), (PARAM_ROOM_MIX, 0.0), (PARAM_CAB, 0.0), (PARAM_GATE, -120.0),
            (PARAM_DELAY_MIX, 1.0), (PARAM_DELAY_MS, 100.0), (PARAM_DELAY_FEEDBACK, 0.0)] {
            t.set(id, v);
        }
        let mut y = vec![0.0; 24000];
        y[0] = 0.5;
        t.process(&mut y);
        let echo = (4000..6000).map(|i| y[i].abs()).fold(0.0, f32::max);
        let before = (2000..4000).map(|i| y[i].abs()).fold(0.0, f32::max);
        assert!(echo > 10.0 * before, "эхо через 100 мс: {echo} против {before}");
    }

    #[test]
    fn params_clamp_and_ignore_garbage() {
        let mut t = Tone::new(FS);
        t.set(PARAM_GAIN, 7.0);
        assert_eq!(t.param(PARAM_GAIN), 1.0);
        t.set(PARAM_MODEL, 9.0);
        assert_eq!(t.param(PARAM_MODEL), 2.0);
        t.set(PARAM_DELAY_FEEDBACK, 5.0);
        assert_eq!(t.param(PARAM_DELAY_FEEDBACK), 0.9);
        t.set(PARAM_LEVEL, f32::NAN);
        assert_eq!(t.param(PARAM_LEVEL), 0.0);
        t.set(99, 1.0);
        assert!(t.param(99).is_nan());
    }

    #[test]
    fn pedal_order_applies_only_as_a_full_permutation() {
        let mut t = Tone::new(FS);
        assert_eq!(t.order, [4, 1, 5, 0, 2, 3]);
        assert_eq!(t.loop_at, 4);
        // меняем местами фузз и дилей: после первого слота — повтор, порядок прежний
        t.set(PARAM_SLOT_0, PEDAL_DELAY as f32);
        assert_eq!(t.order, [4, 1, 5, 0, 2, 3]);
        t.set(PARAM_SLOT_0 + 4, PEDAL_FUZZ as f32);
        assert_eq!(t.order, [2, 1, 5, 0, 4, 3]);
        t.set(PARAM_LOOP, 9.0);
        assert_eq!(t.param(PARAM_LOOP), PEDALS as f32);
    }

    #[test]
    fn delay_before_the_amp_sounds_different_from_the_loop() {
        let burst = |t: &mut Tone| {
            let mut y = sine(220.0, 0.05, 0.2);
            y.extend(std::iter::repeat(0.0).take(24000));
            t.process(&mut y);
            y
        };
        let setup = |t: &mut Tone| {
            for (id, v) in [(PARAM_ROOM_MIX, 0.0), (PARAM_GATE, -120.0), (PARAM_DELAY_MIX, 0.6), (PARAM_DELAY_MS, 150.0)] {
                t.set(id, v);
            }
        };
        let mut post = Tone::new(FS);
        setup(&mut post);
        let mut pre = Tone::new(FS);
        setup(&mut pre);
        pre.set(PARAM_LOOP, PEDALS as f32); // все педали перед усилителем: повторы идут в перегруз
        let (a, b) = (burst(&mut post), burst(&mut pre));
        assert!(a.iter().chain(&b).all(|v| v.is_finite()));
        let echo = |y: &[f32]| rms(&y[7000..9000]);
        assert!(echo(&a) > 1e-3 && echo(&b) > 1e-3);
        assert!((echo(&a) - echo(&b)).abs() > 0.1 * echo(&a), "повторы до перегруза и после звучат по-разному");
    }

    #[test]
    fn screamer_off_is_transparent_on_adds_a_mid_hump() {
        let clean = |on: bool, hz: f32| {
            let mut t = Tone::new(FS);
            for (id, v) in [(PARAM_MODEL, 0.0), (PARAM_GAIN, 0.0), (PARAM_CAB, 0.0), (PARAM_ROOM_MIX, 0.0), (PARAM_GATE, -120.0),
                (PARAM_SCREAMER_ON, if on { 1.0 } else { 0.0 }), (PARAM_SCREAMER_DRIVE, 0.0), (PARAM_SCREAMER_LEVEL, 0.5), (PARAM_SCREAMER_TONE, 1.0)] {
                t.set(id, v);
            }
            let mut y = sine(hz, 0.5, 0.005);
            t.process(&mut y);
            rms(&y[12000..])
        };
        // выключен — как без педали; включён — середина (800 Гц) поднята заметно сильнее низа (100 Гц)
        let (lo_off, mid_off) = (clean(false, 100.0), clean(false, 800.0));
        let (lo_on, mid_on) = (clean(true, 100.0), clean(true, 800.0));
        assert!((mid_on / mid_off) > 1.5 * (lo_on / lo_off), "горб середины: {} против {}", mid_on / mid_off, lo_on / lo_off);
    }

    /// Чистый усилитель без кабинета и комнаты — чтобы слышать саму педаль.
    fn clean_rig(extra: &[(u32, f32)]) -> Tone {
        let mut t = Tone::new(FS);
        for &(id, v) in [(PARAM_MODEL, 0.0), (PARAM_GAIN, 0.0), (PARAM_CAB, 0.0), (PARAM_ROOM_MIX, 0.0), (PARAM_GATE, -120.0)].iter().chain(extra) {
            t.set(id, v);
        }
        t
    }

    #[test]
    fn fuzz_squares_the_wave_and_off_is_transparent() {
        let run = |on: f32| {
            let mut t = clean_rig(&[(PARAM_FUZZ_ON, on), (PARAM_FUZZ, 1.0), (PARAM_FUZZ_TONE, 1.0)]);
            let mut y = sine(220.0, 0.5, 0.05);
            t.process(&mut y);
            y.split_off(12000)
        };
        let (off, on) = (run(0.0), run(1.0));
        assert!(on.iter().all(|v| v.is_finite()));
        // выключен — третья гармоника почти не видна; включён — почти меандр: третья гармоника сильная
        assert!(bin(&off, 660.0) < 0.02 * bin(&off, 220.0), "без фузза чисто: {}", bin(&off, 660.0) / bin(&off, 220.0));
        assert!(bin(&on, 660.0) > 0.15 * bin(&on, 220.0), "фузз: {}", bin(&on, 660.0) / bin(&on, 220.0));
    }

    #[test]
    fn boost_knobs_add_up_and_off_is_bit_exact() {
        let level = |extra: &[(u32, f32)]| {
            let mut t = clean_rig(extra);
            let mut y = sine(440.0, 0.5, 0.001);
            t.process(&mut y);
            rms(&y[12000..])
        };
        let base = level(&[]);
        let noon = level(&[(PARAM_BOOST_ON, 1.0)]);
        let one = level(&[(PARAM_BOOST_ON, 1.0), (PARAM_BOOST_LEVEL_0 + 2, 1.0)]);
        let all: Vec<(u32, f32)> = std::iter::once((PARAM_BOOST_ON, 1.0)).chain((0..4).map(|i| (PARAM_BOOST_LEVEL_0 + i, 1.0))).collect();
        let four = level(&all);
        let db = |a: f32| 20.0 * (a / base).log10();
        assert!(db(noon).abs() < 0.5, "все ручки на полудне — без усиления: {}", db(noon));
        assert!((db(one) - 7.5).abs() < 1.0, "одна ручка до упора: {}", db(one));
        assert!(db(four) > 4.0 * db(one) - 4.0, "четыре ручки складываются: {} против {}", db(four), db(one));
        // выключен — «real shit bypass»: сигнал не тронут
        let mut a = Tone::new(FS);
        a.set(PARAM_BOOST_LEVEL_0, 1.0);
        let mut b = Tone::new(FS);
        let (mut x, mut y) = (sine(330.0, 0.1, 0.2), sine(330.0, 0.1, 0.2));
        a.process(&mut x);
        b.process(&mut y);
        assert_eq!(x, y);
    }

    /// Бас-комплект с чистым голосом, без комнаты и гейта; extra — поверх.
    fn bass_rig(extra: &[(u32, f32)]) -> Tone {
        let mut t = Tone::new(FS);
        for &(id, v) in [(PARAM_RIG, 1.0), (PARAM_MODEL, 1.0), (PARAM_GAIN, 0.3), (PARAM_ROOM_MIX, 0.0), (PARAM_GATE, -120.0)].iter().chain(extra) {
            t.set(id, v);
        }
        t
    }
    fn level(t: &mut Tone, hz: f32, amp: f32) -> f32 {
        let mut y = sine(hz, 0.6, amp);
        t.process(&mut y);
        bin(&y[14400..], hz)
    }

    #[test]
    fn bass_rig_keeps_the_low_end_the_guitar_rig_cuts() {
        // нижнее E баса (41 Гц): гитарный кабинет и пред-EQ его режут, басовые — пропускают
        let mut guitar = Tone::new(FS);
        for (id, v) in [(PARAM_MODEL, 0.0), (PARAM_GAIN, 0.3), (PARAM_ROOM_MIX, 0.0), (PARAM_GATE, -120.0)] {
            guitar.set(id, v);
        }
        let (g, b) = (level(&mut guitar, 41.2, 0.05), level(&mut bass_rig(&[]), 41.2, 0.05));
        assert!(b > 2.5 * g, "бас на 41 Гц: {b} против гитары {g}");
    }

    #[test]
    fn mid_frequency_switch_moves_the_mid_peak() {
        let at = |pos: f32, hz: f32| level(&mut bass_rig(&[(PARAM_MID, 1.0), (PARAM_MID_FREQ, pos), (PARAM_CAB, 0.0)]), hz, 0.01);
        assert!(at(0.0, 220.0) > 2.0 * at(4.0, 220.0), "220 Гц: {} против {}", at(0.0, 220.0), at(4.0, 220.0));
        assert!(at(4.0, 3000.0) > 2.0 * at(0.0, 3000.0), "3 кГц: {} против {}", at(4.0, 3000.0), at(0.0, 3000.0));
    }

    #[test]
    fn bass_compressor_evens_out_loud_and_quiet() {
        let spread = |comp: f32| {
            let loud = level(&mut bass_rig(&[(PARAM_COMP, comp), (PARAM_GAIN, 0.0)]), 110.0, 0.5);
            let quiet = level(&mut bass_rig(&[(PARAM_COMP, comp), (PARAM_GAIN, 0.0)]), 110.0, 0.05);
            20.0 * (loud / quiet).log10()
        };
        let (off, on) = (spread(0.0), spread(1.0));
        assert!((off - 20.0).abs() < 2.0, "без компрессора — те же 20 дБ: {off}");
        assert!(on < 12.0, "с компрессором разница меньше: {on}");
    }

    #[test]
    fn compressor_switched_off_while_playing_loud_forgets_it() {
        // выключили посреди громкой игры, через полсекунды тишины включили — тихая нота как у компрессора, который до
        // этого не включался (оба прогреты одинаково: параметры усилителя доехали до басовых)
        let run = |on_at_start: bool| {
            let mut t = bass_rig(&[(PARAM_GAIN, 0.0), (PARAM_COMP, if on_at_start { 1.0 } else { 0.0 })]);
            let mut loud = sine(110.0, 0.3, 0.8);
            t.process(&mut loud);
            t.set(PARAM_COMP, 0.0);
            let mut still_loud = sine(110.0, 1.2, 0.8);
            t.process(&mut still_loud);
            let mut gap = vec![0.0; 24000];
            t.process(&mut gap);
            t.set(PARAM_COMP, 1.0);
            let mut first = sine(110.0, 0.2, 0.05);
            t.process(&mut first);
            rms(&first[1200..4800])
        };
        let (a, b) = (run(true), run(false));
        assert!((a / b - 1.0).abs() < 0.05, "первая нота после включения: {a} против {b}");
    }

    #[test]
    fn pedals_switched_off_go_back_to_bypass() {
        let mut t = clean_rig(&[(PARAM_SCREAMER_ON, 1.0), (PARAM_FUZZ_ON, 1.0), (PARAM_BOOST_ON, 1.0), (PARAM_RIG, 1.0), (PARAM_COMP, 0.5)]);
        let mut y = sine(220.0, 0.2, 0.1);
        t.process(&mut y);
        for id in [PARAM_SCREAMER_ON, PARAM_FUZZ_ON, PARAM_BOOST_ON, PARAM_COMP] {
            t.set(id, 0.0);
        }
        let mut z = sine(220.0, 0.3, 0.1);
        t.process(&mut z);
        assert_eq!([t.scr_mix.value, t.fz_mix.value, t.bst_mix.value, t.comp_mix.value], [0.0; 4]);
        assert_eq!([t.comp_env, t.comp_gain], [0.0, 1.0]);
    }

    #[test]
    fn blend_zero_keeps_the_grit_voice_clean() {
        let thd = |blend: f32| {
            let mut t = bass_rig(&[(PARAM_MODEL, 2.0), (PARAM_GAIN, 1.0), (PARAM_BLEND, blend), (PARAM_CAB, 0.0)]);
            let mut y = sine(110.0, 0.6, 0.2);
            t.process(&mut y);
            let body = &y[14400..];
            bin(body, 330.0) / bin(body, 110.0)
        };
        assert!(thd(0.0) < 0.02, "только DI — чисто: {}", thd(0.0));
        assert!(thd(1.0) > 0.1, "только усилитель — перегруз: {}", thd(1.0));
    }

    #[test]
    fn horn_adds_the_top_end() {
        let at = |horn: f32| level(&mut bass_rig(&[(PARAM_HORN, horn)]), 8000.0, 0.01);
        assert!(at(1.0) > 3.0 * at(0.0), "8 кГц с рупором: {} без: {}", at(1.0), at(0.0));
    }

    #[test]
    fn guitar_rig_ignores_bass_only_params_bit_exact() {
        let mut a = Tone::new(FS);
        let mut b = Tone::new(FS);
        for (id, v) in [(PARAM_MID_FREQ, 0.0), (PARAM_ULTRA_LO, 1.0), (PARAM_ULTRA_HI, 1.0), (PARAM_BLEND, 0.2), (PARAM_COMP, 0.8), (PARAM_HORN, 0.0)] {
            b.set(id, v);
        }
        let (mut x, mut y) = (sine(196.0, 0.2, 0.2), sine(196.0, 0.2, 0.2));
        a.process(&mut x);
        b.process(&mut y);
        assert_eq!(x, y);
    }

    #[test]
    fn switching_rigs_stays_finite_and_back_to_guitar_is_the_same_voice() {
        let mut t = Tone::new(FS);
        let mut y = sine(82.4, 0.3, 0.3);
        t.process(&mut y);
        t.set(PARAM_RIG, 1.0);
        t.set(PARAM_COMP, 0.7);
        let mut z = sine(82.4, 0.3, 0.3);
        t.process(&mut z);
        t.set(PARAM_RIG, 0.0);
        let mut w = sine(82.4, 0.3, 0.3);
        t.process(&mut w);
        assert!(y.iter().chain(&z).chain(&w).all(|v| v.is_finite() && v.abs() < 4.0));
        assert_eq!(t.rig, RIG_GUITAR);
    }

    #[test]
    fn works_at_high_sample_rates() {
        for fs in [44100.0, 96000.0, 192000.0] {
            let mut t = Tone::new(fs);
            let mut y: Vec<f32> = (0..fs as usize / 10).map(|i| 0.1 * (2.0 * PI * 110.0 * i as f32 / fs).sin()).collect();
            t.process(&mut y);
            assert!(y.iter().all(|v| v.is_finite()) && rms(&y) > 1e-3);
        }
    }
}
