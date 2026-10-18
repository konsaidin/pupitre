import { useEffect } from 'react';
import { useNotePreview } from '../audio/useNotePreview';
import { t } from '../lib/i18n';
import { midiToName } from '../lib/music';
import type { MapNote } from '../lib/songMap';
import { Icon } from './Icon';
import { MelodyPreview } from './StudioArtwork';

export function MelodyAudition({ notes, title }: { notes: MapNote[]; title: string }) {
  const preview = useNotePreview();
  useEffect(() => {
    preview.stop();
  }, [notes, preview.stop]);
  return (
    <div className={`melody-audition${preview.playing ? ' playing' : ''}`}>
      <div className="audition-score">
        <MelodyPreview notes={notes} activeIndex={preview.activeIndex} />
      </div>
      <button
        className="audition-control"
        disabled={!notes.length}
        aria-pressed={preview.playing}
        aria-label={`${t(preview.playing ? 'Stop preview' : 'Listen to the pattern')}: ${title}`}
        title={t(preview.playing ? 'Stop preview' : 'Listen to the pattern')}
        onClick={() => (preview.playing ? preview.stop() : void preview.play(notes))}
      >
        <Icon name={preview.playing ? 'stop' : 'play'} size={18} />
      </button>
      <div className="audition-caption">
        <span>
          <i className={preview.playing ? 'signal-led on' : 'signal-led'} />
          {preview.error || t(preview.playing ? 'Listening' : 'Melody preview')}
        </span>
        <strong>{preview.midi === null ? '♪' : midiToName(preview.midi)}</strong>
      </div>
      <div className="audition-progress" aria-hidden="true">
        <span style={{ width: `${preview.progress * 100}%` }} />
      </div>
    </div>
  );
}
