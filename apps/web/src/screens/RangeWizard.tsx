// Визард определения диапазона голоса: удобная нота → вниз до предела →
// вверх до предела. Засчитываются только удержанные ноты (кольцо прогресса).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureMic, stopMic } from '../audio/audioSession';
import { LiveKeyboard } from '../components/LiveKeyboard';
import { ScreenHeader } from '../components/ScreenHeader';
import { RampaPoster } from '../components/RampaPoster';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';
import { t } from '../lib/i18n';
import { classifyRange, midiToName, type VocalRange } from '../lib/music';
import { micOptions } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import './vocal.css';

const name = (midi: number) => midiToName(midi).replace('#', '♯');

type Step = 'intro' | 'comfort' | 'low' | 'high' | 'done';

const HOLD_MS = 600;
const STABLE_SEMITONES = 0.7;
const VIEW_LOW = 36; // C2
const VIEW_HIGH = 84; // C6

export function RangeWizard() {
  const { profile, update } = useProfile();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('intro');
  const [micError, setMicError] = useState<string | null>(null);
  const [comfort, setComfort] = useState<number | null>(null);
  const [low, setLow] = useState<number | null>(profile.range?.lowMidi ?? null);
  const [high, setHigh] = useState<number | null>(profile.range?.highMidi ?? null);

  const liveMidiRef = useRef<number>(NaN);
  const holdProgressRef = useRef<number>(0);
  const holdRef = useRef<{ frames: number[]; startT: number } | null>(null);
  const stepRef = useRef<Step>(step);
  stepRef.current = step;

  const onSustained = useCallback((midi: number) => {
    const s = stepRef.current;
    if (s === 'comfort') {
      setComfort(midi);
      setLow((v) => (v == null || midi < v ? midi : v));
      setHigh((v) => (v == null || midi > v ? midi : v));
    } else if (s === 'low') {
      setLow((v) => (v == null || midi < v ? midi : v));
    } else if (s === 'high') {
      setHigh((v) => (v == null || midi > v ? midi : v));
    }
  }, []);

  useEffect(() => {
    if (step === 'intro' || step === 'done') return;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const tracker = await ensureMic(profile.micDeviceId, micOptions(profile));
        if (cancelled) return;
        unsub = tracker.onFrame((f) => {
          liveMidiRef.current = f.voiced ? f.midi : NaN;
          if (!f.voiced) {
            holdRef.current = null;
            holdProgressRef.current = 0;
            return;
          }
          const hold = holdRef.current;
          if (!hold) {
            holdRef.current = { frames: [f.midi], startT: f.t };
            return;
          }
          const median = medianOf(hold.frames);
          if (Math.abs(f.midi - median) > STABLE_SEMITONES) {
            holdRef.current = { frames: [f.midi], startT: f.t };
            holdProgressRef.current = 0;
            return;
          }
          hold.frames.push(f.midi);
          const heldMs = (f.t - hold.startT) * 1000;
          holdProgressRef.current = Math.min(1, heldMs / HOLD_MS);
          if (heldMs >= HOLD_MS) {
            onSustained(Math.round(medianOf(hold.frames)));
            // не сбрасываем hold: продолжение удержания продолжает обновлять границу
            hold.startT = f.t;
            hold.frames = hold.frames.slice(-10);
          }
        });
      } catch (e) {
        setMicError(e instanceof Error ? e.message : t('Microphone access failed'));
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [step === 'intro' || step === 'done', profile.micDeviceId, onSustained]);

  useEffect(() => () => stopMic(), []);

  const save = () => {
    if (low == null || high == null) return;
    const range: VocalRange = { lowMidi: low, highMidi: high };
    update({ range });
    stopMic();
    navigate('/');
  };

  const stepInfo: Record<Step, { title: string; hint: string }> = {
    intro: { title: t('Let’s find your range'), hint: '' },
    comfort: {
      title: t('Step 1 · A comfortable note'),
      hint: t('Sing any note that feels comfortable (“aaah”) and hold it until the ring closes.'),
    },
    low: {
      title: t('Step 2 · Down to the limit'),
      hint: t(
        'Walk your voice down in steps. Pause on each low note — the yellow line will move. Creaks don’t count :)',
      ),
    },
    high: {
      title: t('Step 3 · Up to the limit'),
      hint: t('Now up. Hold the top notes — the green line will move. No shouting: clean sound only.'),
    },
    done: { title: t('Ready'), hint: '' },
  };

  if (step === 'intro') {
    return (
      <div className="screen wizard rp-page vo-page" data-ui="vocal-range">
        <ScreenHeader
          backTo="/"
          eyebrow={t('My voice')}
          title={t('Let’s find your range')}
          subtitle={t(
            'The app adapts exercises and songs to your voice: it shows only your band of notes and moves melodies into your octave. Measure your range once — it takes a minute.',
          )}
        />
        <section className="rp-card vo-invite">
          <RampaPoster seed="meet-your-instrument" glyph="♪" className="vo-invite__poster" />
          <div className="vo-invite__body">
            <span className="rp-label">{t('Before the first note')}</span>
            <h2 className="rp-h2">{t('Range measurement')}</h2>
            <p className="rp-muted">{t('Three steps, about a minute.')}</p>
            <ul className="vo-tips">
              <li>
                <GuitarIcon name="headphones" />
                {t('Use headphones')}
              </li>
              <li>
                <GuitarIcon name="ear" />
                {t('Find a quiet spot')}
              </li>
              <li>
                <GuitarIcon name="microphone" />
                {t('Allow microphone access')}
              </li>
            </ul>
            {micError && <p className="vo-error">{micError}</p>}
            <button className="rp-btn rp-btn--light rp-btn--lg btn primary big" onClick={() => setStep('comfort')}>
              {t('Find my range')}
              <GuitarIcon name="arrow-right" />
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (step === 'done' && low != null && high != null) {
    return (
      <div className="screen wizard rp-page vo-page" data-ui="vocal-range-done">
        <ScreenHeader backTo="/" eyebrow={t('My voice')} title={t('Your range')} />
        <section className="rp-card rp-card--pad vo-range-done">
          <span className="vo-range-done__notes rp-num">
            {name(low)} <span className="rp-faint">–</span> {name(high)}
          </span>
          <span className="rp-chip rp-chip--plain">
            {t(classifyRange(low, high))} · {t('{n} semitones', { n: high - low })}
          </span>
          <p className="rp-muted">{t('Exercises and songs are now tuned to this zone. You can remeasure anytime.')}</p>
          <div className="vo-row">
            <button
              className="rp-btn"
              onClick={() => {
                setLow(null);
                setHigh(null);
                setComfort(null);
                setStep('comfort');
              }}
            >
              <GuitarIcon name="refresh" size="sm" />
              {t('Remeasure')}
            </button>
            <button className="rp-btn rp-btn--light" onClick={save}>
              <GuitarIcon name="check" size="sm" />
              {t('Save')}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const canNext = step === 'comfort' ? comfort != null : step === 'low' ? low != null : high != null;

  const stepNo = step === 'comfort' ? 1 : step === 'low' ? 2 : 3;
  return (
    <div className="screen wizard wizard-live vo-live" data-ui="vocal-range-live">
      <div className="rp-card rp-card--pad vo-live__panel">
        <div className="vo-steps" aria-label={t('Step {n} of 3', { n: stepNo })}>
          {[1, 2, 3].map((n) => (
            <i key={n} className={n <= stepNo ? 'on' : ''} />
          ))}
        </div>
        <h1 className="rp-h2">{stepInfo[step].title}</h1>
        <p className="rp-muted">{stepInfo[step].hint}</p>
        {micError && <p className="vo-error">{micError}</p>}
        <div className="vo-live__status rp-num">
          {step === 'comfort' && comfort != null && (
            <span className="rp-chip rp-chip--ok">{t('Comfort note: {note} ✓', { note: name(comfort) })}</span>
          )}
          {step === 'low' && low != null && <span className="rp-chip">{t('Low bound: {note}', { note: name(low) })}</span>}
          {step === 'high' && high != null && <span className="rp-chip">{t('High bound: {note}', { note: name(high) })}</span>}
        </div>
        <div className="vo-row">
          <button className="rp-btn rp-btn--ghost" onClick={() => navigate('/')}>
            {t('Cancel')}
          </button>
          <button
            className="rp-btn rp-btn--light"
            disabled={!canNext}
            onClick={() => setStep(step === 'comfort' ? 'low' : step === 'low' ? 'high' : 'done')}
          >
            {step === 'high' ? t('Ready') : t('Next')}
            <GuitarIcon name="arrow-right" size="sm" />
          </button>
        </div>
      </div>
      <LiveKeyboard
        lowMidi={VIEW_LOW}
        highMidi={VIEW_HIGH}
        liveMidiRef={liveMidiRef}
        holdProgressRef={holdProgressRef}
        markLow={low}
        markHigh={high}
      />
    </div>
  );
}

function medianOf(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
