// Ввод-вывод через JACK (01-architecture §8.2, этап 41b); у PipeWire — pipewire-jack. Один клиент «Pupitre»: два
// входа, два выхода, один process-колбэк — настоящий дуплекс. Квант запрашивается только для своего клиента:
// PIPEWIRE_LATENCY="<N>/48000" до jack_client_open (системные clock.force-quantum не трогаем), фактический — buffer_size.
// Устройства — клиенты JACK с физическими портами (у PipeWire — узлы с описанием), подключение — по именам портов.
// Уведомления (появление и уход клиентов, срывы, конец сервера) идут в поток управления через mpsc.
use std::fmt;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use jack::{AudioIn, AudioOut, Client, ClientOptions, Control, LatencyType, Port, PortFlags, PortSpec, ProcessScope, Unowned};

use crate::analysis::Stamp;
use crate::graph::{graph, Command, Event, Graph};

pub const CLIENT_NAME: &str = "Pupitre";
/// Клиент-петля самопроверки — своё имя: под занятым сервер переименовывает клиента, и имена портов «угадывать» нельзя.
pub const LOOP_NAME: &str = "Pupitre loop";

#[derive(Debug, Clone, PartialEq)]
pub enum EngineError {
    /// libjack не загрузился или сервер недоступен — работать на браузере.
    NoEngine(String),
    /// Устройства нет.
    NotFound(String),
    Failed(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::NoEngine(m) => write!(f, "NO_ENGINE: {m}"),
            EngineError::NotFound(m) => write!(f, "NOT_FOUND: {m}"),
            EngineError::Failed(m) => write!(f, "FAILED: {m}"),
        }
    }
}

fn failed<E: fmt::Display>(e: E) -> EngineError {
    EngineError::Failed(e.to_string())
}

#[derive(Debug, Clone, PartialEq)]
pub struct Device {
    /// Имя клиента JACK.
    pub id: String,
    pub label: String,
    /// Полные имена портов по порядку (capture_FL, capture_FR …).
    pub ports: Vec<String>,
}

/// Порядок каналов порта: FL, FR, FC, LFE, тылы; MONO и AUXn — по номеру; прочее — по имени после известных.
fn channel_order(port: &str) -> (u32, String) {
    let short = port.rsplit_once(':').map_or(port, |(_, s)| s);
    let suffix = short.rsplit_once('_').map_or(short, |(_, s)| s);
    const ORDER: [&str; 11] = ["MONO", "FL", "FR", "FC", "LFE", "RL", "RR", "SL", "SR", "RC", "TC"];
    if let Some(i) = ORDER.iter().position(|&o| o == suffix) {
        return (i as u32, String::new());
    }
    if let Some(n) = suffix.strip_prefix("AUX").and_then(|n| n.parse::<u32>().ok()) {
        return (100 + n, String::new());
    }
    (1000, short.to_string())
}

/// Устройства с физическими портами: (захват, воспроизведение). Мониторы выходов (monitor_*) — не входы.
pub fn devices(client: &Client) -> (Vec<Device>, Vec<Device>) {
    let spec = AudioIn::default();
    let audio = spec.jack_port_type();
    let group = |flags: PortFlags| {
        let mut out: Vec<Device> = Vec::new();
        for name in client.ports(None, Some(audio), flags) {
            let Some((owner, short)) = name.rsplit_once(':') else { continue };
            if short.starts_with("monitor_") || owner == client.name() {
                continue;
            }
            match out.iter_mut().find(|d| d.id == owner) {
                Some(device) => device.ports.push(name.clone()),
                None => out.push(Device { id: owner.to_string(), label: owner.to_string(), ports: vec![name.clone()] }),
            }
        }
        for device in &mut out {
            device.ports.sort_by_key(|p| channel_order(p));
        }
        out
    };
    (group(PortFlags::IS_PHYSICAL | PortFlags::IS_OUTPUT), group(PortFlags::IS_PHYSICAL | PortFlags::IS_INPUT))
}

/// Временный клиент — только перечислить устройства.
pub fn list_devices() -> Result<(Vec<Device>, Vec<Device>), EngineError> {
    let client = open_client(None)?;
    Ok(devices(&client))
}

fn open_client(buffer_frames: Option<u32>) -> Result<Client, EngineError> {
    open_named(CLIENT_NAME, buffer_frames)
}

/// Переменная кванта клиента: pipewire-jack читает её при открытии клиента (другие программы и система не меняются).
pub const LATENCY_VAR: &str = "PIPEWIRE_LATENCY";

