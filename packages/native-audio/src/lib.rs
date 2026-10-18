// Нативный захват звука для Electron (этап 4 курса 2): cpal (WASAPI/ALSA→PipeWire)
// + DSP-ядро packages/dsp прямо в аудиопотоке драйвера. Наружу — N-API (napi-rs):
// listDevices / start / setGate / stop; кадры анализа уходят батчами через
// threadsafe-callback в той же раскладке FRAME_FLOATS, что и AudioWorklet-путь.
//
// Часы: t кадров — секунды от старта потока (счётчик сэмплов ядра). Батч несёт
// ageMs (возраст последнего кадра на момент отправки, по таймстампам драйвера)
// и postedAtMs (epoch-мс отправки) — рендерер привязывает кадры к своему
// AudioContext-времени, пересчёта часов в ядре нет (инвариант 4 плана).

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::JsFunction;
use napi_derive::napi;
use pupitre_dsp::{Analyzer, FRAME_FLOATS, HOP};

#[napi(object)]
pub struct DeviceInfo {
    pub id: String,
    pub label: String,
    pub is_default: bool,
}

#[napi(object)]
pub struct StartInfo {
    pub sample_rate: f64,
    pub channels: u32,
    /// имя фактически открытого устройства (запрошенное может не найтись)
    pub device: String,
    pub analysis_latency_ms: f64,
}

#[napi(object)]
pub struct FrameBatch {
    /// кадры анализа подряд, FRAME_FLOATS f32 на кадр (контракт AnalysisFrame::write)
    pub frames: Float32Array,
    /// возраст последнего кадра батча на момент отправки, мс (по часам драйвера)
    pub age_ms: f64,
    /// epoch-мс отправки — для замера доставки через IPC (Date.now той же шкалы)
    pub posted_at_ms: f64,
}

struct Shared {
    gate_rms: AtomicU32,
    gate_clarity: AtomicU32,
    stop: AtomicBool,
}

impl Shared {
    fn new(gate_rms: f32, gate_clarity: f32) -> Self {
        Self {
            gate_rms: AtomicU32::new(gate_rms.to_bits()),
            gate_clarity: AtomicU32::new(gate_clarity.to_bits()),
            stop: AtomicBool::new(false),
        }
    }
}

struct Active {
    shared: Arc<Shared>,
    join: Option<JoinHandle<()>>,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

// Каждый кусок входа <=HOP порождает не более одного кадра. Передаём его
// по значению; JS-массив создаётся в N-API-колбэке, а не в потоке захвата.
struct RawBatch {
    frames: [f32; FRAME_FLOATS],
    age_ms: f64,
    posted_at_ms: f64,
}

type BatchFn = ThreadsafeFunction<RawBatch, ErrorStrategy::Fatal>;

/// Обработчик сэмплов внутри аудиоколбэка cpal.
struct Processor {
    analyzer: Analyzer,
    shared: Arc<Shared>,
    tsfn: BatchFn,
    rate: f64,
    total_samples: u64,
    mono: [f32; HOP],
}

impl Processor {
    fn new(rate: f64, shared: Arc<Shared>, tsfn: BatchFn) -> Self {
        Self {
            analyzer: Analyzer::new(rate as f32),
            shared,
            tsfn,
            rate,
            total_samples: 0,
            mono: [0.0; HOP],
        }
    }

    /// Любой размер драйверного буфера обрабатываем фиксированным scratch.
    fn capture<T: Copy, F: Fn(T) -> f32>(&mut self, data: &[T], channels: usize, to_f32: F, age_last: f64) {
        let channels = channels.max(1);
        let total = data.len() / channels;
        let mut processed = 0;
        for chunk in data.chunks(HOP * channels) {
            let frames = chunk.len() / channels;
            for i in 0..frames {
                let mut acc = 0.0f32;
                for c in 0..channels {
                    acc += to_f32(chunk[i * channels + c]);
                }
                self.mono[i] = acc / channels as f32;
            }
            processed += frames;
            self.feed(frames, age_last + (total - processed) as f64 / self.rate);
        }
    }

