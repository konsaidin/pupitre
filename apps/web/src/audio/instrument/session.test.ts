// Сессия входа на подменённых внешних API. Браузер: StrictMode (держатель снят и поставлен в одном коммите — один
// захват), отложенное закрытие, отмена ждущего и вытесненного открытия, сбой сборки графа, ошибки доступа и устройства,
// поиск по метке (двойников не угадываем), конец потока и одна повторная проба, возврат устройства, маршрут каналов,
// мониторинг, уровни (пик, перегруз по сырому каналу, тишина, порог по фону), опрос без шкал, замер фона, задержка.
// Движок: открытие и метры, события устройства, смена буфера, откат на браузер без JACK, поиск по метке.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audioSession', () => ({ stopMic: vi.fn() }));

import type { EngineApi, EngineEvent, EngineFrames, EngineMeters, EngineOpenOptions } from '../engine/EngineBridge';
import {
  acquireInput,
  configureInput,
  getInputSnapshot,
  listInputDevices,
  measureNoise,
  onDevicesChange,
  readLatency,
  onInputFrames,
  readLevel,
  requestInput,
  setInputPlatform,
  type InputConfig,
  type InputFrame,
  type InputPlatform,
} from './session';

class FakeNode {
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  gain = { value: 1, setTargetAtTime: (v: number) => void (this.gain.value = v) };
  links: Array<[FakeNode, number]> = [];
  constructor(
    readonly kind: string,
    private ctx: FakeContext,
    readonly role = '',
  ) {}
  connect(target: FakeNode, output = 0) {
    this.links.push([target, output]);
    return target;
  }
  disconnect(target?: FakeNode) {
    if (target && !this.links.some(([n]) => n === target)) throw new DOMException('нет такого соединения', 'InvalidAccessError');
    this.links = target ? this.links.filter(([n]) => n !== target) : [];
  }
  getFloatTimeDomainData(buf: Float32Array) {
    buf.set(this.ctx.signal(this.role).subarray(0, buf.length));
  }
}

class FakeContext {
  state = 'running';
  sampleRate = 48000;
  currentTime = 0;
  baseLatency = 0.01;
  outputLatency = 0.02;
  /** Сырые каналы входа. */
  ch: [Float32Array, Float32Array] = [new Float32Array(4096), new Float32Array(4096)];
  channels = 2;
  destination = new FakeNode('destination', this);
  nodes: FakeNode[] = [];
  private analysers = 0;
  private make(kind: string, role = '') {
    const node = new FakeNode(kind, this, role);
    this.nodes.push(node);
    return node;
  }
  createMediaStreamSource = () => this.make('source');
  createChannelSplitter = () => this.make('splitter');
  createGain = () => this.make('gain');
  createAnalyser = () => this.make('analyser', ['left', 'right', 'dry'][this.analysers++]);
  resume = async () => void (this.state = 'running');
  close = async () => void (this.state = 'closed');
  /** source, splitter, left, right, dry, pick, monitor — порядок webCapture(). */
  get graph() {
    const [source, splitter, left, right, dry, pick, monitor] = this.nodes;
    return { source, splitter, left, right, dry, pick, monitor };
  }
  /** Что видит анализатор: сырые каналы или моно по маршруту pick. */
  signal(role: string): Float32Array {
    if (role === 'left') return this.ch[0];
    if (role === 'right') return this.ch[1];
    const { source, splitter, pick } = this.graph;
    if (source.links.some(([n]) => n === pick)) {
      if (this.channels === 1) return this.ch[0];
      return this.ch[0].map((v, i) => (v + this.ch[1][i]) / 2);
    }
    const route = splitter.links.find(([n]) => n === pick);
    return route ? this.ch[route[1]] : new Float32Array(4096);
  }
  /** Оба канала одним сигналом. */
  set both(signal: Float32Array) {
    this.ch = [signal, Float32Array.from(signal)];
  }
}

class FakeTrack {
  stopped = false;
  onended: (() => void) | null = null;
  constructor(
    readonly label: string,
    private settings: Record<string, unknown>,
  ) {}
  getSettings = () => this.settings;
  stop = () => void (this.stopped = true);
}