fn open_named(name: &str, buffer_frames: Option<u32>) -> Result<Client, EngineError> {
    // Только замена значения: вставка новой переменной из многопоточного процесса перераспределяет массив окружения под
    // getenv других потоков (гонка); хозяин процесса (apps/desktop: main.js) создаёт её при запуске. glibc при замене
    // переставляет указатель и старое значение не освобождает. Нет переменной — квант графа как есть («получено»).
    if let (Some(n), Some(_)) = (buffer_frames, std::env::var_os(LATENCY_VAR)) {
        std::env::set_var(LATENCY_VAR, format!("{n}/48000"));
    }
    match Client::new(name, ClientOptions::NO_START_SERVER) {
        Ok((client, _status)) => Ok(client),
        Err(jack::Error::LibraryError(m)) => Err(EngineError::NoEngine(format!("libjack не загрузился: {m}"))),
        Err(e) => Err(EngineError::NoEngine(format!("сервер JACK/PipeWire недоступен: {e}"))),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenOptions {
    /// None — первое устройство захвата.
    pub capture: Option<String>,
    /// None — выходы того же устройства, иначе первое устройство воспроизведения.
    pub playback: Option<String>,
    pub channel: i32,
    pub buffer_frames: u32,
    pub monitor_gain: f32,
    /// Мониторинг заглушён (переживает переоткрытие лестницей буфера).
    pub mute: bool,
    /// Самопроверка без устройств: выход движка → клиент-петля → вход движка (ровно один квант; прямое соединение
    /// выхода клиента с его же входом PipeWire показывает, но данные по нему не идут).
    pub loopback: bool,
    /// Параметры процессора (номер, значение) — применяются к новому графу при открытии и переоткрытии.
    pub tone: Vec<(u32, f32)>,
}

#[derive(Debug, Clone)]
pub enum Notice {
    ClientGone(String),
    ClientBack(String),
    Shutdown(String),
}

struct Notify {
    tx: mpsc::Sender<Notice>,
    xruns: Arc<AtomicU32>,
}

impl jack::NotificationHandler for Notify {
    fn client_registration(&mut self, _: &Client, name: &str, is_registered: bool) {
        let notice = if is_registered { Notice::ClientBack(name.to_string()) } else { Notice::ClientGone(name.to_string()) };
        let _ = self.tx.send(notice);
    }

    fn xrun(&mut self, _: &Client) -> Control {
        self.xruns.fetch_add(1, Ordering::Relaxed);
        Control::Continue
    }

    unsafe fn shutdown(&mut self, _status: jack::ClientStatus, reason: &str) {
        let _ = self.tx.send(Notice::Shutdown(reason.to_string()));
    }
}

struct Process {
    in0: Port<AudioIn>,
    in1: Port<AudioIn>,
    out0: Port<AudioOut>,
    out1: Port<AudioOut>,
    graph: Graph,
    rate: f32,
    buffer: Arc<AtomicU32>,
    /// Метки циклов потоку анализа: номер первого кадра цикла и время его начала (часы JACK).
    stamps: rtrb::Producer<Stamp>,
}

impl jack::ProcessHandler for Process {
    fn process(&mut self, _: &Client, scope: &ProcessScope) -> Control {
        let started = Instant::now();
        if let Ok(times) = scope.cycle_times() {
            let _ = self.stamps.push(Stamp { frame: self.graph.frames(), usecs: times.current_usecs });
        }
        let (a, b) = (self.in0.as_slice(scope), self.in1.as_slice(scope));
        let (l, r) = (self.out0.as_mut_slice(scope), self.out1.as_mut_slice(scope));
        self.graph.process(a, b, l, r);
        let period = scope.n_frames() as f32 / self.rate;
        self.graph.note_load(started.elapsed().as_secs_f32() / period);
        Control::Continue
    }

    fn buffer_size(&mut self, _: &Client, size: jack::Frames) -> Control {
        self.buffer.store(size, Ordering::Relaxed);
        Control::Continue
    }
}

/// Клиент-петля самопроверки: вход копируется на выход.
pub struct LoopProcess {
    input: Port<AudioIn>,
    output: Port<AudioOut>,
}

impl jack::ProcessHandler for LoopProcess {
    fn process(&mut self, _: &Client, scope: &ProcessScope) -> Control {
        self.output.as_mut_slice(scope).copy_from_slice(self.input.as_slice(scope));
        Control::Continue
    }
}

pub struct Session {
    client: jack::AsyncClient<Notify, Process>,
    /// Клиент-петля и его порты (вход, выход).
    looper: Option<(jack::AsyncClient<(), LoopProcess>, [Port<Unowned>; 2])>,
    pub commands: rtrb::Producer<Command>,
    pub events: rtrb::Consumer<Event>,
    /// Сухой сигнал и метки циклов — потоку анализа.
    pub taps: rtrb::Consumer<f32>,
    pub stamps: rtrb::Consumer<Stamp>,
    pub notices: mpsc::Receiver<Notice>,
    pub xruns: Arc<AtomicU32>,
    pub buffer: Arc<AtomicU32>,
    pub options: OpenOptions,
    pub capture: Option<Device>,
    pub playback: Option<Device>,
    pub sample_rate: u32,
    ins: [Port<Unowned>; 2],
    outs: [Port<Unowned>; 2],
}

impl Session {
    pub fn open(options: OpenOptions) -> Result<Session, EngineError> {
        let client = open_client(Some(options.buffer_frames))?;
        let (captures, playbacks) = devices(&client);
        let capture = if options.loopback {
            None
        } else {
            match &options.capture {
                Some(id) => Some(captures.iter().find(|d| &d.id == id).cloned().ok_or_else(|| EngineError::NotFound(id.clone()))?),
                None => Some(captures.first().cloned().ok_or_else(|| EngineError::NotFound("нет устройств захвата".into()))?),
            }
        };
        let playback = if options.loopback {
            None
        } else {
            match &options.playback {
                Some(id) => Some(playbacks.iter().find(|d| &d.id == id).cloned().ok_or_else(|| EngineError::NotFound(id.clone()))?),
                // «то же устройство, что и вход»; у устройства нет выходов (USB-микрофон) — мониторинга нет, пока игрок не
                // выберет выход сам (а не первый попавшийся)
                None => capture.as_ref().and_then(|c| playbacks.iter().find(|d| d.id == c.id)).cloned(),
            }
        };

        let in0 = client.register_port("in_1", AudioIn::default()).map_err(failed)?;
        let in1 = client.register_port("in_2", AudioIn::default()).map_err(failed)?;
        let out0 = client.register_port("out_L", AudioOut::default()).map_err(failed)?;
        let out1 = client.register_port("out_R", AudioOut::default()).map_err(failed)?;
        let ins = [in0.clone_unowned(), in1.clone_unowned()];
        let outs = [out0.clone_unowned(), out1.clone_unowned()];

        let sample_rate = client.sample_rate() as u32;
        let (graph, mut commands, events, taps) = graph(sample_rate as f32);
        let (stamps_tx, stamps) = rtrb::RingBuffer::new(1024);
        let channels = capture.as_ref().map_or(1, |c| c.ports.len().min(2) as u8);
        for command in [
            Command::Channel(options.channel),
            Command::CaptureChannels(channels),
            Command::Mute(options.mute),
            Command::MonitorGain(options.monitor_gain),
        ] {
            commands.push(command).map_err(failed)?;
        }
        for &(id, value) in &options.tone {
            commands.push(Command::Tone(id, value)).map_err(failed)?;
        }
        let xruns = Arc::new(AtomicU32::new(0));
        let buffer = Arc::new(AtomicU32::new(client.buffer_size()));
        let (tx, notices) = mpsc::channel();
        let process = Process { in0, in1, out0, out1, graph, rate: sample_rate as f32, buffer: buffer.clone(), stamps: stamps_tx };
        let client = client.activate_async(Notify { tx, xruns: xruns.clone() }, process).map_err(failed)?;
        let looper = if options.loopback {
            let looper = open_named(LOOP_NAME, None)?;
            let input = looper.register_port("in", AudioIn::default()).map_err(failed)?;
            let output = looper.register_port("out", AudioOut::default()).map_err(failed)?;
            let ports = [input.clone_unowned(), output.clone_unowned()];
            Some((looper.activate_async((), LoopProcess { input, output }).map_err(failed)?, ports))
        } else {
            None
        };
        let session = Session { client, looper, commands, events, taps, stamps, notices, xruns, buffer, options, capture, playback, sample_rate, ins, outs };
        session.connect()?;
        Ok(session)
    }

    fn port_name(port: &Port<Unowned>) -> Result<String, EngineError> {
        port.name().map_err(failed)
    }

    /// Подключить порты к устройствам (повторное подключение уже соединённых — не ошибка).
    pub fn connect(&self) -> Result<(), EngineError> {
        let client = self.client.as_client();
        let link = |from: &str, to: &str| match client.connect_ports_by_name(from, to) {
            Ok(()) | Err(jack::Error::PortAlreadyConnected(_, _)) => Ok(()),
            Err(e) => Err(EngineError::Failed(format!("{from} → {to}: {e}"))),
        };
        let (in0, in1) = (Self::port_name(&self.ins[0])?, Self::port_name(&self.ins[1])?);
        let (out0, out1) = (Self::port_name(&self.outs[0])?, Self::port_name(&self.outs[1])?);
        if let Some((_, [input, output])) = &self.looper {
            // порты только что запущенного клиента другие клиенты видят не сразу — повторы до секунды
            let (input, output) = (Self::port_name(input)?, Self::port_name(output)?);
            let deadline = Instant::now() + Duration::from_secs(1);
            loop {
                match link(&out0, &input).and_then(|()| link(&output, &in0)) {
                    Ok(()) => return Ok(()),
                    Err(e) if Instant::now() >= deadline => return Err(e),
                    Err(_) => std::thread::sleep(Duration::from_millis(10)),
                }
            }
        }
        if let Some(capture) = &self.capture {
            link(&capture.ports[0], &in0)?;
            if let Some(second) = capture.ports.get(1) {
                link(second, &in1)?;
            }
        }
        if let Some(playback) = &self.playback {
            link(&out0, &playback.ports[0])?;
            // у моно-выхода — один порт: второй канал на него же сложил бы L + R (+6 дБ, мимо мягкого ограничения)
            if let Some(second) = playback.ports.get(1) {
                link(&out1, second)?;
            }
        }
        Ok(())
    }

    /// Устройство вернулось: обновить имена портов и подключить заново. false — портов ещё нет.
    pub fn reconnect(&mut self) -> Result<bool, EngineError> {
        let (captures, playbacks) = devices(self.client.as_client());
        if let Some(capture) = &mut self.capture {
            match captures.into_iter().find(|d| d.id == capture.id) {
                Some(found) => *capture = found,
                None => return Ok(false),
            }
        }
        if let Some(playback) = &mut self.playback {
            if let Some(found) = playbacks.into_iter().find(|d| d.id == playback.id) {
                *playback = found;
            }
        }
        self.connect()?;
        Ok(true)
    }

    pub fn client_ref(&self) -> &Client {
        self.client.as_client()
    }

    pub fn buffer_frames(&self) -> u32 {
        self.buffer.load(Ordering::Relaxed)
    }

    /// Задержки по отчёту JACK, кадры: (вход устройства → движок, движок → выход устройства). Сервер пересчитывает их
    /// после подключения портов — короткое ожидание, пока значения не появятся.
    pub fn latencies(&self, wait: Duration) -> (u32, u32) {
        let deadline = Instant::now() + wait;
        loop {
            let capture = self.ins[0].get_latency_range(LatencyType::Capture).1;
            let playback = self.outs[0].get_latency_range(LatencyType::Playback).1;
            if (capture > 0 || self.capture.is_none()) && (playback > 0 || self.playback.is_none()) || Instant::now() >= deadline {
                return (capture, playback);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Сервер остановился: клиента не закрывать, а бросить — jack_client_close после конца сервера в pipewire-jack 1.6.5
    /// падает (двойное освобождение в pw_memmap_free) и роняет процесс. Утекают несколько потоков и дескрипторов — раз
    /// на остановку сервера.
    pub fn forget(self) {
        std::mem::forget(self);
    }

    /// Закрыть клиенты: сначала петлю, затем основной. Не deactivate(): в jack 0.13 она освобождает контекст колбэков
    /// до jack_client_close и снимает только колбэк процесса — уведомление (появился или ушёл чужой клиент, срыв),
    /// пришедшее в этом окне, читает освобождённую память (SIGSEGV всего Electron). Drop закрывает клиент раньше, чем
    /// освобождает контекст.
    pub fn close(self) {
        drop(self.looper);
        drop(self.client);
    }
}

#[cfg(test)]
mod tests {
    use super::channel_order;

    #[test]
    fn ports_in_channel_order() {
        let mut ports = vec!["d:playback_FC", "d:playback_FR", "d:playback_LFE", "d:playback_FL"];
        ports.sort_by_key(|p| channel_order(p));
        assert_eq!(ports, ["d:playback_FL", "d:playback_FR", "d:playback_FC", "d:playback_LFE"]);
        let mut aux = vec!["i:capture_AUX10", "i:capture_AUX2", "i:capture_AUX0"];
        aux.sort_by_key(|p| channel_order(p));
        assert_eq!(aux, ["i:capture_AUX0", "i:capture_AUX2", "i:capture_AUX10"]);
    }
}
