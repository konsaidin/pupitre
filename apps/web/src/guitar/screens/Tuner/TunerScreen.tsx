// Тюнер (/guitar/tuner): хроматический режим и режим по струнам пресета строя. Кадры анализа входа — onInputFrames
// (вход держит InputSession на весь раздел, экран только подписывается); логика — tuner/tuner.ts. Крупная нота, шкала
// −50…+50 центов со стрелкой и зоной «в строю» (±3), частота основного тона и цели при эталоне. По струнам: пресет (при
// открытии — сохранённый строй, если он пресет инструмента настроек, иначе его стандарт), струна выбирается сама, у
// каждой — состояние последнего замера; «Сохранить строй» пишет замеры в reference.tuning и measuredAt, когда сняты все
// струны пресета. Эталон A4 — общий степпер (ui/ReferenceStepper). Стрелка и частота пишутся в DOM из кадра анимации
// (как шкалы входа), остальное — React, только когда меняется округлённый показ. Без входа — пустое состояние со
// ссылкой на «Вход и звук».
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { onInputFrames } from '../../../audio/instrument/session';
import { currentLang, t } from '../../../lib/i18n';
import { HashLink } from '../../HashLink';
import { count } from '../../i18n';
import { inputOpen, noiseKeyOf, pillView } from '../../input/inputView';
import { useInputSnapshot } from '../../input/useInput';
import { useGuitarSettings } from '../../store/settings';
import {
  createTuner, floorDbOf, formatCents, initialPreset, noteName, noteParts, presetById, presetFlats, presetName, PRESETS,
  referenceShift, savedTuningName, statusOf, tuningToSave, type TuneStatus, type TunerConfig, type TunerPhase,
} from '../../tuner/tuner';
import { GuitarIcon, type GuitarIconName } from '../../ui/GuitarIcon';
import { ReferenceStepper } from '../../ui/ReferenceStepper';
import './tuner.css';

type Mode = 'strings' | 'chromatic';

const MODES: Record<Mode, { label: string }> = {
  strings: { label: 'By strings' },
  chromatic: { label: 'Chromatic' },
};

// Подсказка под шкалой: по струнам — что делать с колком, в хроматике — где высота. Стрелка — куда тянуть.
const HINTS: Record<Mode, Record<TuneStatus, { label: string; icon: GuitarIconName }>> = {
  strings: {
    in: { label: 'In tune', icon: 'circle-check' },
    sharp: { label: 'Loosen the string', icon: 'chevron-down' },
    flat: { label: 'Tighten the string', icon: 'chevron-up' },
  },
  chromatic: {
    in: { label: 'In tune', icon: 'circle-check' },
    sharp: { label: 'Above the note', icon: 'chevron-down' },
    flat: { label: 'Below the note', icon: 'chevron-up' },
  },
};

const STRING_STATES: Record<TuneStatus | 'none', { label: string }> = {
  in: { label: 'in tune' },
  sharp: { label: 'sharp' },
  flat: { label: 'flat' },
  none: { label: 'not measured' },
};
const STRING_ICONS: Record<TuneStatus, GuitarIconName> = { in: 'check', sharp: 'chevron-down', flat: 'chevron-up' };

/** Деления шкалы через 5 центов; крупные — через 25. */
const TICKS = Array.from({ length: 21 }, (_, i) => i * 5 - 50);
/** Подпись «Сохранить строй» → «Строй сохранён» на столько мс. */
const SAVED_FLASH_MS = 2500;

