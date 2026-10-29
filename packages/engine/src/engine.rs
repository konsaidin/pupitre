// Поток управления движком: один поток владеет клиентом JACK (открытие, закрытие, переоткрытие) — команды приходят из
// N-API через mpsc, ответы — через свои каналы. Метры из аудиопотока (rtrb) сводятся и уходят наружу ≈ 30 раз в
// секунду; уход и возврат устройства (клиент JACK) — события и переподключение портов; срывы: 3 за 10 с — буфер
// вдвое (64 → 128 → 256, «лестница» §8.2); замер задержки — щелчками в аудиопотоке.
use std::collections::VecDeque;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::analysis::{Analysis, FrameOut, Stamp};
use crate::graph::{Command, Event, Meter};
use crate::io::jack::{self, Device, EngineError, Notice, OpenOptions, Session};
use crate::rtl::RtlReport;

#[derive(Debug, Clone, PartialEq)]
pub struct DeviceInfo {
    pub id: String,
    pub label: String,
    pub channels: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeviceList {
    pub capture: Vec<DeviceInfo>,
    pub playback: Vec<DeviceInfo>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenInfo {
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

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct MeterOut {
    pub frames: u64,
    pub peak: [f32; 2],
    pub dry_peak: f32,
    pub dry_rms: f32,
    pub clipped: bool,
    pub xruns: u32,
    pub load: f32,
    pub buffer_frames: u32,
    /// Отчёт драйвера, кадры: квант устанавливается после подключения — значения при открытии устаревают.
    pub capture_latency_frames: u32,
    pub playback_latency_frames: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum EventOut {
    DeviceLost(String),
    DeviceBack(String),
    Reopened { buffer_frames: u32, requested_frames: u32, reason: String },
    Shutdown(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct RtlOut {
    pub delays: Vec<u32>,
    pub median_frames: u32,
    pub median_ms: f64,
    pub misses: u32,
}

/// Кадры анализа за проход потока управления и время часов JACK в момент отправки (рендерер сводит часы).
#[derive(Debug, Clone, PartialEq)]
pub struct FramesOut {
    pub now_us: f64,
    pub frames: Vec<FrameOut>,
}

/// Куда движок отдаёт метры, события и кадры анализа (N-API — потокобезопасные функции JS).
pub trait Sink: Send + Sync + 'static {
    fn meters(&self, meters: MeterOut);
    fn event(&self, event: EventOut);
    fn frames(&self, frames: FramesOut);
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SetOptions {
    pub channel: Option<i32>,
    pub monitor_gain: Option<f32>,
    pub mute: Option<bool>,
    /// Изменённые параметры процессора: (номер, значение).
    pub tone: Vec<(u32, f32)>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Status {
    pub open: bool,
    pub buffer_frames: u32,
    pub capture_id: String,
}

/// Ответ движка, который ещё придёт.
pub struct Pending<T> {
    answer: Option<mpsc::Receiver<Result<T, EngineError>>>,
}

impl<T> Pending<T> {
    pub fn wait(self, timeout: Duration) -> Result<T, EngineError> {
        let answer = self.answer.ok_or_else(|| EngineError::Failed("движок остановлен".into()))?;
        answer.recv_timeout(timeout).map_err(|_| EngineError::Failed("движок не ответил".into()))?
    }
}

/// Ответ на закрытие — всегда Ok (общий тип каналов ответа).
struct SyncSenderOk(SyncSender<Result<(), EngineError>>);

enum Msg {
    Status(SyncSender<Result<Status, EngineError>>),
    List(SyncSender<Result<DeviceList, EngineError>>),
    Open(OpenOptions, SyncSender<Result<OpenInfo, EngineError>>),
    Close(SyncSenderOk),
    Set(SetOptions),
    Rtl(u16, SyncSender<Result<RtlOut, EngineError>>),
}

const METER_PERIOD: Duration = Duration::from_millis(33);

/// Текущие параметры процессора (переживают переоткрытие): новые значения поверх, по номеру.
fn merge_tone(current: &mut Vec<(u32, f32)>, changes: &[(u32, f32)]) {
    for &(id, value) in changes {
        match current.iter_mut().find(|(i, _)| *i == id) {
            Some(slot) => slot.1 = value,
            None => current.push((id, value)),
        }
    }
}

/// PUPITRE_ENGINE_TRACE=1 — длительность операций потока управления в stderr (диагностика зависаний).
fn trace(what: &str, started: Instant) {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if *ON.get_or_init(|| std::env::var_os("PUPITRE_ENGINE_TRACE").is_some()) {
        eprintln!("[engine] {what}: {:.1} мс", started.elapsed().as_secs_f64() * 1000.0);
    }
}
const XRUN_WINDOW: Duration = Duration::from_secs(10);
const XRUN_LIMIT: usize = 3;
const MAX_LADDER_FRAMES: u32 = 256;
const BACK_RETRY: Duration = Duration::from_millis(100);
const BACK_GIVE_UP: Duration = Duration::from_secs(5);
const LATENCY_PERIOD: Duration = Duration::from_millis(500);
const RTL_INTERVAL_S: f64 = 0.25;
const RTL_TIMEOUT_S: f64 = 0.2;

pub struct Engine {
    tx: Option<Sender<Msg>>,
    join: Option<JoinHandle<()>>,
}

fn info(d: &Device) -> DeviceInfo {
    DeviceInfo { id: d.id.clone(), label: d.label.clone(), channels: d.ports.len() as u32 }
}

impl Engine {
    pub fn start(sink: Arc<dyn Sink>) -> Engine {
        let (tx, rx) = mpsc::channel();
        let join = std::thread::Builder::new()
            .name("pupitre-engine".into())
            .spawn(move || Actor::new(sink).run(rx))
            .expect("поток движка");
        Engine { tx: Some(tx), join: Some(join) }
    }

    /// Отправить команду сейчас (порядок команд = порядок вызовов), ответ — потом: N-API ждёт его в пуле потоков, и
    /// close с последующим open не меняются местами.
    fn send<T>(&self, make: impl FnOnce(SyncSender<Result<T, EngineError>>) -> Msg) -> Pending<T> {
        let (reply, answer) = mpsc::sync_channel(1);
        let sent = self.tx.as_ref().is_some_and(|tx| tx.send(make(reply)).is_ok());
        Pending { answer: sent.then_some(answer) }
    }

    fn call<T>(&self, make: impl FnOnce(SyncSender<Result<T, EngineError>>) -> Msg, timeout: Duration) -> Result<T, EngineError> {
        self.send(make).wait(timeout)
    }

    pub fn send_status(&self) -> Pending<Status> {
        self.send(Msg::Status)
    }

    pub fn send_list(&self) -> Pending<DeviceList> {
        self.send(Msg::List)
    }

    pub fn send_open(&self, options: OpenOptions) -> Pending<OpenInfo> {
        self.send(|reply| Msg::Open(options, reply))
    }

    pub fn send_close(&self) -> Pending<()> {
        self.send(|reply| Msg::Close(SyncSenderOk(reply)))
    }

    pub fn send_rtl(&self, clicks: u16) -> Pending<RtlOut> {
        self.send(|reply| Msg::Rtl(clicks, reply))
    }

    /// Сколько ждать ответа на замер.
    pub fn rtl_timeout(clicks: u16) -> Duration {
        Duration::from_secs_f64(f64::from(clicks) * RTL_INTERVAL_S + 3.0)
    }

    pub fn status(&self) -> Result<Status, EngineError> {
        self.call(Msg::Status, Duration::from_secs(2))
    }

    pub fn list(&self) -> Result<DeviceList, EngineError> {
        self.call(Msg::List, Duration::from_secs(5))
    }

    pub fn open(&self, options: OpenOptions) -> Result<OpenInfo, EngineError> {
        self.call(|reply| Msg::Open(options, reply), Duration::from_secs(10))
    }

    pub fn close(&self) {
        let _ = self.send_close().wait(Duration::from_secs(5));
    }

    pub fn set(&self, options: SetOptions) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(Msg::Set(options));
        }
    }

    pub fn measure_rtl(&self, clicks: u16) -> Result<RtlOut, EngineError> {
        self.send_rtl(clicks).wait(Self::rtl_timeout(clicks))
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.close();
        self.tx = None;
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Сводка пакетов метров между отправками: максимумы, перегруз — «был ли».
#[derive(Default)]
struct MeterAgg {
    n: u32,
    out: MeterOut,
}

impl MeterAgg {
    fn add(&mut self, m: Meter) {
        let o = &mut self.out;
        o.frames = m.frames;
        o.peak[0] = o.peak[0].max(m.peak[0]);
        o.peak[1] = o.peak[1].max(m.peak[1]);
        o.dry_peak = o.dry_peak.max(m.dry_peak);
        o.dry_rms = o.dry_rms.max(m.dry_rms);
        o.clipped |= m.clipped;
        o.load = o.load.max(m.load);
        self.n += 1;
    }
}

struct Actor {
    sink: Arc<dyn Sink>,
    session: Option<Session>,
    /// Текущие параметры (переживают переоткрытие).
    options: Option<OpenOptions>,
    mute: bool,
    agg: MeterAgg,
    sent_at: Instant,
    xrun_times: VecDeque<Instant>,
    seen_xruns: u32,
    /// Срывы прошлых сессий (до переоткрытия) — счётчик «за сессию» не сбрасывается.
    xruns_base: u32,
    rtl: Option<(SyncSender<Result<RtlOut, EngineError>>, Instant)>,
    lost: bool,
    /// Устройство выхода ушло (мониторинг молчит до его возврата).
    output_lost: bool,
    back_since: Option<Instant>,
    back_tried: Instant,
    latency: (u32, u32),
    latency_at: Instant,
    analysis: Option<Analysis>,
}

impl Actor {
    fn new(sink: Arc<dyn Sink>) -> Actor {
        Actor {
            sink,
            session: None,
            options: None,
            mute: false,
            agg: MeterAgg::default(),
            sent_at: Instant::now(),
            xrun_times: VecDeque::new(),
            seen_xruns: 0,
            xruns_base: 0,
            rtl: None,
            lost: false,
            output_lost: false,
            back_since: None,
            back_tried: Instant::now(),
            latency: (0, 0),
            latency_at: Instant::now(),
            analysis: None,
        }
    }

    fn run(mut self, rx: Receiver<Msg>) {
        loop {
            match rx.recv_timeout(Duration::from_millis(10)) {
                Ok(msg) => self.handle(msg),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            self.poll();
        }
        self.close_session();
    }

    fn handle(&mut self, msg: Msg) {
        let started = Instant::now();
        let name = match &msg {
            Msg::Status(_) => "status",
            Msg::List(_) => "list",
            Msg::Open(..) => "open",
            Msg::Close(_) => "close",
            Msg::Set(_) => "set",
            Msg::Rtl(..) => "rtl",
        };
        self.dispatch(msg);
        trace(name, started);
    }

    fn dispatch(&mut self, msg: Msg) {
        match msg {
            Msg::Status(reply) => {
                let status = self.session.as_ref().map_or_else(Status::default, |s| Status {
                    open: true,
                    buffer_frames: s.buffer_frames(),
                    capture_id: s.capture.as_ref().map_or_else(String::new, |d| d.id.clone()),
                });
                let _ = reply.send(Ok(status));
            }
            Msg::List(reply) => {
                // при открытом клиенте — его же списком (второй клиент не нужен)
                let lists = match &self.session {
                    Some(s) => Ok(jack::devices(s.client_ref())),
                    None => jack::list_devices(),
                };
                let _ = reply.send(lists.map(|(c, p)| DeviceList { capture: c.iter().map(info).collect(), playback: p.iter().map(info).collect() }));
            }
            Msg::Open(options, reply) => {
                self.close_session();
                self.xruns_base = 0;
                self.mute = options.mute;
                let result = self.open_session(options);
                let _ = reply.send(result);
            }
            Msg::Close(reply) => {
                self.close_session();
                self.options = None;
                let _ = reply.0.send(Ok(()));
            }
            Msg::Set(set) => {
                if let Some(options) = &mut self.options {
                    if let Some(c) = set.channel {
                        options.channel = c;
                    }
                    if let Some(g) = set.monitor_gain {
                        options.monitor_gain = g;
                    }
                    merge_tone(&mut options.tone, &set.tone);
                }
                if let Some(m) = set.mute {
                    self.mute = m;
                    if let Some(options) = &mut self.options {
                        options.mute = m;
                    }
                }
                if let Some(s) = &mut self.session {
                    if let Some(c) = set.channel {
                        let _ = s.commands.push(Command::Channel(c));
                    }
                    if let Some(g) = set.monitor_gain {
                        let _ = s.commands.push(Command::MonitorGain(g));
                    }
                    if let Some(m) = set.mute {
                        let _ = s.commands.push(Command::Mute(m));
                    }
                    for &(id, value) in &set.tone {
                        let _ = s.commands.push(Command::Tone(id, value));
                    }
                }
            }
            Msg::Rtl(clicks, reply) => match &mut self.session {
                None => {
                    let _ = reply.send(Err(EngineError::Failed("движок не открыт".into())));
                }
                Some(s) => {
                    let rate = f64::from(s.sample_rate);
                    let command = Command::StartRtl {
                        clicks,
                        interval: (RTL_INTERVAL_S * rate) as u32,
                        timeout: (RTL_TIMEOUT_S * rate) as u32,
                    };
                    match s.commands.push(command) {
                        Ok(()) => {
                            let deadline = Instant::now() + Duration::from_secs_f64(f64::from(clicks) * RTL_INTERVAL_S + 1.0);
                            self.rtl = Some((reply, deadline));
                        }
                        Err(_) => {
                            let _ = reply.send(Err(EngineError::Failed("очередь команд полна".into())));
                        }
                    }
                }
            },
        }
    }

    fn open_session(&mut self, options: OpenOptions) -> Result<OpenInfo, EngineError> {
        let session = Session::open(options.clone())?;
        let (capture_latency, playback_latency) = session.latencies(Duration::from_millis(200));
        let capture = session.capture.clone();
        let playback = session.playback.clone();
        let reply = OpenInfo {
            sample_rate: session.sample_rate,
            buffer_frames: session.buffer_frames(),
            requested_frames: options.buffer_frames,
            capture_latency_frames: capture_latency,
            playback_latency_frames: playback_latency,
            capture_id: capture.as_ref().map_or_else(String::new, |d| d.id.clone()),
            capture_label: capture.as_ref().map_or_else(String::new, |d| d.label.clone()),
            capture_channels: capture.as_ref().map_or(0, |d| d.ports.len().min(2) as u32),
            playback_id: playback.as_ref().map(|d| d.id.clone()),
            playback_label: playback.as_ref().map_or_else(String::new, |d| d.label.clone()),
        };
        self.session = Some(session);
        self.options = Some(options);
        self.latency = (capture_latency, playback_latency);
        self.latency_at = Instant::now();
        let mut analysis = Analysis::new(reply.sample_rate);
        analysis.set_capture_latency(capture_latency);
        self.analysis = Some(analysis);
        self.seen_xruns = 0;
        self.xrun_times.clear();
        self.lost = false;
        self.output_lost = false;
        self.back_since = None;
        self.agg = MeterAgg::default();
        Ok(reply)
    }

    fn close_session(&mut self) {
        self.analysis = None;
        if let Some(s) = self.session.take() {
            s.close();
        }
        if let Some((reply, _)) = self.rtl.take() {
            let _ = reply.send(Err(EngineError::Failed("движок закрыт".into())));
        }
    }

    fn poll(&mut self) {
        let Some(s) = &mut self.session else { return };
        // события аудиопотока
        while let Ok(event) = s.events.pop() {
            match event {
                Event::Meter(m) => self.agg.add(m),
                Event::Rtl(report) => {
                    if let Some((reply, _)) = self.rtl.take() {
                        let _ = reply.send(Ok(rtl_out(&report, s.sample_rate)));
                    }
                }
            }
        }
        // уведомления сервера: уход и возврат устройства входа (событие наружу) и выхода (молча переподключить)
        let mut shutdown = None;
        while let Ok(notice) = s.notices.try_recv() {
            let capture = s.capture.as_ref().map(|d| d.id.as_str());
            let playback = s.playback.as_ref().map(|d| d.id.as_str());
            match notice {
                Notice::ClientGone(name) if Some(name.as_str()) == capture => {
                    self.lost = true;
                    self.back_since = None;
                    self.sink.event(EventOut::DeviceLost(name));
                }
                Notice::ClientBack(name) if Some(name.as_str()) == capture && self.lost => {
                    self.back_since = Some(Instant::now());
                }
                Notice::ClientGone(name) if Some(name.as_str()) == playback => self.output_lost = true,
                Notice::ClientBack(name) if Some(name.as_str()) == playback && self.output_lost => {
                    self.back_since.get_or_insert_with(Instant::now);
                }
                Notice::Shutdown(reason) => shutdown = Some(reason),
                _ => {}
            }
        }
        if let Some(reason) = shutdown {
            // клиента не закрывать: после конца сервера jack_client_close в pipewire-jack падает (Session::forget)
            if let Some(dead) = self.session.take() {
                dead.forget();
            }
            self.analysis = None;
            if let Some((reply, _)) = self.rtl.take() {
                let _ = reply.send(Err(EngineError::Failed("сервер остановился".into())));
            }
            self.sink.event(EventOut::Shutdown(reason));
            return;
        }
        // устройство вернулось: порты появляются чуть позже клиента — повторы
        if let Some(since) = self.back_since {
            if self.back_tried.elapsed() >= BACK_RETRY {
                self.back_tried = Instant::now();
                match s.reconnect() {
                    Ok(true) => {
                        if self.lost {
                            let id = s.capture.as_ref().map_or_else(String::new, |d| d.id.clone());
                            self.sink.event(EventOut::DeviceBack(id));
                        }
                        self.lost = false;
                        self.output_lost = false;
                        self.back_since = None;
                    }
                    _ if since.elapsed() > BACK_GIVE_UP => self.back_since = None,
                    _ => {}
                }
            }
        }
        // метры наружу; отчёт драйвера о задержках — раз в полсекунды (квант мог смениться)
        if self.latency_at.elapsed() >= LATENCY_PERIOD {
            self.latency = s.latencies(Duration::ZERO);
            self.latency_at = Instant::now();
            if let Some(a) = &mut self.analysis {
                a.set_capture_latency(self.latency.0);
            }
        }
        // анализ: метки циклов, затем накопленный сухой сигнал → кадры наружу
        if let Some(a) = &mut self.analysis {
            let mut last: Option<Stamp> = None;
            while let Ok(stamp) = s.stamps.pop() {
                last = Some(stamp);
            }
            if let Some(stamp) = last {
                a.stamp(stamp);
            }
            let ready = s.taps.slots();
            if ready > 0 {
                if let Ok(chunk) = s.taps.read_chunk(ready) {
                    let (first, second) = chunk.as_slices();
                    let mut frames = Vec::new();
                    a.process(first, &mut frames);
                    a.process(second, &mut frames);
                    chunk.commit_all();
                    if !frames.is_empty() {
                        let now_us = s.client_ref().time() as f64;
                        self.sink.frames(FramesOut { now_us, frames });
                    }
                }
            }
        }
        let xruns = s.xruns.load(std::sync::atomic::Ordering::Relaxed);
        if self.agg.n > 0 && self.sent_at.elapsed() >= METER_PERIOD {
            let mut out = std::mem::take(&mut self.agg).out;
            out.xruns = self.xruns_base + xruns;
            out.buffer_frames = s.buffer_frames();
            (out.capture_latency_frames, out.playback_latency_frames) = self.latency;
            self.sent_at = Instant::now();
            self.sink.meters(out);
        }
        // замер задержки без ответа
        if let Some((_, deadline)) = &self.rtl {
            if Instant::now() > *deadline {
                let (reply, _) = self.rtl.take().unwrap();
                let _ = reply.send(Err(EngineError::Failed("щелчки не вернулись — нет петли выход → вход".into())));
            }
        }
        // лестница буфера
        let now = Instant::now();
        while self.seen_xruns < xruns {
            self.seen_xruns += 1;
            self.xrun_times.push_back(now);
        }
        while self.xrun_times.front().is_some_and(|t| now.duration_since(*t) > XRUN_WINDOW) {
            self.xrun_times.pop_front();
        }
        // от большего из запрошенного и фактического: квант держит другой клиент — переоткрывать незачем
        let base_frames = s.options.buffer_frames.max(s.buffer_frames());
        if self.xrun_times.len() >= XRUN_LIMIT && base_frames < MAX_LADDER_FRAMES && self.rtl.is_none() {
            let mut options = self.options.clone().unwrap_or_else(|| s.options.clone());
            options.buffer_frames = (base_frames * 2).min(MAX_LADDER_FRAMES);
            options.mute = self.mute;
            let base = self.xruns_base + xruns;
            self.close_session();
            match self.open_session(options.clone()) {
                Ok(info) => {
                    self.xruns_base = base;
                    self.sink.event(EventOut::Reopened {
                        buffer_frames: info.buffer_frames,
                        requested_frames: info.requested_frames,
                        reason: format!("срывы: {XRUN_LIMIT} за {} с", XRUN_WINDOW.as_secs()),
                    });
                }
                Err(e) => self.sink.event(EventOut::Shutdown(e.to_string())),
            }
        }
    }
}

fn rtl_out(report: &RtlReport, sample_rate: u32) -> RtlOut {
    let median = report.median().unwrap_or(0);
    RtlOut {
        delays: report.delays().to_vec(),
        median_frames: median,
        median_ms: f64::from(median) * 1000.0 / f64::from(sample_rate),
        misses: u32::from(report.misses),
    }
}
