// N-API аддона (фича addon; загрузчик — apps/desktop/engine.js): долгие операции (список, открытие, закрытие, замер) —
// AsyncTask (Promise в JS, главный поток Electron не ждёт). Команда уходит в поток движка сразу при вызове из JS (порядок
// команд — порядок вызовов: close и следующий open не меняются местами в пуле потоков), в пуле — только ожидание
// ответа. Метры и события — потокобезопасные функции JS, вызов
// NonBlocking (переполнение — потеря пакета интерфейса, не звука). Ошибки — с кодом в начале: NO_ENGINE, NOT_FOUND,
// FAILED (рендерер по коду решает: браузерный захват, «устройство отключено», «не открылся»).
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use napi::bindgen_prelude::{AsyncTask, Float32Array, Float64Array};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, Error, JsFunction, Result, Task};
use napi_derive::napi;

use crate::engine::{AudioOut, DeviceList, Engine, EventOut, FramesOut, MeterOut, OpenInfo, Pending, RtlOut, SetOptions, Sink, Status};
use crate::io::jack::{self, EngineError, OpenOptions};

#[napi(object)]
pub struct JsDevice {
    pub id: String,
    pub label: String,
    pub channels: u32,
}

#[napi(object)]
pub struct JsDevices {
    pub capture: Vec<JsDevice>,
    pub playback: Vec<JsDevice>,
}

#[napi(object)]
pub struct JsOpenOptions {
    pub capture: Option<String>,
    pub playback: Option<String>,
    pub channel: i32,
    pub buffer_frames: u32,
    pub monitor_gain: f64,
    pub mute: Option<bool>,
    pub loopback: Option<bool>,
    /// Параметры процессора плоскими парами: номер, значение, номер, значение…
    pub tone: Option<Vec<f64>>,
}

#[napi(object)]
pub struct JsOpenInfo {
    pub backend: String,
    pub sample_rate: u32,
    pub buffer_frames: u32,
    pub requested_frames: u32,
    pub capture_latency_frames: u32,
    pub playback_latency_frames: u32,
    pub capture_id: String,
    pub capture_label: String,
    pub capture_channels: u32,
    pub playback_id: Option<String>,
    pub playback_label: String,
}

#[napi(object)]
pub struct JsSetOptions {
    pub channel: Option<i32>,
    pub monitor_gain: Option<f64>,
    pub mute: Option<bool>,
    /// Изменённые параметры процессора плоскими парами: номер, значение…
    pub tone: Option<Vec<f64>>,
    /// Запись дубля: сухой сигнал кусками в onAudio.
    pub record: Option<bool>,
}

/// Плоские пары «номер, значение» → пары; нечётный хвост и нечисла отбрасываются.
fn tone_pairs(flat: Option<Vec<f64>>) -> Vec<(u32, f32)> {
    flat.unwrap_or_default()
        .chunks_exact(2)
        .filter(|p| p[0].is_finite() && p[0] >= 0.0 && p[1].is_finite())
        .map(|p| (p[0] as u32, p[1] as f32))
        .collect()
}

#[napi(object)]
pub struct JsMeters {
    pub frames: f64,
    pub peak: Vec<f64>,
    pub dry_peak: f64,
    pub dry_rms: f64,
    pub clipped: bool,
    pub xruns: u32,
    pub load: f64,
    pub buffer_frames: u32,
    pub capture_latency_frames: u32,
    pub playback_latency_frames: u32,
}

#[napi(object)]
pub struct JsEvent {
    pub kind: String,
    pub device: Option<String>,
    pub buffer_frames: Option<u32>,
    pub requested_frames: Option<u32>,
    pub reason: Option<String>,
}

#[napi(object)]
pub struct JsRtl {
    pub delays_frames: Vec<u32>,
    pub median_frames: u32,
    pub median_ms: f64,
    pub misses: u32,
}

