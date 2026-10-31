// Тон (гитарный процессор мониторинга) в виде железа: голова усилителя (металлическая панель, крутилки гейна и тонстека,
// громкость, каналы чистый · кранч · хай-гейн со светодиодами, тумблер питания с лампой), кабинет 4×12 (сетка, уголки,
// шильдик; выключатель — «без кабинета») — или басовый комплект (BassRig.tsx: голова на 4×10) — и педалборд. Сверху —
// как слышать себя и комплект. Всё пишет settings.tone и применяется на лету (InputSession → JACK-движок или ворклет браузера).
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AMP_MODELS, DEFAULT_TONE, type AmpModelName, type ToneShape } from '../../../audio/guitar/tone';
import { t } from '../../../lib/i18n';
import { HashLink } from '../../HashLink';
import { useInputSnapshot } from '../../input/useInput';
import { useInGameSheet } from '../../play/inGame';
import { updateGuitarSettings, useGuitarSettings } from '../../store/settings';
import { GuitarIcon } from '../../ui/GuitarIcon';
import { BassRig } from './BassRig';
import { CarryHandle, Corners, Jewel, Screws, ToggleSwitch } from './Hardware';
import { Knob } from './Knob';
import { Pedalboard } from './Pedalboard';
import { PresetBar } from './PresetBar';
import { PupitreLogo } from './PupitreLogo';
import { Recorder, TakeList } from './Recorder';
import { Tubes } from './Tubes';
import './tone.css';

const MODEL_UI: Record<AmpModelName, { label: string }> = {
  clean: { label: 'Clean' },
  crunch: { label: 'Crunch' },
  'high-gain': { label: 'High gain' },
};

const setTone = (patch: Partial<ToneShape>) => updateGuitarSettings((s) => ({ ...s, tone: { ...s.tone, ...patch } }));
const updateTone = (patch: (tone: ToneShape) => Partial<ToneShape>) => updateGuitarSettings((s) => ({ ...s, tone: { ...s.tone, ...patch(s.tone) } }));