const named = (name: string) => Object.assign(new Error(name), { name });

function fakeEngine() {
  const meters = new Set<(m: EngineMeters) => void>();
  const events = new Set<(e: EngineEvent) => void>();
  const frames = new Set<(f: EngineFrames) => void>();
  const e = {
    devices: {
      capture: [{ id: 'USB AUDIO CODEC', label: 'USB AUDIO CODEC', channels: 2 }],
      playback: [{ id: 'USB AUDIO CODEC', label: 'USB AUDIO CODEC', channels: 2 }],
    },
    opened: [] as EngineOpenOptions[],
    sets: [] as object[],
    closes: 0,
    /** Сообщение ошибки следующего open (код в начале, как у аддона). */
    fail: '',
    available: async () => ({ ok: true }),
    listDevices: async () => e.devices,
    async open(o: EngineOpenOptions) {
      e.opened.push(o);
      if (e.fail) throw new Error(e.fail);
      const dev = e.devices.capture.find((d) => o.capture === null || d.id === o.capture);
      if (!dev) throw new Error(`NOT_FOUND: ${o.capture}`);
      return {
        backend: 'jack' as const, sampleRate: 48000, bufferFrames: o.bufferFrames, requestedFrames: o.bufferFrames, captureLatencyFrames: 256,
        playbackLatencyFrames: 384, captureId: dev.id, captureLabel: dev.label, captureChannels: dev.channels, playbackId: dev.id, playbackLabel: dev.label,
      };
    },
    close: async () => void e.closes++,
    set: (o: object) => void e.sets.push(o),
    measureRtl: async () => ({ delaysFrames: [], medianFrames: 0, medianMs: 0, misses: 0 }),
    status: async () => ({ open: e.opened.length > e.closes, bufferFrames: 128, captureId: '' }),
    onMeters(fn: (m: EngineMeters) => void) {
      meters.add(fn);
      return () => void meters.delete(fn);
    },
    onEvent(fn: (ev: EngineEvent) => void) {
      events.add(fn);
      return () => void events.delete(fn);
    },
    onFrames(fn: (f: EngineFrames) => void) {
      frames.add(fn);
      return () => void frames.delete(fn);
    },
    /** Пакет кадров: [время мкс, midi, чистота, уровень, атака] по каждому. */
    frames(nowUs: number, rows: number[][]) {
      for (const fn of [...frames]) fn({ nowUs, frames: Float64Array.from(rows.flat()) });
    },
    meter(m: Partial<EngineMeters>) {
      for (const fn of [...meters])
        fn({ frames: 0, peak: [0, 0], dryPeak: 0, dryRms: 0, clipped: false, xruns: 0, load: 0, bufferFrames: 128, captureLatencyFrames: 0, playbackLatencyFrames: 0, ...m });
    },
    emit(ev: EngineEvent) {
      for (const fn of [...events]) fn(ev);
    },
    get listeners() {
      return meters.size + events.size + frames.size;
    },
  };
  return e satisfies EngineApi;
}

