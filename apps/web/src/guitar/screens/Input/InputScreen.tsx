// «Вход и звук» (ui-spec §11.11, макет — раздел 9): устройство входа, канал (с огоньком сигнала у каждого входа), что
// подключено, шкала −60…0 dBFS с пиком и советом по гейну, фон в тишине; мониторинг себя и задержка туда-обратно; задержка
// звука и картинки, эталон строя. Десктоп с нативным движком: устройства и выходы — порты JACK (PipeWire), буфер, срывы,
// мониторинг через движок с задержкой в единицы мс. Веб: устройства — из списка браузера, задержка — оценка браузера с
// рекомендацией прямого мониторинга. Выбор устройства открывает его сразу (жест игрока выдаёт доступ), в настройки идёт
// фактически открытое устройство.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  inputSupported,
  listInputDevices,
  listOutputDevices,
  measureNoise,
  onDevicesChange,
  readLatency,
  requestInput,
  type InputDevice,
  type InputLatency,
  type InputSnapshot,
} from '../../../audio/instrument/session';
import { currentLang, t } from '../../../lib/i18n';
import { HashLink } from '../../HashLink';
import { NOISE_TOO_LOUD_DB, accessOf, adviceOf, inputOpen, listDeviceLabel, noiseKeyOf, type Access, type Advice } from '../../input/inputView';
import { formatDb, meterFraction, useInputSnapshot, useLevelFrames } from '../../input/useInput';
import type { GuitarSettings, InputType } from '../../model/types';
import { useGuitarSettings } from '../../store/settings';
import { GuitarIcon } from '../../ui/GuitarIcon';
import './input.css';

type Monitoring = GuitarSettings['monitoring']['mode'];

const SCALE = ['−60', '−48', '−36', '−24', '−12'];
const A4_MIN = 430;
const A4_MAX = 450;
const BUFFERS = [64, 128, 256, 512];
/** Огонёк канала горит от −50 dBFS. */
const CHANNEL_LIT_DB = -50;

// Подсказки — функции: язык берётся в момент показа.
const SOURCE_NOTES: Record<InputType, () => string> = {
  di: () => t('Electric guitar or bass straight into the sound card — the most accurate recognition.'),
  pickup: () => t('Acoustic with a built-in pickup, by cable into the sound card.'),
  mic: () => t('Microphone at the acoustic: 20–30 cm from the sound hole, the backing track — in headphones.'),
};
const MONITOR_NOTES: Record<Monitoring, (engine: boolean) => string> = {
  direct: () => t('The interface sends the guitar straight to your headphones with no delay; Pupitre does not output it.'),
  tone: (engine) =>
    engine
      ? t('The native engine outputs the clean signal with a delay of a few milliseconds; amp and effects will come later. Headphones only: from speakers the sound gets back into the input.')
      : t('Pupitre outputs the clean signal; amp and effects will come later. Headphones only: from speakers the sound gets back into the input. In the browser the delay is noticeable — direct monitoring is better.'),
  off: () => t('You hear only the backing track and the strings themselves.'),
};
const ADVICE: Record<Advice, () => string> = {
  closed: () => t('Choose an input — the scale will show the level.'),
  play: () => t('Play something — the scale will show the level.'),
  quiet: () => t('Quiet: turn the gain up on the interface or the volume on the guitar.'),
  good: () => t('Good level: play in the green zone.'),
  hot: () => t('Almost overloaded: turn the gain down a little.'),
  clip: () => t('Overload: turn the gain down on the interface.'),
};
// Озвучка смены состояния (живая область смонтирована всегда — объявляется только смена).
const SPOKEN: Partial<Record<InputSnapshot['state'], () => string>> = {
  ok: () => t('The input works'),
  clipping: () => t('Overload: turn the gain down on the interface.'),
  'device-lost': () => t('Device disconnected'),
  'permission-denied': () => t('No access to the input'),
  'not-found': () => t('No inputs found'),
  unavailable: () => t('The input did not open'),
  unsupported: () => t('No sound access'),
};

/** «8,7» / «8.7». */
const formatMs = (ms: number) => (Math.round(ms * 10) / 10).toFixed(1).replace('.', currentLang() === 'ru' ? ',' : '.');
const formatKhz = (hz: number) => formatMs(hz / 1000).replace(/[,.]0$/, '');

