// Прослушивание узора упражнения на «Рампе»: мини-ролл первых 15 нот (текущая — светом), кнопка «слушать/стоп»,
// подпись с LED и именем звучащей ноты, тонкий прогресс.
import { useEffect } from 'react';
import { useNotePreview } from '../audio/useNotePreview';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';
import { t } from '../lib/i18n';
import { midiToName } from '../lib/music';
import type { MapNote } from '../lib/songMap';

const name = (midi: number) => midiToName(midi).replace('#', '♯');

export function MelodyPreview({ notes, activeIndex = -1 }: { notes: MapNote[]; activeIndex?: number }) {
  const preview = notes.slice(0, 15);
  const low = Math.min(...preview.map((n) => n.midi));
  const high = Math.max(...preview.map((n) => n.midi));
  const start = preview[0]?.startMs ?? 0;
  const duration = (preview.at(-1)?.startMs ?? 0) + (preview.at(-1)?.durMs ?? 0) - start;
  return (
    <svg viewBox="0 0 320 96" className="vo-melody__roll" fill="none" aria-hidden="true">
      {[18, 36, 54, 72].map((y) => (
        <path key={y} d={`M25 ${y}h295`} stroke="currentColor" strokeOpacity=".08" />
      ))}
      {preview.length > 0 && (
        <>
          <text x="1" y="20" fill="currentColor" opacity=".45" fontSize="7" fontFamily="inherit">
            {name(high)}
          </text>
          <text x="1" y="73" fill="currentColor" opacity=".45" fontSize="7" fontFamily="inherit">
            {name(low)}
          </text>
        </>
      )}
      {preview.map((n, i) => {
        const x = 29 + ((n.startMs - start) / Math.max(1, duration)) * 286;
        const y = 66 - ((n.midi - low) / Math.max(1, high - low)) * 50;
        const width = Math.max(3, (n.durMs / Math.max(1, duration)) * 286 - 2);
        const on = i === activeIndex;
        return (
          <g key={i}>
            <rect x={x} y={y} width={width} height="9" rx="2.5" fill={on ? 'var(--rp-light)' : 'currentColor'} opacity={on ? 1 : 0.42} />
            {on && (
              <text x={x + width / 2} y={y - 6} fill="var(--rp-light)" fontSize="8" fontFamily="inherit" textAnchor="middle">
                {name(n.midi)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function MelodyAudition({ notes, title }: { notes: MapNote[]; title: string }) {
  const preview = useNotePreview();
  useEffect(() => {
    preview.stop();
  }, [notes, preview.stop]);
  return (
    <div className={`vo-melody${preview.playing ? ' vo-melody--on' : ''}`}>
      <MelodyPreview notes={notes} activeIndex={preview.activeIndex} />
      <div className="vo-melody__bar">
        <button
          className="rp-btn rp-btn--icon rp-btn--sm"
          disabled={!notes.length}
          aria-pressed={preview.playing}
          aria-label={`${t(preview.playing ? 'Stop preview' : 'Listen to the pattern')}: ${title}`}
          title={t(preview.playing ? 'Stop preview' : 'Listen to the pattern')}
          onClick={() => (preview.playing ? preview.stop() : void preview.play(notes))}
        >
          <GuitarIcon name={preview.playing ? 'player-stop-filled' : 'player-play-filled'} size="sm" />
        </button>
        <span className="rp-xs rp-faint vo-melody__caption">
          <i className={preview.playing ? 'rp-led rp-led--on' : 'rp-led'} />
          {preview.error || t(preview.playing ? 'Listening' : 'Melody preview')}
        </span>
        <b className="rp-num">{preview.midi === null ? '♪' : name(preview.midi)}</b>
      </div>
      <div className="rp-progress vo-melody__progress" aria-hidden="true">
        <i style={{ width: `${preview.progress * 100}%` }} />
      </div>
    </div>
  );
}