function fakePlatform() {
  let changed: (() => void) | null = null;
  let hold: Promise<void> | null = null;
  const p = {
    devices: [
      { kind: 'audioinput', deviceId: 'a', label: 'Interface A' },
      { kind: 'audioinput', deviceId: 'b', label: 'Mic B' },
      { kind: 'audiooutput', deviceId: 'o', label: 'Speakers' },
    ],
    asks: [] as Array<string | null>,
    tracks: [] as FakeTrack[],
    contexts: [] as FakeContext[],
    /** id устройства (null — по умолчанию) → имя ошибки getUserMedia. */
    fail: new Map<string | null, string>(),
    channels: 2,
    latency: 0.005 as number | undefined,
    contextFails: false,
    engineApi: null as ReturnType<typeof fakeEngine> | null,
    ticks: [] as Array<() => void>,
    clock: 0,
    holdOpen() {
      let release = () => {};
      hold = new Promise((resolve) => (release = resolve));
      return () => {
        hold = null;
        release();
      };
    },
    fireDeviceChange: () => changed?.(),
    async getUserMedia(constraints: MediaStreamConstraints) {
      const audio = constraints.audio as MediaTrackConstraints;
      const exact = (audio.deviceId as { exact?: string } | undefined)?.exact ?? null;
      p.asks.push(exact);
      if (hold) await hold;
      const error = p.fail.get(exact);
      if (error) throw named(error);
      const device = p.devices.find((d) => d.kind === 'audioinput' && (exact === null || d.deviceId === exact));
      if (!device) throw named(exact ? 'OverconstrainedError' : 'NotFoundError');
      const track = new FakeTrack(device.label, { deviceId: device.deviceId, channelCount: p.channels, latency: p.latency, sampleRate: 44100 });
      p.tracks.push(track);
      return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    },
    enumerateDevices: async () => p.devices as unknown as MediaDeviceInfo[],
    createContext() {
      if (p.contextFails) throw named('NotSupportedError');
      const ctx = new FakeContext();
      ctx.channels = p.channels;
      p.contexts.push(ctx);
      return ctx as unknown as AudioContext;
    },
    onDeviceChange(fn: () => void) {
      changed = fn;
      return () => void (changed = null);
    },
    engine: () => p.engineApi,
    stopVoice: vi.fn(),
    now: () => p.clock,
    every(_ms: number, fn: () => void) {
      p.ticks.push(fn);
      return () => void (p.ticks = p.ticks.filter((f) => f !== fn));
    },
  };
  return p satisfies InputPlatform;
}

const task = () => new Promise((resolve) => setTimeout(resolve, 0));
const BASE: InputConfig = { deviceId: null, deviceLabel: '', channel: -1, monitorGain: 0, noiseDb: NaN, backend: 'auto', bufferFrames: 128, outputDeviceId: null };
const chosen = (patch: Partial<InputConfig> = {}): InputConfig => ({ ...BASE, deviceId: 'a', deviceLabel: 'Interface A', ...patch });
const state = () => getInputSnapshot().state;
const sine = (amp: number) => Float32Array.from({ length: 4096 }, (_, i) => amp * Math.sin((2 * Math.PI * i) / 64));

let p: ReturnType<typeof fakePlatform>;
beforeEach(() => {
  p = fakePlatform();
  setInputPlatform(p);
});
afterEach(() => setInputPlatform(null));