/** Ручка 0…1 как на усилителе: 0–10. */
const dial = (v: number) => (v * 10).toFixed(1).replace('.', ',');
const db = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(v % 1 ? 1 : 0)} ${t('dB')}`;
const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * Установка рисуется в расчётной ширине (DESIGN_W — ширина головы и кабинета) и масштабируется zoom до ширины страницы,
 * как карточка «Слышать себя». zoom участвует в раскладке — под установкой не остаётся пустоты, как от transform; на узких
 * экранах не мельче MIN_ZOOM, чтобы ручки оставались крутибельными.
 */
const DESIGN_W = 880;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.3;
function useFitZoom() {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) return;
    const fit = () => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, box.clientWidth / DESIGN_W)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return [ref, zoom] as const;
}

export function ToneScreen() {
  const [settings] = useGuitarSettings();
  const snap = useInputSnapshot();
  const tone = settings.tone;
  const [rigRef, zoom] = useFitZoom();
  const inGame = useInGameSheet();
  const through = settings.monitoring.mode === 'tone';
  const knob = (id: 'gain' | 'bass' | 'mid' | 'treble' | 'presence', label: string, name: string) => (
    <Knob ui={`tone-${id}`} label={label} name={name} value={tone[id]} min={0} max={1} step={0.01} initial={DEFAULT_TONE[id]} shown={dial(tone[id])} numbers
      onChange={(v) => setTone({ [id]: v })} />
  );

  return (
    <div className="rp-page tone-page" data-ui="tone-screen" data-backend={snap.backend}>
      <div className="page-head">
        <div className="page-head__title">
          <span className="rp-label">{t('Guitar mode')}</span>
          <h1 className="rp-h1">{t('Tone')}</h1>
        </div>
        <button type="button" className="rp-btn rp-btn--ghost" data-ui="tone-reset"
          onClick={() => updateGuitarSettings((s) => ({ ...s, tone: { ...DEFAULT_TONE, on: s.tone.on, rig: s.tone.rig }, monitoring: { ...s.monitoring, toneId: undefined } }))}>
          <GuitarIcon name="refresh" size="sm" />
          {t('Reset the sound')}
        </button>
      </div>

      {settings.input.deviceId === null && (
        <p className="tone-note" data-ui="tone-no-input">
          <GuitarIcon name="plug-x" size="sm" />
          {t('No input is chosen — the processor has nothing to process.')}{' '}
          {inGame ? t('It is chosen in Input and sound.') : <HashLink to="/guitar/input">{t('Choose an input')}</HashLink>}
        </p>
      )}

      <section className="rp-card tone-monitor" aria-labelledby="tone-hear" data-ui="tone-monitor">
        <span className="rp-section-title">
          <GuitarIcon name="headphones" size="sm" />
          <span className="rp-label" id="tone-hear">
            {t('Hear yourself')}
          </span>
        </span>
        <div className="rp-seg" role="radiogroup" aria-label={t('Hear yourself')} data-ui="tone-through">
          {[true, false].map((on) => (
            <button key={String(on)} type="button" className="rp-seg__item" role="radio" aria-checked={through === on}
              onClick={() => updateGuitarSettings((s) => ({ ...s, monitoring: { ...s.monitoring, mode: on ? 'tone' : 'off' } }))}>
              {on ? t('Through Pupitre') : t('Do not hear')}
            </button>
          ))}
        </div>
        {through && (
          <label className="tone-monitor__volume">
            <span className="rp-sm">{t('Monitoring volume')}</span>
            <input type="range" className="rp-range" min={0} max={100} value={Math.round(settings.mix.monitor * 100)}
              style={{ '--v': `${Math.round(settings.mix.monitor * 100)}%` } as CSSProperties}
              onChange={(e) => updateGuitarSettings((s) => ({ ...s, mix: { ...s.mix, monitor: Number(e.target.value) / 100 } }))} data-ui="tone-volume" />
            <span className="rp-num rp-sm">{pct(settings.mix.monitor)}</span>
          </label>
        )}
        <span className="tone-monitor__note">
          {!through
            ? t('Choose “Through Pupitre” to hear the processor. Headphones only: from speakers the sound gets back into the input.')
            : snap.backend === 'engine'
              ? t('The native engine processes the guitar with a delay of a few milliseconds.')
              : t('In the browser the delay is noticeable; the desktop app on Linux uses the low-latency engine.')}
        </span>
      </section>

      <PresetBar tone={tone} toneId={settings.monitoring.toneId} />

      <div className="rig" ref={rigRef} style={{ zoom }}>
        {tone.rig === 'bass' ? <BassRig tone={tone} update={updateTone} /> : (
        <div className="amp" data-on={tone.on || undefined}>
          <section className="amp-head" aria-label={t('Amp')} data-ui="tone-amp">
            <CarryHandle />
            <Corners small />
            <div className="amp-head__bezel">
            <div className="amp-head__panel">
              <Screws />
              <div className="amp-head__jacks" aria-hidden="true">
                <span className="jack" />
                <span className="amp-head__engrave">Input</span>
              </div>
              <div className="amp-head__brand">
                <span className="amp-head__badge">
                  <PupitreLogo finish="chrome" className="amp-head__logo" />
                </span>
                <span className="amp-head__model" aria-hidden="true">CUSTOM • 100</span>
              </div>
              <div className="amp-head__channels" role="radiogroup" aria-label={t('Amp')} data-ui="tone-model">
                {AMP_MODELS.map((model) => (
                  <button key={model} type="button" className="amp-btn" role="radio" aria-checked={tone.model === model} onClick={() => setTone({ model })}>
                    <i className="amp-btn__led" aria-hidden="true" />
                    <span className="amp-btn__label">{t(MODEL_UI[model].label)}</span>
                  </button>
                ))}
              </div>
              <div className="amp-head__knobs">
                {knob('gain', 'Gain', t('Gain'))}
                {knob('bass', 'Bass', t('Bass'))}
                {knob('mid', 'Middle', t('Middle'))}
                {knob('treble', 'Treble', t('Treble'))}
                {knob('presence', 'Presence', t('Presence'))}
                <Knob ui="tone-level" label="Volume" name={t('Volume')} value={tone.levelDb} min={-24} max={12} step={0.5} initial={0} shown={db(tone.levelDb)}
                  onChange={(levelDb) => setTone({ levelDb })} />
              </div>
              <div className="amp-head__power">
                <Jewel on={tone.on} />
                <ToggleSwitch checked={tone.on} onToggle={() => setTone({ on: !tone.on })} label={t('Processor')}
                  title={tone.on ? t('Processor on') : t('Clean signal')} ui="tone-on" />
                <span className="amp-head__state" aria-hidden="true">POWER</span>
              </div>
            </div>
            </div>
            <Tubes hot={tone.on} />
            <i className="amp-head__foot amp-head__foot--l" aria-hidden="true" />
            <i className="amp-head__foot amp-head__foot--r" aria-hidden="true" />
          </section>

          <section className="amp-cab" aria-label={t('Cabinet 4×12')} data-ui="tone-cab" data-off={!tone.cab || undefined}>
            <Corners />
            <div className="amp-cab__grille">
              {[0, 1, 2, 3].map((i) => (
                <i key={i} className="amp-cab__cone" aria-hidden="true" />
              ))}
              <PupitreLogo finish="cream" className="amp-cab__badge" />
            </div>
            <div className="amp-cab__plate">
              <span className="amp-cab__spec" aria-hidden="true">PUPITRE<br />4 × 12</span>
              <span className="amp-head__engrave" aria-hidden="true">CAB · ON</span>
              <ToggleSwitch checked={tone.cab} onToggle={() => setTone({ cab: !tone.cab })} label={t('Cabinet 4×12')}
                title={tone.cab ? t('Cabinet 4×12') : t('No cabinet')} ui="tone-cab-switch" />
              <span className="amp-head__engrave" aria-hidden="true">BYPASS</span>
            </div>
            <i className="amp-cab__foot amp-cab__foot--l" aria-hidden="true" />
            <i className="amp-cab__foot amp-cab__foot--r" aria-hidden="true" />
          </section>
        </div>
        )}
        <Pedalboard tone={tone} update={updateTone} />
        <Recorder inputChosen={settings.input.deviceId !== null} />
      </div>
      <TakeList />
    </div>
  );
}
