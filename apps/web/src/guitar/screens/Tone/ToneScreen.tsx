// Тон (гитарный процессор мониторинга) в виде железа: голова усилителя (металлическая панель, крутилки гейна и тонстека,
// громкость, каналы чистый · кранч · хай-гейн со светодиодами, тумблер питания с лампой), кабинет 4×12 (сетка, уголки,
// шильдик; выключатель — «без кабинета») и педали гейта, дилея и комнаты (футсвич, светодиод, свои крутилки). Сверху —
// как слышать себя. Всё пишет settings.tone и применяется на лету (InputSession → JACK-движок или ворклет браузера).
import type { CSSProperties, ReactNode } from 'react';
import { AMP_MODELS, DEFAULT_TONE, type AmpModelName, type ToneShape } from '../../../audio/guitar/tone';
import { t } from '../../../lib/i18n';
import { HashLink } from '../../HashLink';
import { useInputSnapshot } from '../../input/useInput';
import { updateGuitarSettings, useGuitarSettings } from '../../store/settings';
import { GuitarIcon } from '../../ui/GuitarIcon';
import { Knob } from './Knob';
import { Tubes } from './Tubes';
import './tone.css';

const MODEL_UI: Record<AmpModelName, { label: string }> = {
  clean: { label: 'Clean' },
  crunch: { label: 'Crunch' },
  'high-gain': { label: 'High gain' },
};
/** Ниже — гейт выключен (порог ядра −96 дБ); педаль включается на пороге по умолчанию. */
const GATE_OFF_DB = -120;
const GATE_MIN_DB = -90;

const setTone = (patch: Partial<ToneShape>) => updateGuitarSettings((s) => ({ ...s, tone: { ...s.tone, ...patch } }));
const setDelay = (patch: Partial<ToneShape['delay']>) => updateGuitarSettings((s) => ({ ...s, tone: { ...s.tone, delay: { ...s.tone.delay, ...patch } } }));