describe('держатель и жизненный цикл', () => {
  it('StrictMode: держатель снят и поставлен в одном коммите — один захват; вокальный микрофон остановлен', async () => {
    configureInput(chosen());
    acquireInput()();
    const release = acquireInput();
    await task();
    expect(p.asks).toEqual(['a']);
    expect(p.stopVoice).toHaveBeenCalled();
    expect(getInputSnapshot()).toMatchObject({ state: 'no-signal', backend: 'web', deviceId: 'a', label: 'Interface A', channels: 2 });
    // частота — устройства (дорожки), а не контекста
    expect(getInputSnapshot().sampleRate).toBe(44100);
    release();
    expect(state()).toBe('no-signal');
    await task();
    expect(state()).toBe('off');
    expect(p.tracks[0].stopped).toBe(true);
    expect(p.contexts[0].state).toBe('closed');
    expect(p.ticks).toHaveLength(0);
  });

  it('держатель без выбранного входа тоже останавливает вокальный микрофон (один захват на приложение)', async () => {
    const release = acquireInput();
    expect(p.stopVoice).toHaveBeenCalledTimes(1);
    expect(p.asks).toEqual([]);
    release();
  });

  it('без выбранного устройства захват сам не открывается; «Разрешить» открывает устройство по умолчанию', async () => {
    const release = acquireInput();
    await task();
    expect(state()).toBe('off');
    expect(await requestInput(null)).toMatchObject({ state: 'no-signal', deviceId: 'a', label: 'Interface A' });
    configureInput(chosen({ monitorGain: 0.8 }));
    await task();
    expect(p.asks).toEqual([null]);
    expect(p.contexts[0].graph.monitor.gain.value).toBe(0.8);
    release();
  });

  it('смена устройства переоткрывает захват; выбор «без входа» закрывает', async () => {
    configureInput(chosen());
    const release = acquireInput();
    await task();
    configureInput(chosen({ deviceId: 'b', deviceLabel: 'Mic B' }));
    await task();
    expect(p.asks).toEqual(['a', 'b']);
    expect(p.tracks[0].stopped).toBe(true);
    expect(getInputSnapshot()).toMatchObject({ deviceId: 'b', label: 'Mic B' });
    configureInput(BASE);
    expect(state()).toBe('off');
    expect(p.tracks[1].stopped).toBe(true);
    release();
  });

  it('закрытие во время ждущего открытия: пришедший поток останавливается, граф не строится', async () => {
    const release = p.holdOpen();
    configureInput(chosen());
    acquireInput()();
    await task();
    release();
    await task();
    expect(p.tracks[0].stopped).toBe(true);
    expect(p.contexts).toHaveLength(0);
    expect(state()).toBe('off');
  });

  it('два открытия подряд: побеждает последнее, первый поток остановлен, граф один', async () => {
    const release = acquireInput();
    const hold = p.holdOpen();
    const first = requestInput('a');
    const second = requestInput('b');
    hold();
    await Promise.all([first, second]);
    expect(p.tracks.map((t) => [t.label, t.stopped])).toEqual([['Interface A', true], ['Mic B', false]]);
    expect(p.contexts).toHaveLength(1);
    expect(getInputSnapshot()).toMatchObject({ state: 'no-signal', deviceId: 'b' });
    release();
  });

  it('сбой сборки графа: дорожки остановлены, состояние «не открылся», а не вечное «открываем»', async () => {
    p.contextFails = true;
    const release = acquireInput();
    expect((await requestInput('a')).state).toBe('unavailable');
    expect(p.tracks[0].stopped).toBe(true);
    release();
  });
});

describe('ошибки', () => {
  for (const [error, want] of [
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotSupportedError', 'unsupported'],
    ['NotReadableError', 'unavailable'],
    ['AbortError', 'unavailable'],
  ] as const) {
    it(`${error} → ${want}`, async () => {
      p.fail.set('a', error);
      const release = acquireInput();
      expect((await requestInput('a')).state).toBe(want);
      release();
    });
  }

  it('нет выбранного устройства — device-lost; нет ни одного входа — not-found', async () => {
    const release = acquireInput();
    expect((await requestInput('gone')).state).toBe('device-lost');
    p.devices = p.devices.filter((d) => d.kind !== 'audioinput');
    expect((await requestInput(null)).state).toBe('not-found');
    release();
  });

  it('браузер выдал устройству новый id — находим его по метке', async () => {
    configureInput(chosen({ deviceId: 'old-id' }));
    const release = acquireInput();
    await task();
    await task();
    expect(p.asks).toEqual(['old-id', 'a']);
    expect(getInputSnapshot()).toMatchObject({ state: 'no-signal', deviceId: 'a', label: 'Interface A' });
    release();
  });

  it('два одинаковых устройства: по метке не угадываем — device-lost', async () => {
    p.devices.push({ kind: 'audioinput', deviceId: 'a2', label: 'Interface A' });
    configureInput(chosen({ deviceId: 'old-id' }));
    const release = acquireInput();
    await task();
    await task();
    expect(p.asks).toEqual(['old-id']);
    expect(state()).toBe('device-lost');
    release();
  });
});

