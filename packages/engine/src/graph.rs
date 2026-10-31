// Граф реального времени (01-architecture §8.3, этап 41a): вход (канал или смесь, DC-блок) → гитарный процессор
// (pupitre_dsp::Tone; только пока мониторинг звучит) → мониторинг (плавный гейн, мягкое ограничение без заглядывания
// вперёд, глушение) → оба выхода; метры окнами по METER_FRAMES; замер задержки
// (rtl) на время замера заменяет мониторинг щелчками; сухой сигнал (после канала и DC-блока) уходит отводом в rtrb потоку
// анализа. В process() — ни аллокаций, ни локов, ни системных вызовов: команды приходят и пакеты уходят через rtrb
// (переполнение — потеря пакета метров или сэмплов анализа, считается; звук не страдает).
use pupitre_dsp::tone::PARAM_BYPASS;
use pupitre_dsp::Tone;
use rtrb::{Consumer, Producer};

use crate::rtl::{Rtl, RtlReport};

/// Сэмпл сырого канала не тише — перегруз.
pub const CLIP: f32 = 0.999;
/// Окно метров: ≈ 10.7 мс при 48 кГц.
pub const METER_FRAMES: u32 = 512;
/// Мягкое ограничение: ниже колена — без изменений, выше — плавно к ±1.
const KNEE: f32 = 0.8;
/// DC-блок: частота среза, Гц.
const DC_HZ: f32 = 10.0;
/// Разгон гейна мониторинга — линейный, за это время (точный приход в цель; однополюсное сглаживание в f32 застревает
/// у цели на ~1e−5 и не даёт побитового сквозного канала).
const GAIN_RAMP_S: f32 = 0.005;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Command {
    /// −1 — смесь.
    Channel(i32),
    /// Сколько каналов устройства подключено (1–2): смесь моно-входа — его единственный канал.
    CaptureChannels(u8),
    /// Линейный гейн мониторинга.
    MonitorGain(f32),
    Mute(bool),
    DcBlock(bool),
    StartRtl { clicks: u16, interval: u32, timeout: u32 },
    /// Параметр процессора: номер (pupitre_dsp::tone::PARAM_*) и значение.
    Tone(u32, f32),
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Meter {
    /// Номер кадра конца окна.
    pub frames: u64,
    /// Пики сырых каналов.
    pub peak: [f32; 2],
    /// Сухой сигнал (канал или смесь после DC-блока): пик и RMS окна.
    pub dry_peak: f32,
    pub dry_rms: f32,
    pub out_peak: f32,
    pub clipped: bool,
    /// Максимум доли периода, занятой колбэком, за окно.
    pub load: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    Meter(Meter),
    Rtl(RtlReport),
}

#[derive(Default)]
struct Acc {
    n: u32,
    peak: [f32; 2],
    dry_peak: f32,
    sumsq: f32,
    out_peak: f32,
    clipped: bool,
    load: f32,
}

/// Мягкое ограничение без заглядывания вперёд: тождественно до колена, выше — tanh к ±1; производная непрерывна.
#[inline]
pub fn soft_clip(x: f32) -> f32 {
    let a = x.abs();
    if a <= KNEE {
        x
    } else {
        (KNEE + (1.0 - KNEE) * ((a - KNEE) / (1.0 - KNEE)).tanh()).copysign(x)
    }
}

/// Наибольший период, который граф принимает за раз (квант JACK — до 8192).
pub const MAX_BLOCK: usize = 8192;

pub struct Graph {
    commands: Consumer<Command>,
    events: Producer<Event>,
    /// Отвод сухого сигнала потоку анализа и буфер периода под него (выделен при создании).
    tap: Producer<f32>,
    tap_buf: Vec<f32>,
    tap_dropped: u64,
    channel: i32,
    channels: u8,
    gain: f32,
    target: f32,
    ramp_step: f32,
    ramp_left: u32,
    ramp_frames: u32,
    muted: bool,
    dc: bool,
    dc_r: f32,
    dc_x1: f32,
    dc_y1: f32,
    frames: u64,
    acc: Acc,
    rtl: Rtl,
    /// Процессор мониторинга (буферы дилея и комнаты выделены при создании графа).
    tone: Tone,
    sample_rate: f32,
}

impl Graph {
    pub fn new(sample_rate: f32, commands: Consumer<Command>, events: Producer<Event>, tap: Producer<f32>) -> Self {
        Graph {
            commands,
            events,
            tap,
            tap_buf: vec![0.0; MAX_BLOCK],
            tap_dropped: 0,
            channel: -1,
            channels: 2,
            gain: 0.0,
            target: 0.0,
            ramp_step: 0.0,
            ramp_left: 0,
            ramp_frames: ((GAIN_RAMP_S * sample_rate) as u32).max(1),
            muted: false,
            dc: true,
            dc_r: 1.0 - 2.0 * std::f32::consts::PI * DC_HZ / sample_rate,
            dc_x1: 0.0,
            dc_y1: 0.0,
            frames: 0,
            acc: Acc::default(),
            rtl: Rtl::default(),
            tone: {
                // до команд — в обходе: мониторинг сухой, как без процессора
                let mut tone = Tone::new(sample_rate);
                tone.set(PARAM_BYPASS, 1.0);
                tone
            },
            sample_rate,
        }
    }

    pub fn frames(&self) -> u64 {
        self.frames
    }

    /// Сэмплов анализа потеряно (поток анализа не успевал).
    pub fn tap_dropped(&self) -> u64 {
        self.tap_dropped
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    fn apply(&mut self, command: Command) {
        match command {
            Command::Channel(c) => self.channel = c,
            Command::CaptureChannels(n) => self.channels = n.clamp(1, 2),
            Command::MonitorGain(g) => {
                // не громче входа: усиление мониторинга — только ниже 0 дБ (безопасность слуха, §8.9)
                self.target = if g.is_finite() { g.clamp(0.0, 1.0) } else { 0.0 };
                if !self.muted {
                    self.ramp_left = self.ramp_frames;
                    self.ramp_step = (self.target - self.gain) / self.ramp_frames as f32;
                }
            }
            Command::Mute(m) => {
                self.muted = m;
                // и при глушении, и при его снятии — с нуля: снятие разгоняется от тишины к цели
                self.gain = 0.0;
                self.ramp_left = if m { 0 } else { self.ramp_frames };
                self.ramp_step = if m { 0.0 } else { self.target / self.ramp_frames as f32 };
            }
            Command::DcBlock(on) => self.dc = on,
            Command::StartRtl { clicks, interval, timeout } => self.rtl.start(clicks, interval, timeout, self.frames),
            Command::Tone(id, value) => self.tone.set(id, value),
        }
    }

    /// Доля периода, занятая колбэком (считает слой ввода-вывода вокруг process).
    pub fn note_load(&mut self, load: f32) {
        if load > self.acc.load {
            self.acc.load = load;
        }
    }

    /// Один период: два входа, два выхода (длины — периода; лишние сэмплы выходов зануляются).
    pub fn process(&mut self, in0: &[f32], in1: &[f32], out0: &mut [f32], out1: &mut [f32]) {
        while let Ok(command) = self.commands.pop() {
            self.apply(command);
        }
        let n = in0.len().min(in1.len()).min(out0.len()).min(out1.len()).min(MAX_BLOCK);
        for i in 0..n {
            // NaN или бесконечность на входе (сбой драйвера) не отравляют DC-блок и метры
            let a = if in0[i].is_finite() { in0[i] } else { 0.0 };
            let b = if in1[i].is_finite() { in1[i] } else { 0.0 };
            let (aa, ab) = (a.abs(), b.abs());
            let acc = &mut self.acc;
            acc.peak[0] = acc.peak[0].max(aa);
            acc.peak[1] = acc.peak[1].max(ab);
            if aa >= CLIP || ab >= CLIP {
                acc.clipped = true;
            }
            let x = match self.channel {
                0 => a,
                1 => b,
                _ if self.channels >= 2 => 0.5 * (a + b),
                _ => a,
            };
            let dry = if self.dc {
                let y = x - self.dc_x1 + self.dc_r * self.dc_y1;
                self.dc_x1 = x;
                self.dc_y1 = y;
                y
            } else {
                x
            };
            self.tap_buf[i] = dry;
            let acc = &mut self.acc;
            acc.dry_peak = acc.dry_peak.max(dry.abs());
            acc.sumsq += dry * dry;
            if self.ramp_left > 0 {
                self.ramp_left -= 1;
                self.gain = if self.ramp_left == 0 { self.target } else { self.gain + self.ramp_step };
            }
            // процессор — только пока мониторинг звучит или разгоняется: молчащий не тратит период
            let wet = if !self.muted && (self.gain > 0.0 || self.ramp_left > 0) { self.tone.tick(dry) } else { dry };
            let mut out = if self.muted { 0.0 } else { soft_clip(wet * self.gain) };
            if self.rtl.active() {
                // замер: вместо мониторинга — щелчки (при глушении — тишина), отклик ловится на сыром канале
                let (click, report) = self.rtl.tick(x, self.frames + i as u64);
                out = if self.muted { 0.0 } else { click };
                if let Some(report) = report {
                    let _ = self.events.push(Event::Rtl(report));
                }
            }
            out0[i] = out;
            out1[i] = out;
            acc.out_peak = acc.out_peak.max(out.abs());
            acc.n += 1;
            if acc.n >= METER_FRAMES {
                let meter = Meter {
                    frames: self.frames + i as u64 + 1,
                    peak: acc.peak,
                    dry_peak: acc.dry_peak,
                    dry_rms: (acc.sumsq / acc.n as f32).sqrt(),
                    out_peak: acc.out_peak,
                    clipped: acc.clipped,
                    load: acc.load,
                };
                *acc = Acc::default();
                let _ = self.events.push(Event::Meter(meter));
            }
        }
        for o in out0[n..].iter_mut().chain(out1[n..].iter_mut()) {
            *o = 0.0;
        }
        match self.tap.write_chunk_uninit(n) {
            Ok(chunk) => {
                chunk.fill_from_iter(self.tap_buf[..n].iter().copied());
            }
            Err(_) => self.tap_dropped += n as u64,
        }
        // Денормалы: затухающее состояние DC-блока обнуляется, пока не ушло в субнормальный диапазон.
        if self.dc_y1.abs() < 1e-20 {
            self.dc_y1 = 0.0;
        }
        self.frames += n as u64;
    }
}

/// Граф с очередями: (граф, вход команд, выход событий, сухой сигнал анализу — до 2 с). Команд — с запасом на смену
/// пресета целиком (все параметры процессора разом) поверх открытия.
pub fn graph(sample_rate: f32) -> (Graph, Producer<Command>, Consumer<Event>, Consumer<f32>) {
    let (commands_tx, commands_rx) = rtrb::RingBuffer::new(512);
    let (events_tx, events_rx) = rtrb::RingBuffer::new(1024);
    let (tap_tx, tap_rx) = rtrb::RingBuffer::new((sample_rate as usize) * 2);
    (Graph::new(sample_rate, commands_rx, events_tx, tap_tx), commands_tx, events_rx, tap_rx)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain(events: &mut Consumer<Event>) -> Vec<Event> {
        std::iter::from_fn(|| events.pop().ok()).collect()
    }

    fn sine(n: usize, amp: f32, period: f32) -> Vec<f32> {
        (0..n).map(|i| amp * (2.0 * std::f32::consts::PI * i as f32 / period).sin()).collect()
    }

    /// Прогон блоками по 128 кадров; вернёт выход левого канала.
    fn run(g: &mut Graph, a: &[f32], b: &[f32]) -> Vec<f32> {
        let mut out = Vec::new();
        let (mut l, mut r) = ([0.0f32; 128], [0.0f32; 128]);
        for (ca, cb) in a.chunks(128).zip(b.chunks(128)) {
            g.process(ca, cb, &mut l[..ca.len()], &mut r[..ca.len()]);
            assert_eq!(&l[..ca.len()], &r[..ca.len()], "оба выхода одинаковы");
            out.extend_from_slice(&l[..ca.len()]);
        }
        out
    }

    #[test]
    fn soft_clip_is_identity_below_knee_and_bounded() {
        for x in [-0.8f32, -0.3, 0.0, 0.25, 0.8] {
            assert_eq!(soft_clip(x), x);
        }
        let mut prev = soft_clip(0.8);
        for i in 1..1000 {
            let y = soft_clip(0.8 + i as f32 * 0.01);
            assert!(y >= prev && y <= 1.0, "монотонно и не выше 1: {y}");
            prev = y;
        }
        assert_eq!(soft_clip(-5.0), -soft_clip(5.0));
    }

    #[test]
    fn passthrough_bit_exact_without_dc_block() {
        let (mut g, mut tx, _rx, _tap) = graph(48000.0);
        tx.push(Command::DcBlock(false)).unwrap();
        tx.push(Command::Channel(0)).unwrap();
        tx.push(Command::MonitorGain(1.0)).unwrap();
        // гейн выходит на 1 плавно — сначала прогрев
        run(&mut g, &vec![0.0; 9600], &vec![0.0; 9600]);
        let a = sine(4800, 0.5, 109.0);
        let out = run(&mut g, &a, &vec![0.0; 4800]);
        assert_eq!(out, a);
    }

    #[test]
    fn channel_select_and_mix() {
        let a = sine(9600, 0.4, 64.0);
        let b = sine(9600, 0.2, 37.0);
        let tail = |v: &[f32]| v[4800..].to_vec();
        for (channel, channels, want) in [
            (0, 2, a.clone()),
            (1, 2, b.clone()),
            (-1, 2, a.iter().zip(&b).map(|(x, y)| 0.5 * (x + y)).collect::<Vec<_>>()),
            (-1, 1, a.clone()),
        ] {
            let (mut g, mut tx, _rx, _tap) = graph(48000.0);
            tx.push(Command::DcBlock(false)).unwrap();
            tx.push(Command::Channel(channel)).unwrap();
            tx.push(Command::CaptureChannels(channels)).unwrap();
            tx.push(Command::MonitorGain(1.0)).unwrap();
            let out = run(&mut g, &a, &b);
            let err = tail(&out).iter().zip(tail(&want)).map(|(x, y)| (x - y).abs()).fold(0.0f32, f32::max);
            assert!(err < 1e-6, "канал {channel}, каналов {channels}: ошибка {err}");
        }
    }

    #[test]
    fn dc_block_removes_offset() {
        let (mut g, mut tx, _rx, _tap) = graph(48000.0);
        tx.push(Command::MonitorGain(1.0)).unwrap();
        let out = run(&mut g, &vec![0.3; 96000], &vec![0.3; 96000]);
        assert!(out[95999].abs() < 1e-3, "постоянная составляющая ушла: {}", out[95999]);
    }

    #[test]
    fn meters_every_window_with_clip_on_raw_channel() {
        let (mut g, mut tx, mut rx, _tap) = graph(48000.0);
        tx.push(Command::DcBlock(false)).unwrap();
        let mut a = sine(METER_FRAMES as usize * 4, 0.5, 64.0);
        a[METER_FRAMES as usize * 2 + 10] = 1.0; // перегруз в третьем окне
        let b = vec![0.0; a.len()];
        run(&mut g, &a, &b);
        let meters: Vec<Meter> = drain(&mut rx)
            .into_iter()
            .map(|e| match e {
                Event::Meter(m) => m,
                other => panic!("лишнее событие {other:?}"),
            })
            .collect();
        assert_eq!(meters.len(), 4);
        assert_eq!(meters.iter().map(|m| m.frames).collect::<Vec<_>>(), [512, 1024, 1536, 2048]);
        assert_eq!(meters.iter().map(|m| m.clipped).collect::<Vec<_>>(), [false, false, true, false]);
        assert!((meters[0].peak[0] - 0.5).abs() < 1e-3 && meters[0].peak[1] == 0.0);
        // смесь моно-синуса с тишиной: пик сухого 0.25, RMS 0.25/√2
        assert!((meters[0].dry_peak - 0.25).abs() < 1e-3);
        assert!((meters[0].dry_rms - 0.25 / 2f32.sqrt()).abs() < 2e-3);
        assert_eq!(meters[0].out_peak, 0.0, "мониторинг выключен по умолчанию");
    }

    #[test]
    fn mute_silences_at_once_and_gain_ramps() {
        let (mut g, mut tx, _rx, _tap) = graph(48000.0);
        tx.push(Command::DcBlock(false)).unwrap();
        tx.push(Command::MonitorGain(1.0)).unwrap();
        let ones = vec![0.5; 48000];
        let out = run(&mut g, &ones, &ones);
        // разгон гейна за 5 мс: без скачка в первом сэмпле, к 50 мс — ровно у цели
        assert!(out[0] < 0.01 && (out[2400] - 0.5).abs() < 1e-3);
        tx.push(Command::Mute(true)).unwrap();
        let out = run(&mut g, &ones[..256], &ones[..256]);
        assert!(out.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn unmute_ramps_from_silence_without_overshoot_and_nan_does_not_poison() {
        let (mut g, mut tx, _rx, _tap) = graph(48000.0);
        tx.push(Command::DcBlock(false)).unwrap();
        tx.push(Command::Mute(true)).unwrap();
        tx.push(Command::MonitorGain(0.5)).unwrap();
        let ones = vec![0.5; 4800];
        run(&mut g, &ones, &ones);
        tx.push(Command::Mute(false)).unwrap();
        let out = run(&mut g, &ones, &ones);
        let peak = out.iter().copied().fold(0.0f32, f32::max);
        assert!(out[0] < 0.01 && (peak - 0.25).abs() < 1e-6, "разгон с нуля до 0.5 × 0.5 без перелёта: пик {peak}");
        let mut bad = vec![0.5f32; 256];
        bad[10] = f32::NAN;
        run(&mut g, &bad, &bad);
        let after = run(&mut g, &ones[..256], &ones[..256]);
        assert!(after.iter().all(|v| v.is_finite() && (v - 0.25).abs() < 1e-6));
    }

    #[test]
    fn tone_is_bypassed_until_enabled_and_shapes_monitoring() {
        let (mut g, mut tx, _ev, _tap) = graph(48000.0);
        tx.push(Command::DcBlock(false)).unwrap();
        tx.push(Command::MonitorGain(1.0)).unwrap();
        let input: Vec<f32> = (0..4800).map(|i| 0.1 * (2.0 * std::f32::consts::PI * 110.0 * i as f32 / 48000.0).sin()).collect();
        let dry = run(&mut g, &input, &input);
        // после разгона гейна — сквозной канал
        assert_eq!(&dry[1000..], &input[1000..]);
        tx.push(Command::Tone(PARAM_BYPASS, 0.0)).unwrap();
        let wet = run(&mut g, &input, &input);
        let diff: f32 = wet[1000..].iter().zip(&input[1000..]).map(|(a, b)| (a - b).abs()).sum();
        assert!(diff > 1.0, "процессор включён — звук другой");
        assert!(wet.iter().all(|v| v.is_finite() && v.abs() <= 1.0));
    }

    #[test]
    fn monitor_gain_is_capped_at_unity() {
        let (mut g, mut tx, _rx, _tap) = graph(48000.0);
        tx.push(Command::DcBlock(false)).unwrap();
        tx.push(Command::MonitorGain(4.0)).unwrap();
        let out = run(&mut g, &vec![0.5; 4800], &vec![0.5; 4800]);
        assert!((out[4799] - 0.5).abs() < 1e-6, "гейн 4 урезан до 1: {}", out[4799]);
    }

    #[test]
    fn rtl_replaces_monitoring_and_reports() {
        let (mut g, mut tx, mut rx, _tap) = graph(48000.0);
        tx.push(Command::MonitorGain(1.0)).unwrap();
        tx.push(Command::StartRtl { clicks: 4, interval: 2400, timeout: 2000 }).unwrap();
        // петля 256 кадров через сырой канал 0
        let mut line = vec![0.0f32; 256];
        let (mut l, mut r) = ([0.0f32; 128], [0.0f32; 128]);
        let mut report = None;
        for block in 0..2000 {
            let start = (block * 128) % 256;
            let input: Vec<f32> = line[start..start + 128].to_vec();
            g.process(&input, &[0.0; 128], &mut l, &mut r);
            line[start..start + 128].copy_from_slice(&l);
            for e in drain(&mut rx) {
                if let Event::Rtl(rep) = e {
                    report = Some(rep);
                }
            }
            if report.is_some() {
                break;
            }
        }
        let rep = report.expect("отчёт замера");
        assert_eq!((rep.count, rep.misses, rep.median()), (4, 0, Some(256)));
    }
}