/** Ручка 0…1 как на усилителе: 0–10. */
const dial = (v: number) => (v * 10).toFixed(1).replace('.', ',');
const db = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(v % 1 ? 1 : 0)} ${t('dB')}`;
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Винты по углам (позиции — классами: соседние элементы не сбивают раскладку). */
const Screws = () => (
  <>
    {(['tl', 'tr', 'bl', 'br'] as const).map((at, i) => (
      <i key={at} className={`screw screw--${at}`} style={{ '--turn': `${[18, 72, 131, 47][i]}deg` } as CSSProperties} aria-hidden="true" />
    ))}
  </>
);
const Corners = ({ small }: { small?: boolean }) => (
  <>
    {(['tl', 'tr', 'bl', 'br'] as const).map((at) => (
      <i key={at} className={`amp-corner amp-corner--${at}${small ? ' amp-corner--sm' : ''}`} aria-hidden="true" />
    ))}
  </>
);

/** Педаль: литой корпус в металлической краске, джеки по бокам и питание сверху, винты, светодиод, крутилки, название,
 *  футсвич на шестигранной гайке. */
function Pedal(props: { name: string; color: string; on: boolean; onToggle: () => void; disabled?: boolean; ui: string; children: ReactNode }) {
  return (
    <div className="pedal" style={{ '--pedal': props.color } as CSSProperties} data-ui={props.ui} data-on={props.on || undefined}>
      <i className="pedal__jack pedal__jack--in" aria-hidden="true" />
      <i className="pedal__jack pedal__jack--out" aria-hidden="true" />
      <i className="pedal__dc" aria-hidden="true" />
      <Screws />
      <span className="pedal__led" aria-hidden="true" />
      <div className="pedal__knobs">{props.children}</div>
      <span className="pedal__name">{props.name}</span>
      <span className="pedal__nut">
        <button type="button" className="pedal__switch" role="switch" aria-checked={props.on} aria-label={props.name} disabled={props.disabled}
          onClick={props.onToggle} data-ui={`${props.ui}-switch`} />
      </span>
      <span className="pedal__brand" aria-hidden="true">Pupitre</span>
    </div>
  );
}

export function ToneScreen() {
  const [settings] = useGuitarSettings();
  const snap = useInputSnapshot();
  const tone = settings.tone;
  const through = settings.monitoring.mode === 'tone';
  const knob = (id: 'gain' | 'bass' | 'mid' | 'treble' | 'presence', label: string) => (
    <Knob ui={`tone-${id}`} label={label} value={tone[id]} min={0} max={1} step={0.01} initial={DEFAULT_TONE[id]} shown={dial(tone[id])} numbers
      onChange={(v) => setTone({ [id]: v })} />
  );
  const gateOn = tone.gateDb > -96;

  return (
    <div className="rp-page tone-page" data-ui="tone-screen" data-backend={snap.backend}>
      <div className="page-head">
        <div className="page-head__title">
          <span className="rp-label">{t('Guitar mode')}</span>
          <h1 className="rp-h1">{t('Tone')}</h1>
        </div>
        <button type="button" className="rp-btn rp-btn--ghost" onClick={() => setTone({ ...DEFAULT_TONE, on: tone.on })} data-ui="tone-reset">
          <GuitarIcon name="refresh" size="sm" />
          {t('Reset the sound')}
        </button>
      </div>

      {settings.input.deviceId === null && (
        <p className="tone-note" data-ui="tone-no-input">
          <GuitarIcon name="plug-x" size="sm" />
          {t('No input is chosen — the processor has nothing to process.')}{' '}
          <HashLink to="/guitar/input">{t('Choose an input')}</HashLink>
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

      <div className="rig">
        <div className="amp" data-on={tone.on || undefined}>
          <section className="amp-head" aria-label={t('Amp')} data-ui="tone-amp">
            <span className="amp-head__handle" aria-hidden="true">
              <i className="amp-head__strap" />
            </span>
            <Corners small />
            <div className="amp-head__bezel">
            <div className="amp-head__panel">
              <Screws />
              <div className="amp-head__jacks" aria-hidden="true">
                <span className="jack" />
                <span className="jack" />
                <span className="amp-head__engrave">Input</span>
              </div>
              <div className="amp-head__brand">
                <span className="amp-head__badge">
                  <span className="amp-head__logo">Pupitre</span>
                </span>
                <span className="amp-head__model">{t(MODEL_UI[tone.model].label)}</span>
              </div>
              <div className="amp-head__channels" role="radiogroup" aria-label={t('Amp')} data-ui="tone-model">
                {AMP_MODELS.map((model) => (
                  <button key={model} type="button" className="amp-btn" role="radio" aria-checked={tone.model === model} onClick={() => setTone({ model })}>
                    <i className="amp-btn__led" aria-hidden="true" />
                    {t(MODEL_UI[model].label)}
                  </button>
                ))}
              </div>
              <div className="amp-head__knobs">
                {knob('gain', t('Gain'))}
                {knob('bass', t('Bass'))}
                {knob('mid', t('Middle'))}
                {knob('treble', t('Treble'))}
                {knob('presence', t('Presence'))}
                <Knob ui="tone-level" label={t('Volume')} value={tone.levelDb} min={-24} max={12} step={0.5} initial={0} shown={db(tone.levelDb)}
                  onChange={(levelDb) => setTone({ levelDb })} />
              </div>
              <div className="amp-head__power">
                <span className="amp-jewel" aria-hidden="true" />
                <button type="button" className="amp-toggle" role="switch" aria-checked={tone.on} aria-label={t('Processor')} onClick={() => setTone({ on: !tone.on })}
                  data-ui="tone-on">
                  <i className="amp-toggle__bat" aria-hidden="true" />
                </button>
                <span className="amp-head__state">{tone.on ? t('Processor on') : t('Clean signal')}</span>
              </div>
            </div>
            </div>
            <Tubes hot={tone.on} />
          </section>

          <section className="amp-cab" aria-label={t('Cabinet 4×12')} data-ui="tone-cab" data-off={!tone.cab || undefined}>
            <Corners />
            <div className="amp-cab__grille">
              {[0, 1, 2, 3].map((i) => (
                <i key={i} className="amp-cab__cone" aria-hidden="true" />
              ))}
              <span className="amp-cab__badge">Pupitre</span>
              {!tone.cab && <span className="amp-cab__bypass">{t('No cabinet')}</span>}
            </div>
            <div className="amp-cab__plate">
              <span className="amp-head__engrave">On</span>
              <button type="button" className="amp-toggle" role="switch" aria-checked={tone.cab} aria-label={t('Cabinet 4×12')}
                onClick={() => setTone({ cab: !tone.cab })} data-ui="tone-cab-switch">
                <i className="amp-toggle__bat" aria-hidden="true" />
              </button>
              <span className="amp-head__engrave">Off</span>
            </div>
            <i className="amp-cab__foot amp-cab__foot--l" aria-hidden="true" />
            <i className="amp-cab__foot amp-cab__foot--r" aria-hidden="true" />
          </section>
        </div>
        <div className="pedalboard" data-ui="tone-fx">
          <Pedal ui="tone-gate" name={t('Noise gate')} color="#2f8f5b" on={gateOn} onToggle={() => setTone({ gateDb: gateOn ? GATE_OFF_DB : DEFAULT_TONE.gateDb })}>
            <Knob ui="tone-gate-threshold" label={t('Threshold')} value={Math.max(GATE_MIN_DB, tone.gateDb)} min={GATE_MIN_DB} max={-30} step={1}
              initial={DEFAULT_TONE.gateDb} shown={gateOn ? db(tone.gateDb) : t('off')} size={54} cap="chrome" onChange={(gateDb) => setTone({ gateDb })} />
          </Pedal>
          <Pedal ui="tone-delay" name={t('Delay')} color="#2d6fb3" on={tone.delay.mix > 0} onToggle={() => setDelay({ mix: tone.delay.mix > 0 ? 0 : 0.3 })}>
            <Knob ui="tone-delay-mix" label={t('Mix')} value={tone.delay.mix} min={0} max={1} step={0.01} initial={0.3} shown={pct(tone.delay.mix)}
              size={54} cap="chrome" onChange={(mix) => setDelay({ mix })} />
            <Knob ui="tone-delay-ms" label={t('Time')} value={tone.delay.ms} min={20} max={1500} step={10} initial={DEFAULT_TONE.delay.ms}
              shown={`${tone.delay.ms} ${t('ms')}`} size={54} cap="chrome" onChange={(ms) => setDelay({ ms })} />
            <Knob ui="tone-delay-feedback" label={t('Repeats')} value={tone.delay.feedback} min={0} max={0.9} step={0.01}
              initial={DEFAULT_TONE.delay.feedback} shown={pct(tone.delay.feedback)} size={54} cap="chrome" onChange={(feedback) => setDelay({ feedback })} />
          </Pedal>
          <Pedal ui="tone-room" name={t('Room')} color="#7a4fb0" on={tone.room > 0} onToggle={() => setTone({ room: tone.room > 0 ? 0 : DEFAULT_TONE.room })}>
            <Knob ui="tone-room-mix" label={t('Mix')} value={tone.room} min={0} max={1} step={0.01} initial={DEFAULT_TONE.room} shown={pct(tone.room)}
              size={54} cap="chrome" onChange={(room) => setTone({ room })} />
          </Pedal>
        </div>

      </div>
    </div>
  );
}