describe('конец потока и возврат устройства', () => {
  it('поток кончился, устройство на месте — одна проба открывает снова', async () => {
    configureInput(chosen());
    const release = acquireInput();
    await task();
    p.tracks[0].onended?.();
    expect(p.contexts[0].state).toBe('closed');
    await task();
    expect(p.asks).toEqual(['a', 'a']);
    expect(state()).toBe('no-signal');
    release();
  });

  it('доступ отозвали — проба показывает permission-denied, а не «отключено»', async () => {
    configureInput(chosen());
    const release = acquireInput();
    await task();
    p.fail.set('a', 'NotAllowedError');
    p.tracks[0].onended?.();
    await task();
    expect(state()).toBe('permission-denied');
    release();
  });

  it('выдернули: проба — device-lost; подключение без устройства — попытка и снова device-lost; вернули — открыт', async () => {
    const changes = vi.fn();
    const off = onDevicesChange(changes);
    configureInput(chosen());
    const release = acquireInput();
    await task();
    const unplugged = p.devices.splice(0, 1);
    p.tracks[0].onended?.();
    await task();
    expect(state()).toBe('device-lost');
    expect(p.asks).toEqual(['a', 'a']);
    p.fireDeviceChange();
    await task();
    expect(p.asks).toEqual(['a', 'a', 'a']);
    expect(state()).toBe('device-lost');
    p.devices.unshift(...unplugged);
    p.fireDeviceChange();
    await task();
    expect(getInputSnapshot()).toMatchObject({ state: 'no-signal', deviceId: 'a' });
    expect(changes).toHaveBeenCalledTimes(2);
    off();
    release();
  });

  it('повторная проба — не чаще раза в 3 с', async () => {
    configureInput(chosen());
    const release = acquireInput();
    await task();
    p.tracks[0].onended?.();
    await task();
    p.tracks[1].onended?.();
    await task();
    expect(p.asks).toEqual(['a', 'a']);
    expect(state()).toBe('device-lost');
    p.clock = 3500;
    p.fireDeviceChange();
    await task();
    expect(state()).toBe('no-signal');
    release();
  });

  it('«входов нет» по «Разрешить», затем устройство подключили — вход открывается сам', async () => {
    const devices = p.devices;
    p.devices = [];
    const release = acquireInput();
    expect((await requestInput(null)).state).toBe('not-found');
    p.devices = devices;
    p.fireDeviceChange();
    await task();
    expect(getInputSnapshot()).toMatchObject({ state: 'no-signal', deviceId: 'a' });
    release();
  });
});

describe('каналы и мониторинг', () => {
  it('пики каналов — с разветвителя всегда; канал 2 — через разветвитель; смесь — сведение в моно', async () => {
    configureInput(chosen({ channel: 1 }));
    const release = acquireInput();
    await task();
    const { source, splitter, left, right, dry, pick, monitor } = p.contexts[0].graph;
    expect([pick.channelCount, pick.channelCountMode, pick.channelInterpretation]).toEqual([1, 'explicit', 'speakers']);
    expect(source.links).toEqual([[splitter, 0]]);
    expect(splitter.links).toEqual([[left, 0], [right, 1], [pick, 1]]);
    expect(pick.links.map(([n]) => n)).toEqual([dry, monitor]);
    expect(monitor.links).toEqual([[p.contexts[0].destination, 0]]);
    expect(monitor.gain.value).toBe(0);
    configureInput(chosen({ channel: -1 }));
    expect(source.links).toEqual([[splitter, 0], [pick, 0]]);
    expect(splitter.links).toEqual([[left, 0], [right, 1]]);
    configureInput(chosen({ channel: 0 }));
    expect(source.links).toEqual([[splitter, 0]]);
    expect(splitter.links).toEqual([[left, 0], [right, 1], [pick, 0]]);
    release();
    await task();

    p.channels = 1;
    configureInput(chosen({ channel: 1 }));
    const again = acquireInput();
    await task();
    const mono = p.contexts[1].graph;
    expect(getInputSnapshot().channels).toBe(1);
    expect(mono.source.links).toEqual([[mono.splitter, 0], [mono.pick, 0]]);
    again();
  });
});