/** «82,41» / «82.41»: ниже 100 Гц — сотые (±3 цента у низких струн — десятые доли герца), выше — десятые. */
const formatHz = (hz: number) => (Number.isFinite(hz) ? hz.toFixed(hz < 100 ? 2 : 1).replace('.', currentLang() === 'ru' ? ',' : '.') : '—');
const formatWhen = (ms: number) =>
  new Date(ms).toLocaleString(currentLang() === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

interface View {
  phase: TunerPhase;
  /** Цель (целый MIDI); NaN — показывать нечего. */
  note: number;
  cents: number;
  status: TuneStatus;
  string: number;
  targetHz: number;
  /** Замеры струн (копия), MIDI при A4 = 440. */
  measured: number[];
}
const NO_VIEW: View = { phase: 'none', note: NaN, cents: NaN, status: 'in', string: -1, targetHz: NaN, measured: [] };

/**
 * Тюнер на кадрах входа: настройка — до отрисовки (замеры другого пресета не мелькают), стрелка (--d на шкале) и
 * частота — в DOM каждый кадр анимации, показ для React — только при смене округлённых значений.
 */
function useTuner(config: TunerConfig, gauge: RefObject<HTMLDivElement>, hz: RefObject<HTMLElement>): View {
  const [tuner] = useState(() => createTuner(config));
  const [view, setView] = useState<View>(NO_VIEW);
  const shownKey = useRef('');

  const paint = useCallback(() => {
    const r = tuner.read(performance.now());
    const measured = tuner.measured();
    const d = Number.isFinite(r.cents) ? Math.max(-1, Math.min(1, r.cents / 50)) : 0;
    gauge.current?.style.setProperty('--d', d.toFixed(4));
    const text = formatHz(r.hz);
    if (hz.current && hz.current.textContent !== text) hz.current.textContent = text;
    const key = [r.phase, r.note, Math.round(r.cents), r.string, Math.round(r.targetHz * 100), ...measured.map((m) => Math.round(m * 100))].join('|');
    if (key === shownKey.current) return;
    shownKey.current = key;
    setView({ phase: r.phase, note: r.note, cents: r.cents, status: r.status, string: r.string, targetHz: r.targetHz, measured: [...measured] });
  }, [tuner, gauge, hz]);

  const { a4Hz, open, floorDb } = config;
  useLayoutEffect(() => {
    tuner.configure({ a4Hz, open, floorDb });
    paint();
  }, [tuner, paint, a4Hz, open, floorDb]);
  useEffect(() => onInputFrames((frame) => tuner.push(frame)), [tuner]);
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      paint();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paint]);
  return view;
}

/** Нота крупно: буква, знак альтерации, октава. */
function BigNote({ note, flats }: { note: number; flats: boolean }) {
  if (!Number.isFinite(note)) return <>—</>;
  const { pitch, octave } = noteParts(note, flats);
  return (
    <>
      {pitch[0]}
      {pitch.length > 1 && <span className="tuner__acc">{pitch.slice(1)}</span>}
      <span className="tuner__oct">{octave}</span>
    </>
  );
}