    /// age_last_sec — возраст последнего сэмпла буфера на момент колбэка.
    fn feed(&mut self, frames: usize, age_last_sec: f64) {
        let gr = f32::from_bits(self.shared.gate_rms.load(Ordering::Relaxed));
        let gc = f32::from_bits(self.shared.gate_clarity.load(Ordering::Relaxed));
        self.analyzer.set_gate(gr, gc);

        let mut out = [0.0f32; FRAME_FLOATS];
        let mut ready = false;
        let mut last_t = 0.0f64;
        self.analyzer.process(&self.mono[..frames], |frame| {
            frame.write(&mut out);
            ready = true;
            last_t = frame.t as f64;
        });
        self.total_samples += frames as u64;
        if !ready {
            return;
        }
        let total_sec = self.total_samples as f64 / self.rate;
        let age_ms = ((total_sec - last_t).max(0.0) + age_last_sec.max(0.0)) * 1000.0;
        let posted_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        let batch = RawBatch { frames: out, age_ms, posted_at_ms };
        self.tsfn.call(batch, ThreadsafeFunctionCallMode::NonBlocking);
    }
}

fn napi_err<E: std::fmt::Display>(e: E) -> Error {
    Error::from_reason(e.to_string())
}

/// ALSA перечисляет и служебные PCM-плагины (ресемплеры, матрицы каналов) —
/// в списке устройств для пользователя они только путают.
const ALSA_JUNK_PREFIXES: &[&str] = &[
    "null", "samplerate", "speexrate", "upmix", "vdownmix", "lavrate",
    "surround", "iec958", "hdmi", "dmix", "dsnoop", "usbstream", "oss", "jack",
];

#[napi]
pub fn list_devices() -> Result<Vec<DeviceInfo>> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|d| d.name().ok());
    let mut out = Vec::new();
    for dev in host.input_devices().map_err(napi_err)? {
        if let Ok(name) = dev.name() {
            if ALSA_JUNK_PREFIXES.iter().any(|p| name.starts_with(p)) {
                continue;
            }
            out.push(DeviceInfo {
                id: name.clone(),
                label: name.clone(),
                is_default: Some(&name) == default_name.as_ref(),
            });
        }
    }
    Ok(out)
}

#[napi(ts_args_type = "deviceId: string | null, gateRms: number, gateClarity: number, onBatch: (batch: FrameBatch) => void")]
pub fn start(
    device_id: Option<String>,
    gate_rms: f64,
    gate_clarity: f64,
    on_batch: JsFunction,
) -> Result<StartInfo> {
    stop_active();
    let tsfn: BatchFn = on_batch.create_threadsafe_function(64, |ctx| {
        let batch: RawBatch = ctx.value;
        Ok(vec![FrameBatch {
            frames: batch.frames.to_vec().into(),
            age_ms: batch.age_ms,
            posted_at_ms: batch.posted_at_ms,
        }])
    })?;
    let shared = Arc::new(Shared::new(gate_rms as f32, gate_clarity as f32));
    let (tx, rx) = sync_channel::<std::result::Result<StartInfo, String>>(1);

    let shared2 = shared.clone();
    let join = std::thread::Builder::new()
        .name("pupitre-audio".into())
        .spawn(move || audio_thread(device_id, shared2, tsfn, tx))
        .map_err(napi_err)?;

    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(info)) => {
            *ACTIVE.lock().unwrap() = Some(Active { shared, join: Some(join) });
            Ok(info)
        }
        Ok(Err(msg)) => {
            let _ = join.join();
            Err(Error::from_reason(msg))
        }
        Err(_) => {
            shared.stop.store(true, Ordering::Relaxed);
            Err(Error::from_reason("таймаут открытия устройства захвата"))
        }
    }
}

#[napi]
pub fn set_gate(gate_rms: f64, gate_clarity: f64) {
    if let Some(active) = ACTIVE.lock().unwrap().as_ref() {
        active.shared.gate_rms.store((gate_rms as f32).to_bits(), Ordering::Relaxed);
        active.shared.gate_clarity.store((gate_clarity as f32).to_bits(), Ordering::Relaxed);
    }
}

