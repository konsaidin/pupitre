import { useState } from 'react';
import { useNotePreview } from '../audio/useNotePreview';
import { t } from '../lib/i18n';
import { midiToHz, midiToName } from '../lib/music';
import { useProfile } from '../state/ProfileContext';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';

const name = (midi: number) => midiToName(midi).replace('#', '♯');
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
    <section className="rp-card vo-piano" data-ui="studio-piano">
      <div className="vo-piano__intro">
        <span className="rp-label rp-section-title">
          <GuitarIcon name="keyboard" size="sm" />
          {t('Piano')}
        </span>
        <p className="rp-sm rp-muted">{t('Touch the keys and find a comfortable sound. No microphone needed.')}</p>
        <div className="vo-piano__display">
          <i className={preview.playing ? 'rp-led rp-led--on' : 'rp-led'} />
          <strong className="rp-num">{preview.midi === null ? '—' : name(preview.midi)}</strong>
          <span className="rp-xs rp-faint rp-num">
            {preview.midi === null ? t('Press a key') : `${midiToHz(preview.midi).toFixed(1)} Hz`}
          </span>
        </div>
      </div>
      <div className="vo-piano__instrument">
        <div className="vo-piano__toolbar">
          <span className="rp-label">PUPITRE / KEYS</span>
          <div className="rp-stepper">
            <button aria-label={t('Lower octave')} disabled={base <= 36} onClick={() => changeOctave(-12)}>
              <GuitarIcon name="minus" size="sm" />
            </button>
            <output>
              {name(base)} — {name(base + 12)}
            </output>
            <button aria-label={t('Higher octave')} disabled={base >= 72} onClick={() => changeOctave(12)}>
              <GuitarIcon name="plus" size="sm" />
            </button>
          </div>
        </div>
        <div className="vo-piano__keys" role="group" aria-label={t('Playable piano keyboard')}>
          <div className="vo-piano__white">
            {WHITE.map((step) => (
              <button
                key={step}
                className={`vo-key vo-key--white${preview.midi === base + step ? ' vo-key--on' : ''}`}
                aria-label={t('Play {note}', { note: midiToName(base + step) })}
                aria-pressed={preview.midi === base + step}
                onClick={() => play(base + step)}
              >
                <span>{name(base + step)}</span>
              </button>
            ))}
          </div>
          {BLACK.map(({ step, after }) => (
            <button
              key={step}
              className={`vo-key vo-key--black${preview.midi === base + step ? ' vo-key--on' : ''}`}
              style={{ left: `${((after + 0.69) / 8) * 100}%` }}
              aria-label={t('Play {note}', { note: midiToName(base + step) })}
              aria-pressed={preview.midi === base + step}
              onClick={() => play(base + step)}
            />
          ))}
        </div>
        <span className="rp-xs rp-faint vo-piano__caption">
          <GuitarIcon name="volume" size="sm" />
          {preview.error || t('Tap a key. Your next note is right here.')}
        </span>
      </div>
    </section>
  );
}