function TunerBody({ opening }: { opening: boolean }) {
  const [settings, update] = useGuitarSettings();
  const { a4Hz, tuning: saved, measuredAt } = settings.reference;
  const [mode, setMode] = useState<Mode>('strings');
  const [presetId, setPresetId] = useState(() => initialPreset(settings.instrument.default, saved, a4Hz).id);
  const [flash, setFlash] = useState(0);
  const gauge = useRef<HTMLDivElement>(null);
  const hz = useRef<HTMLElement>(null);
  const preset = presetById(presetId);
  const byStrings = mode === 'strings';
  const flats = byStrings && presetFlats(preset);
  const { deviceId, channel, noiseDb, noiseKey } = settings.input;
  // фон, измеренный на этом входе, поднимает порог; на другом — порог по умолчанию
  const floorDb = floorDbOf(noiseKey === noiseKeyOf(deviceId, channel) && typeof noiseDb === 'number' ? noiseDb : NaN);
  const view = useTuner({ a4Hz, open: byStrings ? preset.open : null, floorDb }, gauge, hz);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(0), SAVED_FLASH_MS);
    return () => clearTimeout(id);
  }, [flash]);

  const shift = referenceShift(a4Hz);
  const has = Number.isFinite(view.note);
  const live = has && view.phase !== 'none';
  const hint = HINTS[mode][view.status];
  const active = live && byStrings ? view.string : -1;
  const measured = byStrings ? view.measured : [];
  const toSave = byStrings && measured.length === preset.open.length ? tuningToSave(measured) : null;
  const done = measured.filter(Number.isFinite).length;

  function save() {
    if (!toSave) return;
    update((s) => ({ ...s, reference: { ...s.reference, tuning: toSave, measuredAt: Date.now() } }));
    setFlash(Date.now());
  }

  const target =
    byStrings && view.string >= 0 && has ? `${t('String')} ${preset.open.length - view.string}`
    : byStrings ? presetName(preset)
    : t('Nearest note');
  const idle = opening ? t('Opening the input…') : byStrings ? t('Play an open string') : t('Play a note');

  return (
    <div className="tuner-page">
      <div className="page-head">
        <div className="page-head__title">
          <span className="rp-label">{t('Guitar mode')}</span>
          <h1 className="rp-h1">{t('Tuner')}</h1>
        </div>
        <div className="rp-seg" role="radiogroup" aria-label={t('Tuner mode')} data-ui="tuner-mode">
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <button key={m} type="button" className="rp-seg__item" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
              {t(MODES[m].label)}
            </button>
          ))}
        </div>
      </div>
      <p className="rp-sr" aria-live="polite" data-ui="tuner-live">
        {live && view.phase === 'live' ? `${noteName(view.note, flats)}: ${t(hint.label)}` : ''}
        {flash ? t('Tuning saved') : ''}
      </p>

      <div className="tuner">
        <section
          className="rp-card tuner__stage"
          aria-labelledby="tuner-target"
          data-ui="tuner-stage"
          data-mode={mode}
          data-phase={has ? view.phase : 'empty'}
          data-status={live ? view.status : undefined}
        >
          <div className="rp-card__head">
            <span className="rp-section-title">
              <GuitarIcon name="c-fork" size="sm" />
              <span className="rp-label" id="tuner-target" data-ui="tuner-target">
                {target}
              </span>
            </span>
            <span className="tuner__ref">
              <span className="rp-label" id="tuner-a4">
                {t('Tuning reference')}
              </span>
              <ReferenceStepper labelledBy="tuner-a4" ui="tuner-a4" />
            </span>
          </div>

          <div className="tuner__note" data-ui="tuner-note" aria-hidden="true">
            <BigNote note={view.note} flats={flats} />
          </div>

          <div className="tuner__meter" aria-hidden="true">
            <div className="tuner__gauge" ref={gauge} style={{ '--d': 0 } as CSSProperties} data-ui="tuner-gauge">
              {TICKS.map((c) => (
                <i key={c} className="tuner__tick" data-major={c % 25 === 0 || undefined} style={{ '--x': c / 50 } as CSSProperties} />
              ))}
              <span className="tuner__zone" />
              <span className="tuner__fill" />
              <span className="tuner__needle" />
            </div>
            <div className="tuner__marks">
              <span>−50</span>
              <span>−25</span>
              <span>0</span>
              <span>+25</span>
              <span>+50</span>
            </div>
          </div>

          <div className="tuner__readouts">
            <span className="tuner__cents" data-ui="tuner-cents">
              <b className="rp-num">{has ? formatCents(view.cents) : '—'}</b>
              <span className="rp-unit">¢</span>
            </span>
            {live ? (
              <span className={`rp-chip tuner__hint${view.status === 'in' ? ' rp-chip--ok' : ''}`} data-ui="tuner-hint" data-status={view.status}>
                <GuitarIcon name={hint.icon} size="sm" />
                {t(hint.label)}
              </span>
            ) : (
              <span className={`rp-chip tuner__hint${opening ? ' rp-chip--spin' : ''}`} data-ui="tuner-hint">
                <GuitarIcon name={opening ? 'loader-2' : 'ear'} size="sm" />
                {idle}
              </span>
            )}
            <span className="tuner__hz">
              <span>
                <b className="rp-num" ref={hz} data-ui="tuner-hz" />
                <span className="rp-unit">{t('Hz')}</span>
              </span>
              <small className="rp-num" data-ui="tuner-target-hz">
                {has ? `${noteName(view.note, flats)} · ${formatHz(view.targetHz)} ${t('Hz')}` : ' '}
              </small>
            </span>
          </div>
        </section>

        {byStrings && (
          <section className="rp-card tuner__tuning" aria-labelledby="tuner-preset" data-ui="tuner-tuning">
            <div className="rp-card__head">
              <span className="rp-section-title">
                <GuitarIcon name="c-strings" size="sm" />
                <span className="rp-label" id="tuner-preset">
                  {t('Tuning')}
                </span>
              </span>
              <span className="rp-field__hint" data-ui="tuner-measured">
                {t('Strings measured: {n} of {total}', { n: done, total: preset.open.length })}
              </span>
            </div>

            <div className="tuner__presets" role="radiogroup" aria-labelledby="tuner-preset" data-ui="tuner-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="tuner__preset"
                  role="radio"
                  aria-checked={p.id === preset.id}
                  onClick={() => setPresetId(p.id)}
                  data-preset={p.id}
                >
                  <b>{presetName(p)}</b>
                  <small>
                    {p.instrument === 'bass' ? `${t('Bass')} · ` : ''}
                    {count(p.open.length, 'string')}
                  </small>
                </button>
              ))}
            </div>

            <ol className="tuner__strings" aria-label={t('Strings')} style={{ '--n': preset.open.length } as CSSProperties} data-ui="tuner-strings">
              {preset.open.map((open, i) => {
                const m = measured[i];
                const cents = Number.isFinite(m) ? (m - shift - open) * 100 : NaN;
                const state = Number.isFinite(cents) ? statusOf(cents) : 'none';
                const number = preset.open.length - i;
                const { pitch, octave } = noteParts(open, flats);
                return (
                  <li
                    key={`${preset.id}-${i}`}
                    className="tuner__string"
                    style={{ '--c': `var(--rp-str-${i}-text)` } as CSSProperties}
                    data-state={state}
                    data-active={i === active || undefined}
                    data-ui="tuner-string"
                  >
                    <span className="rp-sr">
                      {`${t('String')} ${number}, ${pitch}${octave}: ${t(STRING_STATES[state].label)}${state === 'sharp' || state === 'flat' ? ` ${formatCents(cents)} ¢` : ''}`}
                    </span>
                    <small className="rp-num" aria-hidden="true">
                      {number}
                    </small>
                    <b aria-hidden="true">
                      {pitch}
                      <sub>{octave}</sub>
                    </b>
                    <span className="tuner__string-state rp-num" aria-hidden="true">
                      {state !== 'none' && <GuitarIcon name={STRING_ICONS[state]} size="sm" />}
                      {state === 'none' ? '—' : state === 'in' ? '' : formatCents(cents)}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="tuner__foot">
              <span className="rp-sm rp-faint" data-ui="tuner-saved">
                {saved?.length && measuredAt
                  ? `${t('Saved tuning')}: ${savedTuningName(saved, a4Hz)} · ${formatWhen(measuredAt)}`
                  : toSave ? '' : t('Play every open string — then the tuning can be saved.')}
              </span>
              <button type="button" className="rp-btn rp-btn--light" disabled={!toSave} onClick={save} data-ui="tuner-save">
                <GuitarIcon name={flash ? 'check' : 'device-floppy'} size="sm" />
                {flash ? t('Tuning saved') : t('Save tuning')}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export function TunerScreen() {
  const [settings] = useGuitarSettings();
  const snap = useInputSnapshot();
  const chosen = settings.input.deviceId !== null;
  // выбранный вход открывается (off — до первого открытия) или открыт — тюнер; не открылся — почему и куда идти
  const working = chosen && (inputOpen(snap.state) || snap.state === 'opening' || snap.state === 'off');
  if (working) {
    return (
      <div className="rp-page" data-ui="tuner-screen" data-input={snap.state}>
        <TunerBody opening={!inputOpen(snap.state)} />
      </div>
    );
  }
  const pill = pillView(snap, chosen, settings.input.deviceLabel ?? '');
  return (
    <div className="rp-page" data-ui="tuner-screen" data-input={snap.state}>
      <div className="rp-empty tuner__empty" data-ui="tuner-no-input">
        <GuitarIcon name="c-fork" size="xl" />
        <h1 className="rp-h1">{t('Tuner')}</h1>
        {chosen && <span className="rp-chip rp-chip--warn rp-chip--dot">{pill.name}</span>}
        <p>{chosen ? pill.title : t('The tuner listens to the instrument input. Choose it in Input and sound.')}</p>
        <HashLink className="rp-btn rp-btn--light" to="/guitar/input" data-ui="tuner-to-input">
          <GuitarIcon name="plug-connected" size="sm" />
          {t('Input and sound')}
        </HashLink>
      </div>
    </div>
  );
}
