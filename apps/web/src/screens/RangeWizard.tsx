// Визард определения диапазона голоса: удобная нота → вниз до предела →
// вверх до предела. Засчитываются только удержанные ноты (кольцо прогресса).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureMic, stopMic } from '../audio/audioSession';
import { LiveKeyboard } from '../components/LiveKeyboard';
import { ScreenHeader } from '../components/ScreenHeader';
import { Icon } from '../components/Icon';
import { StudioArtwork } from '../components/StudioArtwork';
import { t } from '../lib/i18n';
import { classifyRange, midiToName, type VocalRange } from '../lib/music';
import { micOptions } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';

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
      <div className="screen wizard">
        <ScreenHeader
          title={t('Let’s find your range')}
          subtitle={t(
            'The app adapts exercises and songs to your voice: it shows only your band of notes and moves melodies into your octave. Measure your range once — it takes a minute.',
          )}
        />
        <section className="wizard-intro">
          <div>
            <span className="overline">{t('Before the first note')}</span>
            <h2>{t('Meet your instrument.')}</h2>
            <p className="dim small">{t('Three simple steps. Nothing to prove. Just sing comfortably.')}</p>
            <ul className="tips">
              <li>
                <Icon name="headphones" size={20} />
                {t('Use headphones')}
              </li>
              <li>
                <Icon name="ear" size={20} />
                {t('Find a quiet spot')}
              </li>
              <li>
                <Icon name="mic" size={20} />
                {t('Allow microphone access')}
              </li>
            </ul>
            {micError && <p className="error">{micError}</p>}
            <button className="btn primary big" onClick={() => setStep('comfort')}>
              {t('Find my range')}
              <Icon name="arrow" size={18} />
            </button>
          </div>
          <StudioArtwork />
        </section>
      </div>
    );
  }

  if (step === 'done' && low != null && high != null) {
    return (
      <div className="screen wizard">
        <ScreenHeader title={t('Your range')} />
        <div className="range-result">
          <span className="range-notes">
            {midiToName(low)} – {midiToName(high)}
          </span>
          <span className="range-class">
            {t(classifyRange(low, high))} · {t('{n} semitones', { n: high - low })}
          </span>
        </div>
        <p className="lead">
          {t('Exercises and songs are now tuned to this zone. You can remeasure anytime.')}
        </p>
        <div className="btn-row">
          <button
            className="btn"
            onClick={() => {
              setLow(null);
              setHigh(null);
              setComfort(null);
              setStep('comfort');
            }}
          >
            {t('Remeasure')}
          </button>
          <button className="btn primary" onClick={save}>
            {t('Save')}
          </button>
        </div>
      </div>
    );
  }

  const canNext = step === 'comfort' ? comfort != null : step === 'low' ? low != null : high != null;

  return (
    <div className="screen wizard wizard-live">
      <div className="wizard-panel">
        <div
          className="wizard-steps"
          aria-label={t('Step {n} of 3', { n: step === 'comfort' ? 1 : step === 'low' ? 2 : 3 })}
        >
          {[0, 1, 2].map((n) => (
            <i key={n} className={n <= (step === 'comfort' ? 0 : step === 'low' ? 1 : 2) ? 'active' : ''} />
          ))}
        </div>
        <ScreenHeader title={stepInfo[step].title} />
        <p className="lead">{stepInfo[step].hint}</p>
        {micError && <p className="error">⚠️ {micError}</p>}
        <div className="wizard-status">
          {step === 'comfort' && comfort != null && (
            <span>{t('Comfort note: {note} ✓', { note: midiToName(comfort) })}</span>
          )}
          {step === 'low' && low != null && <span>{t('Low bound: {note}', { note: midiToName(low) })}</span>}
          {step === 'high' && high != null && (
            <span>{t('High bound: {note}', { note: midiToName(high) })}</span>
          )}
        </div>
        <div className="btn-row">
          <button
            className="btn primary"
            disabled={!canNext}
            onClick={() => setStep(step === 'comfort' ? 'low' : step === 'low' ? 'high' : 'done')}
          >
            {step === 'high' ? t('Ready') : t('Next')}
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