describe('уровень', () => {
  it('пик и RMS, тишина 5 с — no-signal, перегруз 1.5 с, пик игры замирает; объект уровня один', async () => {
    configureInput(chosen());
    const release = acquireInput();
    await task();
    const ctx = p.contexts[0];
    expect(state()).toBe('no-signal');
    ctx.both = sine(0.5);
    const level = readLevel(100);
    expect(level.peakDb).toBeCloseTo(-6.02, 1);
    expect(level.rmsDb).toBeCloseTo(-9.03, 1);
    expect(level.channelDb[0]).toBeCloseTo(-6.02, 1);
    expect(state()).toBe('ok');
    ctx.both = new Float32Array(4096);
    expect(readLevel(102)).toBe(level);
    expect(level.peakDb).toBeCloseTo(-6.02, 1); // второй читатель в том же кадре — тот же замер
    readLevel(200);
    expect(level.barDb).toBeCloseTo(-9.02, 1);
    expect(level.holdDb).toBeCloseTo(-6.02, 1);
    expect(level.playDb).toBeCloseTo(-6.02, 1);
    readLevel(5099);
    expect(level.holdDb).toBeLessThan(-6.1);
    expect(state()).toBe('ok');
    readLevel(5110);
    expect(state()).toBe('no-signal');
    expect(level.playDb).toBeCloseTo(-6.02, 1);
    ctx.both = sine(1);
    expect(readLevel(5200).clipping).toBe(true);
    expect(state()).toBe('clipping');
    ctx.both = new Float32Array(4096);
    expect(readLevel(6600).clipping).toBe(true);
    expect(readLevel(6701).clipping).toBe(false);
    expect(state()).toBe('ok');
    release();
  });

  it('перегруз ловится по сырому каналу: в смеси левый 0 dBFS при тишине справа — всё равно перегруз', async () => {
    configureInput(chosen({ channel: -1 }));
    const release = acquireInput();
    await task();
    p.contexts[0].ch = [sine(1), new Float32Array(4096)];
    const level = readLevel(100);
    expect(level.peakDb).toBeCloseTo(-6.02, 1);
    expect(level.clipping).toBe(true);
    expect(state()).toBe('clipping');
    release();
  });

  it('порог сигнала — фон + 6 дБ, но не громче −40', async () => {
    configureInput(chosen({ noiseDb: -50 }));
    const release = acquireInput();
    await task();
    const ctx = p.contexts[0];
    ctx.both = new Float32Array(4096).fill(10 ** (-46 / 20));
    readLevel(100);
    expect(state()).toBe('no-signal');
    ctx.both = new Float32Array(4096).fill(10 ** (-43 / 20));
    readLevel(200);
    expect(state()).toBe('ok');
    configureInput(chosen({ noiseDb: -30 }));
    ctx.both = new Float32Array(4096).fill(10 ** (-38 / 20));
    readLevel(5300);
    expect(state()).toBe('ok');
    release();
  });

  it('сессия опрашивает уровень сама — состояние идёт и без шкал на экране (игра)', async () => {
    configureInput(chosen());
    const release = acquireInput();
    await task();
    expect(p.ticks).toHaveLength(1);
    p.contexts[0].both = sine(0.5);
    p.clock = 100;
    p.ticks[0]();
    expect(state()).toBe('ok');
    release();
    await task();
    expect(p.ticks).toHaveLength(0);
  });

  it('закрытый вход — тишина', () => {
    expect(readLevel(100)).toMatchObject({ peakDb: -Infinity, clipping: false });
  });
});

describe('замер фона и задержка', () => {
  it('медиана RMS за окно; вход закрылся по ходу — NaN', async () => {
    configureInput(chosen());
    const release = acquireInput();
    await task();
    p.contexts[0].both = new Float32Array(4096).fill(0.01);
    expect(await measureNoise(20, 5)).toBeCloseTo(-40, 5);
    const pending = measureNoise(50, 5);
    configureInput(BASE);
    expect(await pending).toBeNaN();
    release();
  });

  it('браузер: вход — из настроек дорожки, вывод — базовая + выходная задержка контекста; без данных — NaN', async () => {
    expect(readLatency()).toMatchObject({ kind: 'web', inputMs: NaN, outputMs: NaN });
    configureInput(chosen());
    const release = acquireInput();
    await task();
    expect(readLatency()).toEqual({ kind: 'web', inputMs: 5, outputMs: 30, bufferMs: NaN });
    release();
    await task();
    p.latency = undefined;
    const again = acquireInput();
    await task();
    expect(readLatency().inputMs).toBeNaN();
    again();
  });
});