#[napi(object)]
pub struct JsStatus {
    pub open: bool,
    pub buffer_frames: u32,
    pub capture_id: String,
}

/// Кадры анализа: по 5 чисел на кадр — время (мкс часов JACK), MIDI (NaN — нет высоты), чистота, уровень dBFS, атака 0/1.
#[napi(object)]
pub struct JsFrames {
    pub now_us: f64,
    pub frames: Float64Array,
}

/// Кусок сухого сигнала записи дубля.
#[napi(object)]
pub struct JsAudio {
    pub sample_rate: u32,
    pub samples: Float32Array,
}

#[napi(object)]
pub struct JsAvailable {
    pub ok: bool,
    pub reason: Option<String>,
}

type Tsfn<T> = ThreadsafeFunction<T, ErrorStrategy::Fatal>;

#[derive(Default)]
struct TsfnSink {
    meters: Mutex<Option<Tsfn<MeterOut>>>,
    events: Mutex<Option<Tsfn<EventOut>>>,
    frames: Mutex<Option<Tsfn<FramesOut>>>,
    audio: Mutex<Option<Tsfn<AudioOut>>>,
}

impl Sink for TsfnSink {
    fn meters(&self, meters: MeterOut) {
        if let Some(f) = self.meters.lock().unwrap().as_ref() {
            f.call(meters, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    fn event(&self, event: EventOut) {
        if let Some(f) = self.events.lock().unwrap().as_ref() {
            f.call(event, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    fn frames(&self, frames: FramesOut) {
        if let Some(f) = self.frames.lock().unwrap().as_ref() {
            f.call(frames, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    fn audio(&self, audio: AudioOut) {
        if let Some(f) = self.audio.lock().unwrap().as_ref() {
            f.call(audio, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }
}

static SINK: OnceLock<Arc<TsfnSink>> = OnceLock::new();
static ENGINE: OnceLock<Engine> = OnceLock::new();

fn sink() -> &'static Arc<TsfnSink> {
    SINK.get_or_init(|| Arc::new(TsfnSink::default()))
}

fn engine() -> &'static Engine {
    ENGINE.get_or_init(|| Engine::start(sink().clone()))
}

fn js_error(e: EngineError) -> Error {
    Error::from_reason(e.to_string())
}

fn js_devices(list: DeviceList) -> JsDevices {
    let map = |v: Vec<crate::engine::DeviceInfo>| v.into_iter().map(|d| JsDevice { id: d.id, label: d.label, channels: d.channels }).collect();
    JsDevices { capture: map(list.capture), playback: map(list.playback) }
}

pub struct AvailableTask;
impl Task for AvailableTask {
    type Output = JsAvailable;
    type JsValue = JsAvailable;
    fn compute(&mut self) -> Result<JsAvailable> {
        Ok(match jack::list_devices() {
            Ok(_) => JsAvailable { ok: true, reason: None },
            Err(e) => JsAvailable { ok: false, reason: Some(e.to_string()) },
        })
    }
    fn resolve(&mut self, _: Env, out: JsAvailable) -> Result<JsAvailable> {
        Ok(out)
    }
}

/// Ожидание ответа движка в пуле потоков (один раз).
fn wait<T>(pending: &mut Option<Pending<T>>, timeout: Duration) -> Result<T> {
    pending.take().ok_or_else(|| Error::from_reason("FAILED: повторный вызов"))?.wait(timeout).map_err(js_error)
}

pub struct StatusTask(Option<Pending<Status>>);
impl Task for StatusTask {
    type Output = Status;
    type JsValue = JsStatus;
    fn compute(&mut self) -> Result<Status> {
        wait(&mut self.0, Duration::from_secs(2))
    }
    fn resolve(&mut self, _: Env, s: Status) -> Result<JsStatus> {
        Ok(JsStatus { open: s.open, buffer_frames: s.buffer_frames, capture_id: s.capture_id })
    }
}

pub struct ListTask(Option<Pending<DeviceList>>);
impl Task for ListTask {
    type Output = DeviceList;
    type JsValue = JsDevices;
    fn compute(&mut self) -> Result<DeviceList> {
        wait(&mut self.0, Duration::from_secs(5))
    }
    fn resolve(&mut self, _: Env, out: DeviceList) -> Result<JsDevices> {
        Ok(js_devices(out))
    }
}

pub struct OpenTask(Option<Pending<OpenInfo>>);
impl Task for OpenTask {
    type Output = OpenInfo;
    type JsValue = JsOpenInfo;
    fn compute(&mut self) -> Result<OpenInfo> {
        wait(&mut self.0, Duration::from_secs(10))
    }
    fn resolve(&mut self, _: Env, o: OpenInfo) -> Result<JsOpenInfo> {
        Ok(JsOpenInfo {
            backend: "jack".into(),
            sample_rate: o.sample_rate,
            buffer_frames: o.buffer_frames,
            requested_frames: o.requested_frames,
            capture_latency_frames: o.capture_latency_frames,
            playback_latency_frames: o.playback_latency_frames,
            capture_id: o.capture_id,
            capture_label: o.capture_label,
            capture_channels: o.capture_channels,
            playback_id: o.playback_id,
            playback_label: o.playback_label,
        })
    }
}

pub struct CloseTask(Option<Pending<()>>);
impl Task for CloseTask {
    type Output = ();
    type JsValue = ();
    fn compute(&mut self) -> Result<()> {
        wait(&mut self.0, Duration::from_secs(5))
    }
    fn resolve(&mut self, _: Env, _: ()) -> Result<()> {
        Ok(())
    }
}

pub struct RtlTask(Option<Pending<RtlOut>>, u16);
impl Task for RtlTask {
    type Output = RtlOut;
    type JsValue = JsRtl;
    fn compute(&mut self) -> Result<RtlOut> {
        wait(&mut self.0, Engine::rtl_timeout(self.1))
    }
    fn resolve(&mut self, _: Env, r: RtlOut) -> Result<JsRtl> {
        Ok(JsRtl { delays_frames: r.delays, median_frames: r.median_frames, median_ms: r.median_ms, misses: r.misses })
    }
}

/// Есть ли JACK (libjack грузится, сервер отвечает).
#[napi(ts_return_type = "Promise<JsAvailable>")]
pub fn available() -> AsyncTask<AvailableTask> {
    AsyncTask::new(AvailableTask)
}

/// Открыт ли движок, квант и устройство (диагностика, e2e).
#[napi(ts_return_type = "Promise<JsStatus>")]
pub fn status() -> AsyncTask<StatusTask> {
    AsyncTask::new(StatusTask(Some(engine().send_status())))
}

#[napi(ts_return_type = "Promise<JsDevices>")]
pub fn list_devices() -> AsyncTask<ListTask> {
    AsyncTask::new(ListTask(Some(engine().send_list())))
}

#[napi(ts_return_type = "Promise<JsOpenInfo>")]
pub fn open(options: JsOpenOptions) -> AsyncTask<OpenTask> {
    AsyncTask::new(OpenTask(Some(engine().send_open(OpenOptions {
        capture: options.capture,
        playback: options.playback,
        channel: options.channel,
        buffer_frames: options.buffer_frames.clamp(16, 4096),
        monitor_gain: options.monitor_gain as f32,
        mute: options.mute.unwrap_or(false),
        loopback: options.loopback.unwrap_or(false),
        tone: tone_pairs(options.tone),
    }))))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn close() -> AsyncTask<CloseTask> {
    AsyncTask::new(CloseTask(Some(engine().send_close())))
}

#[napi]
pub fn set(options: JsSetOptions) {
    engine().set(SetOptions {
        channel: options.channel,
        monitor_gain: options.monitor_gain.map(|g| g as f32),
        mute: options.mute,
        tone: tone_pairs(options.tone),
        record: options.record,
    });
}

#[napi(ts_return_type = "Promise<JsRtl>")]
pub fn measure_rtl(clicks: u32) -> AsyncTask<RtlTask> {
    let clicks = clicks.clamp(1, crate::rtl::MAX_CLICKS as u32) as u16;
    AsyncTask::new(RtlTask(Some(engine().send_rtl(clicks)), clicks))
}

#[napi(ts_args_type = "onMeters: (meters: JsMeters) => void")]
pub fn on_meters(callback: JsFunction) -> Result<()> {
    let tsfn: Tsfn<MeterOut> = callback.create_threadsafe_function(64, |ctx| {
        let m: MeterOut = ctx.value;
        Ok(vec![JsMeters {
            frames: m.frames as f64,
            peak: vec![f64::from(m.peak[0]), f64::from(m.peak[1])],
            dry_peak: f64::from(m.dry_peak),
            dry_rms: f64::from(m.dry_rms),
            clipped: m.clipped,
            xruns: m.xruns,
            load: f64::from(m.load),
            buffer_frames: m.buffer_frames,
            capture_latency_frames: m.capture_latency_frames,
            playback_latency_frames: m.playback_latency_frames,
        }])
    })?;
    *sink().meters.lock().unwrap() = Some(tsfn);
    Ok(())
}

#[napi(ts_args_type = "onFrames: (frames: JsFrames) => void")]
pub fn on_frames(callback: JsFunction) -> Result<()> {
    let tsfn: Tsfn<FramesOut> = callback.create_threadsafe_function(64, |ctx| {
        let batch: FramesOut = ctx.value;
        let mut flat = Vec::with_capacity(batch.frames.len() * 5);
        for f in &batch.frames {
            flat.extend_from_slice(&[f.at_us, f64::from(f.midi), f64::from(f.clarity), f64::from(f.level_db), if f.onset { 1.0 } else { 0.0 }]);
        }
        Ok(vec![JsFrames { now_us: batch.now_us, frames: Float64Array::new(flat) }])
    })?;
    *sink().frames.lock().unwrap() = Some(tsfn);
    Ok(())
}

#[napi(ts_args_type = "onAudio: (audio: JsAudio) => void")]
pub fn on_audio(callback: JsFunction) -> Result<()> {
    // очередь — ≈ 6 с записи кусками по 100 мс: рендерер занят — куски ждут, а не теряются
    let tsfn: Tsfn<AudioOut> = callback.create_threadsafe_function(64, |ctx| {
        let audio: AudioOut = ctx.value;
        Ok(vec![JsAudio { sample_rate: audio.sample_rate, samples: Float32Array::new(audio.samples) }])
    })?;
    *sink().audio.lock().unwrap() = Some(tsfn);
    Ok(())
}

#[napi(ts_args_type = "onEvent: (event: JsEvent) => void")]
pub fn on_event(callback: JsFunction) -> Result<()> {
    let tsfn: Tsfn<EventOut> = callback.create_threadsafe_function(64, |ctx| {
        let event = match ctx.value {
            EventOut::DeviceLost(device) => JsEvent { kind: "device-lost".into(), device: Some(device), buffer_frames: None, requested_frames: None, reason: None },
            EventOut::DeviceBack(device) => JsEvent { kind: "device-back".into(), device: Some(device), buffer_frames: None, requested_frames: None, reason: None },
            EventOut::Reopened { buffer_frames, requested_frames, reason } => JsEvent {
                kind: "reopened".into(),
                device: None,
                buffer_frames: Some(buffer_frames),
                requested_frames: Some(requested_frames),
                reason: Some(reason),
            },
            EventOut::Shutdown(reason) => JsEvent { kind: "shutdown".into(), device: None, buffer_frames: None, requested_frames: None, reason: Some(reason) },
        };
        Ok(vec![event])
    })?;
    *sink().events.lock().unwrap() = Some(tsfn);
    Ok(())
}
