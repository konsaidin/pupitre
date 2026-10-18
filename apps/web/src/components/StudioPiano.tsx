import { useState } from 'react';
import { useNotePreview } from '../audio/useNotePreview';
import { t } from '../lib/i18n';
import { midiToHz, midiToName } from '../lib/music';
import { useProfile } from '../state/ProfileContext';
import { Icon } from './Icon';

const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK = [
  { step: 1, after: 0 },
  { step: 3, after: 1 },
  { step: 6, after: 3 },
  { step: 8, after: 4 },
  { step: 10, after: 5 },
];

export function StudioPiano() {
  const { profile } = useProfile();
  const [base, setBase] = useState(() =>
    profile.range ? Math.floor((profile.range.lowMidi + profile.range.highMidi) / 24) * 12 : 60,
  );
  const preview = useNotePreview();
  const play = (midi: number) => void preview.play([{ midi, startMs: 0, durMs: 650 }]);
  const changeOctave = (delta: number) => {
    preview.stop();
    setBase((v) => v + delta);
  };

  return (
    <section className="studio-piano">
      <div className="piano-intro">
        <span className="overline">
          <Icon name="piano" size={17} />
          {t('A note to start with')}
        </span>
        <h2>{t('Hear it. Then sing it.')}</h2>
        <p>{t('Touch the keys and find a comfortable sound. No microphone needed.')}</p>
        <div className="piano-display">
          <span className={preview.playing ? 'signal-led on' : 'signal-led'} />
          <strong>{preview.midi === null ? '—' : midiToName(preview.midi)}</strong>
          <span>
            {preview.midi === null ? t('Ready when you are') : `${midiToHz(preview.midi).toFixed(1)} Hz`}
          </span>
        </div>
      </div>
      <div className="piano-instrument">
        <div className="piano-toolbar">
          <span>
            PUPITRE <i>/ KEYS</i>
          </span>
          <div className="octave-control">
            <button aria-label={t('Lower octave')} disabled={base <= 36} onClick={() => changeOctave(-12)}>
              −
            </button>
            <span>
              {midiToName(base)} — {midiToName(base + 12)}
            </span>
            <button aria-label={t('Higher octave')} disabled={base >= 72} onClick={() => changeOctave(12)}>
              +
            </button>
          </div>
        </div>
        <div className="piano-keybed" role="group" aria-label={t('Playable piano keyboard')}>
          <div className="white-keys">
            {WHITE.map((step) => (
              <button
                key={step}
                className={`piano-key white-key${preview.midi === base + step ? ' pressed' : ''}`}
                aria-label={t('Play {note}', { note: midiToName(base + step) })}
                aria-pressed={preview.midi === base + step}
                onClick={() => play(base + step)}
              >
                <span>{midiToName(base + step)}</span>
              </button>
            ))}
          </div>
          {BLACK.map(({ step, after }) => (
            <button
              key={step}
              className={`piano-key black-key${preview.midi === base + step ? ' pressed' : ''}`}
              style={{ left: `${((after + 0.69) / 8) * 100}%` }}
              aria-label={t('Play {note}', { note: midiToName(base + step) })}
              aria-pressed={preview.midi === base + step}
              onClick={() => play(base + step)}
            />
          ))}
        </div>
        <div className="piano-caption">
          <Icon name="speaker" size={14} />
          <span>{preview.error || t('Tap a key. Your next note is right here.')}</span>
          <span className="piano-screws" aria-hidden="true">
            ⊕　⊕
          </span>
        </div>
      </div>
    </section>
  );
}