describe('нативный движок', () => {
  const engineInput = (patch: Partial<InputConfig> = {}) => chosen({ deviceId: 'USB AUDIO CODEC', deviceLabel: 'USB AUDIO CODEC', ...patch });

  it('открытие, метры, канал и мониторинг на лету, задержка по отчёту драйвера, закрытие', async () => {
    const engine = (p.engineApi = fakeEngine());
    expect(await listInputDevices()).toEqual([{ id: 'USB AUDIO CODEC', label: 'USB AUDIO CODEC', channels: 2 }]);
    configureInput(engineInput({ channel: 0 }));
    const release = acquireInput();
    await task();
    expect(p.asks).toEqual([]);
    expect(engine.opened[0]).toMatchObject({ capture: 'USB AUDIO CODEC', channel: 0, bufferFrames: 128, monitorGain: 0 });
    expect(getInputSnapshot()).toMatchObject({ state: 'no-signal', backend: 'engine', channels: 2, sampleRate: 48000, bufferFrames: 128, requestedFrames: 128 });
    engine.meter({ dryPeak: 0.5, dryRms: 0.35, peak: [0.5, 0.01], xruns: 2 });
    const level = readLevel(100);
    expect(level.peakDb).toBeCloseTo(-6.02, 1);
    expect(level.channelDb[1]).toBeCloseTo(-40, 1);
    expect(getInputSnapshot()).toMatchObject({ state: 'ok', xruns: 2 });
    engine.meter({ dryPeak: 0.9, dryRms: 0.5, peak: [1, 0], clipped: true });
    expect(readLevel(200).clipping).toBe(true);
    configureInput(engineInput({ channel: 1, monitorGain: 0.7 }));
    expect(engine.sets.at(-1)).toEqual({ channel: 1, monitorGain: 0.7 });
    // свежий отчёт драйвера из метров важнее значений открытия
    engine.meter({ captureLatencyFrames: 176, playbackLatencyFrames: 176 });
    expect(readLatency()).toEqual({ kind: 'engine', inputMs: (176 / 48000) * 1000, outputMs: (176 / 48000) * 1000, bufferMs: (128 / 48000) * 1000 });
    release();
    await task();
    expect(engine.closes).toBe(1);
    expect(engine.listeners).toBe(0);
  });

  it('события движка: устройство выдернули и вернули, буфер откатился после срывов', async () => {
    const engine = (p.engineApi = fakeEngine());
    configureInput(engineInput());
    const release = acquireInput();
    await task();
    engine.emit({ kind: 'device-lost', device: 'USB AUDIO CODEC' });
    expect(state()).toBe('device-lost');
    engine.meter({ dryPeak: 0.5, dryRms: 0.35 });
    readLevel(100);
    expect(state()).toBe('device-lost');
    engine.emit({ kind: 'device-back', device: 'USB AUDIO CODEC' });
    expect(state()).toBe('no-signal');
    engine.emit({ kind: 'reopened', bufferFrames: 256, requestedFrames: 256, reason: 'xrun' });
    expect(getInputSnapshot().bufferFrames).toBe(256);
    release();
  });

  it('смена буфера переоткрывает движок с новым квантом', async () => {
    const engine = (p.engineApi = fakeEngine());
    configureInput(engineInput());
    const release = acquireInput();
    await task();
    configureInput(engineInput({ bufferFrames: 64 }));
    await task();
    expect(engine.opened.map((o) => o.bufferFrames)).toEqual([128, 64]);
    expect(getInputSnapshot()).toMatchObject({ bufferFrames: 64, state: 'no-signal' });
    release();
  });

  it('сохранён id браузера — устройство движка находится по метке', async () => {
    const engine = (p.engineApi = fakeEngine());
    configureInput(chosen({ deviceId: 'browser-hash', deviceLabel: 'USB AUDIO CODEC' }));
    const release = acquireInput();
    await task();
    await task();
    expect(engine.opened.map((o) => o.capture)).toEqual(['browser-hash', 'USB AUDIO CODEC']);
    expect(getInputSnapshot()).toMatchObject({ backend: 'engine', deviceId: 'USB AUDIO CODEC' });
    release();
  });

  it('JACK недоступен — тот же вход через браузер, причина видна', async () => {
    const engine = (p.engineApi = fakeEngine());
    // как приходит через мост IPC — с его префиксом
    engine.fail = "Error invoking remote method 'engine:open': Error: NO_ENGINE: libjack не загрузился";
    configureInput(chosen());
    const release = acquireInput();
    await task();
    await task();
    expect(p.asks).toEqual(['a']);
    expect(getInputSnapshot()).toMatchObject({ backend: 'web', state: 'no-signal' });
    expect(getInputSnapshot().engineError).toMatch(/NO_ENGINE: libjack не загрузился$/);
    expect((await listInputDevices()).map((d) => d.id)).toEqual(['a', 'b']);
    release();
  });

  it('кадры анализа: часы JACK → часы страницы по минимальной задержке доставки; атаки и высота как есть', async () => {
    const engine = (p.engineApi = fakeEngine());
    const got: InputFrame[] = [];
    const off = onInputFrames((f) => got.push(f));
    configureInput(engineInput());
    const release = acquireInput();
    await task();
    // часы страницы на 5000 мс впереди часов JACK; первый пакет шёл 3 мс, второй — 0.5 мс
    p.clock = 5000 + 1000 + 3;
    engine.frames(1_000_000, [[990_000, NaN, 0, -20, 1]]);
    p.clock = 5000 + 1020 + 0.5;
    engine.frames(1_020_000, [[1_010_000, 52.1, 0.9, -24, 0]]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ onset: true, midi: NaN });
    expect(got[0].atMs).toBeCloseTo(990 + 5003, 6);
    // второй пакет пришёл быстрее — сдвиг уточнился до 5000.5
    expect(got[1]).toMatchObject({ onset: false, midi: 52.1, clarity: 0.9, levelDb: -24 });
    expect(got[1].atMs).toBeCloseTo(1010 + 5000.5, 6);
    off();
    release();
  });

  it('сторож: метры движка молчат дольше 2 с (закрыт помимо сессии) — потеря и одна проба открывает снова', async () => {
    const engine = (p.engineApi = fakeEngine());
    configureInput(engineInput());
    const release = acquireInput();
    await task();
    engine.meter({ dryPeak: 0.1, dryRms: 0.05 });
    readLevel(100);
    expect(engine.opened).toHaveLength(1);
    p.clock = 2500; // метров не было 2.5 с
    readLevel(2500);
    await task();
    await task();
    expect(engine.opened).toHaveLength(2);
    expect(getInputSnapshot()).toMatchObject({ state: 'no-signal', backend: 'engine' });
    release();
  });

  it('сервер JACK недоступен — браузер, через 10 с — снова движок; аддон не загрузился — браузер до перезагрузки', async () => {
    const engine = (p.engineApi = fakeEngine());
    engine.fail = 'NO_ENGINE: сервер JACK/PipeWire недоступен: client error';
    configureInput(chosen());
    const release = acquireInput();
    await task();
    await task();
    expect(getInputSnapshot().backend).toBe('web');
    engine.fail = '';
    p.clock = 11000;
    configureInput(engineInput());
    await task();
    await task();
    expect(getInputSnapshot()).toMatchObject({ backend: 'engine', engineError: '' });
    release();
    await task();

    engine.fail = 'NO_ENGINE: аддон движка не загрузился: bad ELF';
    configureInput(chosen());
    const again = acquireInput();
    await task();
    await task();
    p.clock = 60000;
    engine.fail = '';
    configureInput(engineInput());
    await task();
    await task();
    expect(getInputSnapshot().backend).toBe('web');
    again();
  });

  it('выбран только браузер — движок не трогается', async () => {
    const engine = (p.engineApi = fakeEngine());
    configureInput(chosen({ backend: 'worklet' }));
    const release = acquireInput();
    await task();
    expect(engine.opened).toEqual([]);
    expect(getInputSnapshot().backend).toBe('web');
    release();
  });
});
