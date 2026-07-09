// Визард определения диапазона голоса: удобная нота → вниз до предела →
// вверх до предела. Засчитываются только удержанные ноты (кольцо прогресса).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureMic, stopMic } from '../audio/audioSession';
import { LiveKeyboard } from '../components/LiveKeyboard';
import { ScreenHeader } from '../components/ScreenHeader';
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
        setMicError(e instanceof Error ? e.message : 'Не удалось получить доступ к микрофону');
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
    intro: { title: 'Определим твой диапазон', hint: '' },
    comfort: {
      title: 'Шаг 1 · Удобная нота',
      hint: 'Спой любую ноту, на которой тебе комфортно («а-а-а»), и удержи её, пока кольцо не замкнётся.',
    },
    low: {
      title: 'Шаг 2 · Вниз до предела',
      hint: 'Веди голос ступеньками вниз. На каждой нижней ноте задержись — жёлтая линия сдвинется. Хрип и скрип не считаются :)',
    },
    high: {
      title: 'Шаг 3 · Вверх до предела',
      hint: 'Теперь вверх. Задерживайся на верхних нотах — зелёная линия сдвинется. Без крика: только чистый звук.',
    },
    done: { title: 'Готово!', hint: '' },
  };

  if (step === 'intro') {
    return (
      <div className="screen wizard">
        <ScreenHeader
          title="Определим твой диапазон"
          subtitle="Приложение подстраивает упражнения и песни под твой голос: показывает только твою полосу нот и переносит мелодии в твою октаву. Для этого нужно один раз измерить диапазон — займёт минуту."
        />
        <ul className="tips">
          <li>🎧 Надень наушники, если рядом играет музыка</li>
          <li>🤫 Найди тихое место</li>
          <li>🎤 Разреши доступ к микрофону</li>
        </ul>
        {micError && <p className="error">⚠️ {micError}</p>}
        <button className="btn primary big" onClick={() => setStep('comfort')}>
          Начать
        </button>
      </div>
    );
  }

  if (step === 'done' && low != null && high != null) {
    return (
      <div className="screen wizard">
        <ScreenHeader title="Твой диапазон" />
        <div className="range-result">
          <span className="range-notes">
            {midiToName(low)} – {midiToName(high)}
          </span>
          <span className="range-class">{classifyRange(low, high)} · {high - low} полутонов</span>
        </div>
        <p className="lead">Все упражнения и песни теперь будут подстроены под эту зону. Перемерить можно в любой момент.</p>
        <div className="btn-row">
          <button className="btn" onClick={() => { setLow(null); setHigh(null); setComfort(null); setStep('comfort'); }}>
            Перемерить
          </button>
          <button className="btn primary" onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    );
  }

  const canNext = step === 'comfort' ? comfort != null : step === 'low' ? low != null : high != null;

  return (
    <div className="screen wizard wizard-live">
      <div className="wizard-panel">
        <ScreenHeader title={stepInfo[step].title} />
        <p className="lead">{stepInfo[step].hint}</p>
        {micError && <p className="error">⚠️ {micError}</p>}
        <div className="wizard-status">
          {step === 'comfort' && comfort != null && <span>Удобная нота: <b>{midiToName(comfort)}</b> ✓</span>}
          {step === 'low' && low != null && <span>Нижняя граница: <b>{midiToName(low)}</b></span>}
          {step === 'high' && high != null && <span>Верхняя граница: <b>{midiToName(high)}</b></span>}
        </div>
        <div className="btn-row">
          <button
            className="btn primary"
            disabled={!canNext}
            onClick={() => setStep(step === 'comfort' ? 'low' : step === 'low' ? 'high' : 'done')}
          >
            {step === 'high' ? 'Готово' : 'Дальше'}
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