#[napi]
pub fn stop() {
    stop_active();
}

fn stop_active() {
    let mut guard = ACTIVE.lock().unwrap();
    if let Some(mut active) = guard.take() {
        active.shared.stop.store(true, Ordering::Relaxed);
        if let Some(join) = active.join.take() {
            let _ = join.join();
        }
    }
}

/// Поток-владелец cpal-стрима: строит стрим, живёт до флага stop.
fn audio_thread(
    device_id: Option<String>,
    shared: Arc<Shared>,
    tsfn: BatchFn,
    tx: std::sync::mpsc::SyncSender<std::result::Result<StartInfo, String>>,
) {
    match build_stream(device_id, shared.clone(), tsfn) {
        Err(e) => {
            let _ = tx.send(Err(e));
        }
        Ok((stream, info)) => {
            let _ = tx.send(Ok(info));
            while !shared.stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(50));
            }
            drop(stream);
        }
    }
}

fn build_stream(
    device_id: Option<String>,
    shared: Arc<Shared>,
    tsfn: BatchFn,
) -> std::result::Result<(cpal::Stream, StartInfo), String> {
    let host = cpal::default_host();
    // запрошенное имя может исчезнуть (другой бэкенд, отключённый USB) —
    // тогда открываем устройство по умолчанию, а не падаем
    let device = device_id
        .as_ref()
        .and_then(|want| {
            host.input_devices()
                .ok()?
                .find(|d| d.name().map(|n| &n == want).unwrap_or(false))
        })
        .or_else(|| host.default_input_device())
        .ok_or("нет устройств захвата звука")?;
    let device_name = device.name().unwrap_or_else(|_| "unknown".into());

    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let sample_format = supported.sample_format();
    let mut config: cpal::StreamConfig = supported.into();
    let rate = config.sample_rate.0 as f64;
    let channels = config.channels as usize;

    let err_cb = |e: cpal::StreamError| {
        eprintln!("[native-audio] stream error: {e}");
    };

    // сперва маленький буфер (256 сэмплов ≈ 5 мс) ради задержки; если драйвер
    // отказал — его буфер по умолчанию
    let sizes = [cpal::BufferSize::Fixed(256), cpal::BufferSize::Default];
    let mut last_err = String::new();
    for size in sizes {
        config.buffer_size = size;
        let mut p = Processor::new(rate, shared.clone(), tsfn.clone());
        let result = match sample_format {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], info| {
                    p.capture(data, channels, |s| s, age_last_sec(info, data.len() as f64 / channels as f64 / p.rate));
                },
                err_cb,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], info| {
                    p.capture(data, channels, |s| s as f32 / 32768.0, age_last_sec(info, data.len() as f64 / channels as f64 / p.rate));
                },
                err_cb,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_input_stream(
                &config,
                move |data: &[u16], info| {
                    p.capture(data, channels, |s| (s as f32 - 32768.0) / 32768.0, age_last_sec(info, data.len() as f64 / channels as f64 / p.rate));
                },
                err_cb,
                None,
            ),
            other => return Err(format!("неподдерживаемый формат сэмплов: {other:?}")),
        };
        match result {
            Ok(stream) => {
                stream.play().map_err(|e| e.to_string())?;
                let info = StartInfo {
                    sample_rate: rate,
                    channels: channels as u32,
                    device: device_name,
                    analysis_latency_ms: Analyzer::new(rate as f32).latency_ms() as f64,
                };
                return Ok((stream, info));
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!("не удалось открыть поток захвата: {last_err}"))
}

/// Возраст последнего сэмпла буфера на момент колбэка по часам драйвера.
fn age_last_sec(info: &cpal::InputCallbackInfo, buf_dur_sec: f64) -> f64 {
    let ts = info.timestamp();
    let age_first = ts
        .callback
        .duration_since(&ts.capture)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    (age_first - buf_dur_sec).max(0.0)
}