function noiseText(noiseDb: number | undefined): string {
  if (noiseDb === undefined) return t('not measured: mute the strings and press Measure');
  const verdict = noiseDb <= -60 ? t('clean') : noiseDb <= -45 ? t('some background, recognition copes') : t('loud background: check the cable and grounding');
  return `${formatDb(noiseDb)} ${t('dBFS')} · ${verdict}`;
}

function Seg<T extends string | number>(props: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  disabled?: (value: T) => boolean;
  ui: string;
  /** Огонёк сигнала перед подписью (ref — по значению). */
  led?: (value: T) => ((el: HTMLSpanElement | null) => void) | undefined;
}) {
  return (
    <div className="rp-seg rp-seg--fill" role="radiogroup" aria-label={props.label} data-ui={props.ui}>
      {props.options.map(([value, text]) => {
        const led = props.led?.(value);
        return (
          <button
            key={String(value)}
            type="button"
            className="rp-seg__item"
            role="radio"
            aria-checked={value === props.value}
            disabled={props.disabled?.(value)}
            onClick={() => props.onChange(value)}
          >
            {led && <span className="rp-led io__chled" ref={led} aria-hidden="true" />}
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** Устройства; перечитываются при подключении и смене состояния входа (с доступом у браузера появляются метки). */
function useDevices(key: string, list: () => Promise<InputDevice[]>): InputDevice[] | null {
  const [devices, setDevices] = useState<InputDevice[] | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void list().then(
        (next) => live && setDevices(next),
        () => live && setDevices([]),
      );
    refresh();
    const off = onDevicesChange(refresh);
    return () => {
      live = false;
      off();
    };
  }, [key, list]);
  return devices;
}

function Meter({ open, clipping }: { open: boolean; clipping: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const peak = useRef<HTMLSpanElement>(null);
  const shown = useRef<Advice>('closed');
  const [advice, setAdvice] = useState<Advice>('closed');
  useLevelFrames(open, (level) => {
    bar.current?.style.setProperty('--v', meterFraction(level.barDb).toFixed(3));
    bar.current?.style.setProperty('--peak', meterFraction(level.holdDb).toFixed(3));
    const text = `${t('peak')} ${formatDb(level.holdDb)} ${t('dBFS')}`;
    if (peak.current && peak.current.textContent !== text) peak.current.textContent = text;
    const next = adviceOf(level);
    if (next !== shown.current) {
      shown.current = next;
      setAdvice(next);
    }
  });
  useEffect(() => {
    if (open) return;
    bar.current?.style.setProperty('--v', '0');
    bar.current?.style.setProperty('--peak', '0');
    if (peak.current) peak.current.textContent = '';
    shown.current = 'closed';
    setAdvice('closed');
  }, [open]);
  return (
    <div className="bigmeter" data-ui="input-meter">
      <div className="rp-field__head">
        <span className="rp-sm">{t('Level')}</span>
        {clipping && (
          <span className="io__clip" data-ui="input-clip">
            <span className="rp-led rp-led--bad" />
            {t('overload')}
          </span>
        )}
        <span className="rp-num rp-sm io__peak" ref={peak} data-ui="input-peak" />
      </div>
      <div className="rp-meter rp-meter--zone" ref={bar} style={{ '--v': 0, '--peak': 0 } as CSSProperties} data-live={open} aria-hidden="true" />
      <div className="bigmeter__scale" aria-hidden="true">
        {SCALE.map((mark) => (
          <span key={mark}>{mark}</span>
        ))}
        <span>0 {t('dB')}</span>
      </div>
      <span className="rp-sm rp-muted" data-ui="input-advice" data-advice={advice}>
        {ADVICE[advice]()}
      </span>
    </div>
  );
}

const noLatency = (kind: InputLatency['kind']): InputLatency => ({ kind, inputMs: NaN, outputMs: NaN, bufferMs: NaN });

function RoundTrip({ open, snap }: { open: boolean; snap: InputSnapshot }) {
  const [lat, setLat] = useState<InputLatency>(() => noLatency(snap.backend));
  useEffect(() => {
    const read = () => {
      const next = open ? readLatency() : noLatency(snap.backend);
      setLat((prev) =>
        prev.kind === next.kind && Object.is(prev.inputMs, next.inputMs) && Object.is(prev.outputMs, next.outputMs) && Object.is(prev.bufferMs, next.bufferMs)
          ? prev
          : next,
      );
    };
    read();
    if (!open) return;
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [open, snap.backend, snap.bufferFrames]);
  const engine = lat.kind === 'engine';
  const hasIn = Number.isFinite(lat.inputMs);
  const hasOut = Number.isFinite(lat.outputMs);
  const total = (hasIn ? lat.inputMs : 0) + (hasOut ? lat.outputMs : 0);
  return (
    <div className="rp-field" data-ui="input-latency" data-kind={lat.kind}>
      <div className="rp-field__head">
        <span className="rp-sm">{t('Round-trip delay')}</span>
        <span className="rp-num io__rtl">{hasIn || hasOut ? `≈ ${formatMs(total)} ${t('ms')}` : '—'}</span>
      </div>
      {(hasIn || hasOut) && (
        <>
          <div className="lat" aria-hidden="true">
            {hasIn && <i className="io__lat-in" style={{ '--w': lat.inputMs } as CSSProperties} />}
            {hasOut && <i className="io__lat-out" style={{ '--w': lat.outputMs } as CSSProperties} />}
          </div>
          <div className="lat-legend">
            <span>
              <i className="io__lat-in" />
              {t('input')} {hasIn ? formatMs(lat.inputMs) : t('— the browser does not report')}
            </span>
            {hasOut && (
              <span>
                <i className="io__lat-out" />
                {t('output')} {formatMs(lat.outputMs)}
              </span>
            )}
            {engine && (
              <span className="io__xruns" data-ui="input-xruns" data-xruns={snap.xruns > 0}>
                <GuitarIcon name={snap.xruns ? 'alert-triangle' : 'circle-check'} size="sm" />
                {t('dropouts this session')}: {snap.xruns}
              </span>
            )}
          </div>
        </>
      )}
      <span className="opt-note">
        {engine ? t('Driver report: device, buffer and engine. Calibration measures the exact delay.') : t('Browser estimate; calibration measures the exact delay.')}
      </span>
    </div>
  );
}

export function InputScreen() {
  const [settings, update] = useGuitarSettings();
  const snap = useInputSnapshot();
  const open = inputOpen(snap.state);
  const engine = snap.backend === 'engine';
  const devices = useDevices(`${snap.backend}|${snap.state}|${snap.deviceId}`, listInputDevices);
  const outputs = useDevices(`${snap.backend}|${open}`, listOutputDevices);
  const [pending, setPending] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [noiseError, setNoiseError] = useState('');
  const { input, monitoring, mix } = settings;
  const chosen = input.deviceId !== null;
  const labels = !!devices?.some((d) => d.label);
  const mono = open && snap.channels === 1;
  const noiseKey = noiseKeyOf(input.deviceId, input.channel);
  const noiseDb = input.noiseKey === noiseKey ? input.noiseDb : undefined;
  const channelLeds = useRef<Array<HTMLSpanElement | null>>([null, null]);

  // Огоньки сигнала у «Вход 1» и «Вход 2»: в каком канале гитара — видно сразу.
  useLevelFrames(open, (level) => {
    for (let i = 0; i < 2; i++) channelLeds.current[i]?.classList.toggle('rp-led--ok', level.channelDb[i] > CHANNEL_LIT_DB);
  });
  useEffect(() => {
    if (!open) for (const led of channelLeds.current) led?.classList.remove('rp-led--ok');
  }, [open]);

  const setInput = (patch: Partial<GuitarSettings['input']>) => update((s) => ({ ...s, input: { ...s.input, ...patch } }));

  async function choose(deviceId: string | null) {
    if (pending) return;
    setPending(true);
    try {
      const next = await requestInput(deviceId);
      if (next.deviceId && inputOpen(next.state)) setInput({ deviceId: next.deviceId, deviceLabel: next.label });
    } finally {
      setPending(false);
    }
  }

  async function measure() {
    if (!open || measuring) return;
    setMeasuring(true);
    setNoiseError('');
    try {
      const db = await measureNoise(2000);
      if (Number.isNaN(db)) return;
      if (db > NOISE_TOO_LOUD_DB) setNoiseError(t('Too loud for silence: mute the strings and measure again'));
      else setInput({ noiseDb: Math.round(Math.max(-120, db) * 10) / 10, noiseKey });
    } finally {
      setMeasuring(false);
    }
  }

  const access: Access = accessOf(snap, devices, inputSupported());
  const retry = () => void choose(input.deviceId);

  const chip =
    snap.state === 'ok' ? <span className="rp-chip rp-chip--ok rp-chip--dot">{t('signal present')}</span>
    : snap.state === 'no-signal' ? <span className="rp-chip rp-chip--dot">{t('silence')}</span>
    : snap.state === 'clipping' ? <span className="rp-chip rp-chip--bad rp-chip--dot">{t('overload')}</span>
    : snap.state === 'opening' ? <span className="rp-chip">{t('opening…')}</span>
    : access ? <span className="rp-chip rp-chip--warn rp-chip--dot">{t('no input')}</span>
    : <span className="rp-chip">{t('not selected')}</span>;

  const calibrated = Object.values(settings.latency).sort((a, b) => b.at - a.at)[0];
  const a4 = settings.reference.a4Hz;
  const setA4 = (hz: number) => update((s) => ({ ...s, reference: { ...s.reference, a4Hz: Math.min(A4_MAX, Math.max(A4_MIN, hz)) } }));
  const monitorPct = Math.round(mix.monitor * 100);
  const buffer = input.bufferFrames ?? 128;

  return (
    <div className="rp-page" data-ui="input-screen" data-backend={snap.backend}>
      <p className="rp-sr" aria-live="polite" data-ui="input-live">
        {SPOKEN[snap.state]?.() ?? ''}
      </p>
      <div className="page-head">
        <div className="page-head__title">
          <span className="rp-label">{t('Guitar mode')}</span>
          <h1 className="rp-h1">{t('Input and sound')}</h1>
        </div>
        <HashLink className="rp-btn" to="/guitar/calibrate">
          <GuitarIcon name="gauge" size="sm" />
          {t('Calibration')}
        </HashLink>
      </div>
      <div className="io">
        <section className="rp-card" aria-labelledby="io-input" data-ui="input-card" data-state={snap.state}>
          <div className="rp-card__head">
            <span className="rp-section-title">
              <GuitarIcon name="plug-connected" size="sm" />
              <span className="rp-label" id="io-input">
                {t('Input')}
              </span>
            </span>
            {chip}
          </div>

          {access && (
            <div className="io__warn" data-ui="input-access" data-access={access}>
              {access === 'unsupported' && <span>{t('The browser gives no sound access on this address. Open Pupitre via localhost or https, or use the desktop app.')}</span>}
              {access === 'ask' && (
                <>
                  <span>{t('To hear the guitar, Pupitre needs access to the sound input. The sound is processed on this computer and goes nowhere.')}</span>
                  <button type="button" className="rp-btn rp-btn--light rp-btn--sm" aria-disabled={pending} onClick={retry} data-ui="input-allow">
                    <GuitarIcon name="plug-connected" size="sm" />
                    {t('Allow access')}
                  </button>
                </>
              )}
              {access === 'denied' && (
                <>
                  <span>{t('Access to the input is blocked. Allow the microphone for this page in the browser settings (the icon next to the address) and press Retry.')}</span>
                  <button type="button" className="rp-btn rp-btn--sm" aria-disabled={pending} onClick={retry} data-ui="input-retry">
                    <GuitarIcon name="refresh" size="sm" />
                    {t('Retry')}
                  </button>
                </>
              )}
              {access === 'none' && (
                <>
                  <span>{t('No sound inputs found. Connect a sound card or a guitar interface — the list updates by itself.')}</span>
                  <button type="button" className="rp-btn rp-btn--sm" aria-disabled={pending} onClick={() => void choose(null)} data-ui="input-retry">
                    <GuitarIcon name="refresh" size="sm" />
                    {t('Retry')}
                  </button>
                </>
              )}
              {access === 'busy' && (
                <>
                  <span>{t('The input did not open: the device is busy with another program or unavailable.')}</span>
                  <button type="button" className="rp-btn rp-btn--sm" aria-disabled={pending} onClick={() => void choose(snap.deviceId ?? input.deviceId)} data-ui="input-retry">
                    <GuitarIcon name="refresh" size="sm" />
                    {t('Retry')}
                  </button>
                </>
              )}
              {access === 'lost' && (
                <>
                  <span>{t('The device is disconnected. Plug it back in — it reconnects by itself — or choose another one.')}</span>
                  <button type="button" className="rp-btn rp-btn--sm" aria-disabled={pending} onClick={retry} data-ui="input-retry">
                    <GuitarIcon name="refresh" size="sm" />
                    {t('Retry')}
                  </button>
                </>
              )}
            </div>
          )}

          {devices && labels && devices.length > 0 && (
            <div className="rp-field">
              <div className="rp-field__head">
                <span className="rp-sm" id="io-device">
                  {t('Device')}
                </span>
                {open && (
                  <span className="rp-field__hint">
                    {engine ? `${t('native engine')} · JACK · ` : ''}
                    {formatKhz(snap.sampleRate)} {t('kHz')} · {snap.channels === 1 ? t('mono') : t('2 channels')}
                  </span>
                )}
              </div>
              <div className="io__devices" role="radiogroup" aria-labelledby="io-device" data-ui="input-devices">
                {devices.map((d, i) => (
                  <button
                    key={d.id || i}
                    type="button"
                    className="io__device"
                    role="radio"
                    aria-checked={d.id === input.deviceId}
                    aria-disabled={pending}
                    onClick={() => void choose(d.id)}
                  >
                    <GuitarIcon name={d.id === input.deviceId ? 'circle-check' : 'microphone'} size="sm" />
                    <span>{listDeviceLabel(d, i)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {snap.engineError && (
            <span className="opt-note io__engine-note" data-ui="input-engine-error">
              {t('The native engine is unavailable, the browser sound works')}: {snap.engineError}
            </span>
          )}
          {chosen && (
            <button type="button" className="rp-btn rp-btn--ghost rp-btn--sm io__off" onClick={() => setInput({ deviceId: null, deviceLabel: '' })} data-ui="input-off">
              {t('Do not use an input')}
            </button>
          )}

          <div className="rp-field">
            <span className="rp-sm">{t('Channel')}</span>
            <Seg
              label={t('Channel')}
              ui="input-channel"
              value={mono ? 0 : input.channel}
              options={[
                [0, t('Input 1')],
                [1, t('Input 2')],
                [-1, t('Both')],
              ]}
              disabled={(v) => mono && v !== 0}
              led={(v) => (v >= 0 ? (el) => void (channelLeds.current[v] = el) : undefined)}
              onChange={(channel) => setInput({ channel })}
            />
            <span className="opt-note">{mono ? t('The device has one channel.') : t('Recognition takes the dry signal of this channel — before any effects.')}</span>
          </div>

          <div className="rp-field">
            <span className="rp-sm">{t('What is connected')}</span>
            <Seg<InputType>
              label={t('What is connected')}
              ui="input-source"
              value={input.type}
              options={[
                ['di', t('Guitar in line')],
                ['pickup', t('Pickup')],
                ['mic', t('Microphone')],
              ]}
              onChange={(type) => setInput({ type })}
            />
            <span className="opt-note">{SOURCE_NOTES[input.type]()}</span>
          </div>

          <Meter open={open} clipping={snap.state === 'clipping'} />

          <div className="rp-field__head io__noise">
            <span className="rp-toggle-row__text">
              <span className="rp-sm">{t('Background in silence')}</span>
              <small data-ui="input-noise">{noiseError || noiseText(noiseDb)}</small>
            </span>
            <button type="button" className="rp-btn rp-btn--sm" aria-disabled={!open || measuring} onClick={() => void measure()} data-ui="input-measure">
              <GuitarIcon name="ear" size="sm" />
              {measuring ? t('Listening… keep the strings still') : t('Measure · 2 s of silence')}
            </button>
          </div>
        </section>

        <section className="rp-card" aria-labelledby="io-output" data-ui="input-monitor-card">
          <div className="rp-card__head">
            <span className="rp-section-title">
              <GuitarIcon name="headphones" size="sm" />
              <span className="rp-label" id="io-output">
                {t('Output and monitoring')}
              </span>
            </span>
          </div>
          {engine && outputs && outputs.length > 0 && (
            <div className="rp-field">
              <div className="rp-field__head">
                <span className="rp-sm" id="io-outputs">
                  {t('Where to output')}
                </span>
                {open && snap.outputLabel && (
                  <span className="rp-field__hint" data-ui="input-output-now">
                    {t('sound goes to')} {listDeviceLabel({ id: '', label: snap.outputLabel }, 0)}
                  </span>
                )}
              </div>
              {open && !snap.outputLabel && (
                <span className="opt-note io__engine-note" data-ui="input-no-output">
                  {t('This input has no output of its own — choose where to hear yourself.')}
                </span>
              )}
              <div className="io__devices" role="radiogroup" aria-labelledby="io-outputs" data-ui="input-outputs">
                {[{ id: '', label: t('Same device as the input') }, ...outputs].map((d, i) => {
                  const id = d.id || null;
                  return (
                    <button
                      key={d.id || 'same'}
                      type="button"
                      className="io__device"
                      role="radio"
                      aria-checked={(input.outputDeviceId ?? null) === id}
                      onClick={() => setInput({ outputDeviceId: id })}
                    >
                      <GuitarIcon name={(input.outputDeviceId ?? null) === id ? 'circle-check' : 'headphones'} size="sm" />
                      <span>{i === 0 ? d.label : listDeviceLabel(d, i - 1)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="rp-field">
            <span className="rp-sm">{t('How to hear yourself')}</span>
            <Seg<Monitoring>
              label={t('How to hear yourself')}
              ui="input-monitoring"
              value={monitoring.mode}
              options={[
                ['direct', t('Direct from the interface')],
                ['tone', t('Through Pupitre')],
                ['off', t('Do not hear')],
              ]}
              onChange={(mode) => update((s) => ({ ...s, monitoring: { ...s.monitoring, mode } }))}
            />
            <span className="opt-note">{MONITOR_NOTES[monitoring.mode](engine)}</span>
          </div>
          {monitoring.mode === 'tone' && (
            <div className="rp-field">
              <div className="rp-field__head">
                <span className="rp-sm" id="io-monitor-volume">
                  {t('Monitoring volume')}
                </span>
                <span className="rp-num rp-sm">{monitorPct} %</span>
              </div>
              <input
                type="range"
                className="rp-range"
                min={0}
                max={100}
                step={1}
                value={monitorPct}
                aria-labelledby="io-monitor-volume"
                style={{ '--v': `${monitorPct}%` } as CSSProperties}
                onChange={(e) => update((s) => ({ ...s, mix: { ...s.mix, monitor: Number(e.target.value) / 100 } }))}
                data-ui="input-monitor-volume"
              />
            </div>
          )}
          {engine && (
            <div className="rp-field">
              <div className="rp-field__head">
                <span className="rp-sm" id="io-buffer">
                  {t('Buffer')}
                </span>
                <span className="rp-field__hint">
                  {open && snap.bufferFrames && snap.bufferFrames !== snap.requestedFrames
                    ? `${t('requested')} ${snap.requestedFrames} · ${t('got')} ${snap.bufferFrames}`
                    : t('smaller is faster, but clicks are more likely')}
                </span>
              </div>
              <Seg<number>
                label={t('Buffer')}
                ui="input-buffer"
                value={buffer}
                options={BUFFERS.map((n) => [n, String(n)] as [number, string])}
                onChange={(bufferFrames) => setInput({ bufferFrames })}
              />
            </div>
          )}
          <RoundTrip open={open} snap={snap} />
        </section>

        <section className="rp-card io__wide io__stats" data-ui="input-delays">
          <div className="rp-stat">
            <span className="rp-label">{t('Audio delay')}</span>
            <span className="rp-stat__v">
              {calibrated ? Math.round(calibrated.ms) : '—'}
              <span className="rp-unit">{t('ms')}</span>
            </span>
            <span className="rp-stat__d">{calibrated ? t('calibrated') : t('not calibrated yet')}</span>
          </div>
          <div className="rp-stat">
            <span className="rp-label">{t('Picture delay')}</span>
            <span className="rp-stat__v">
              {settings.visualOffsetMs}
              <span className="rp-unit">{t('ms')}</span>
            </span>
            <span className="rp-stat__d">{t('display lag correction')}</span>
          </div>
          <div className="rp-field">
            <div className="rp-field__head">
              <span className="rp-label" id="io-a4">
                {t('Tuning reference')}
              </span>
            </div>
            <div className="rp-stepper" role="group" aria-labelledby="io-a4" data-ui="input-a4">
              <button type="button" aria-label={t('Lower')} disabled={a4 <= A4_MIN} onClick={() => setA4(a4 - 1)}>
                <GuitarIcon name="minus" size="sm" />
              </button>
              <output>
                A4 {a4} {t('Hz')}
              </output>
              <button type="button" aria-label={t('Higher')} disabled={a4 >= A4_MAX} onClick={() => setA4(a4 + 1)}>
                <GuitarIcon name="plus" size="sm" />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
