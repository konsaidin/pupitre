import { useId } from 'react';
import { midiToName } from '../lib/music';
import type { MapNote } from '../lib/songMap';

/** Static vector artwork: no animation or external image requests. */
export function StudioArtwork({ className = '' }: { className?: string }) {
  return (
    <svg className={`studio-art ${className}`} viewBox="0 0 440 390" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="disc-surface" x1="102" y1="60" x2="345" y2="327" gradientUnits="userSpaceOnUse">
          <stop stopColor="#55545d" />
          <stop offset=".4" stopColor="#29282e" />
          <stop offset="1" stopColor="#14151a" />
        </linearGradient>
        <linearGradient id="wave-surface" x1="72" y1="90" x2="342" y2="295" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f4e5c8" />
          <stop offset=".55" stopColor="#d8b985" />
          <stop offset="1" stopColor="#a48252" />
        </linearGradient>
      </defs>
      <ellipse cx="231" cy="337" rx="142" ry="14" fill="#392e38" opacity=".12" />
      <circle cx="228" cy="194" r="151" fill="url(#disc-surface)" />
      {[140, 133, 126, 119, 112, 105, 98, 91, 84, 77].map((r) => (
        <circle key={r} cx="228" cy="194" r={r} stroke="#b0a9a0" strokeOpacity=".17" />
      ))}
      <circle cx="228" cy="194" r="64" fill="#c0b2c9" />
      <circle cx="228" cy="194" r="8" fill="#30292c" />
      <path
        d="M48 200h23m15-29v58m16-90v121m16-103v84m16-130v176m16-191v205m16-180v154m16-104v54m16-34v14m16-42v71m16-105v140m16-170v200m16-222v241m16-216v193m16-146v96m16-63v32m16-2h22"
        stroke="#302327"
        strokeWidth="11"
        strokeLinecap="round"
        transform="translate(3 7)"
        opacity=".25"
      />
      <path
        d="M48 200h23m15-29v58m16-90v121m16-103v84m16-130v176m16-191v205m16-180v154m16-104v54m16-34v14m16-42v71m16-105v140m16-170v200m16-222v241m16-216v193m16-146v96m16-63v32m16-2h22"
        stroke="url(#wave-surface)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path d="M365 42v24m-12-12h24M51 292v16m-8-8h16" stroke="#72626d" strokeWidth="2" />
      <circle cx="381" cy="287" r="5" stroke="#72626d" strokeWidth="2" />
      <path d="M70 70h31M85.5 54.5v31" stroke="#72626d" strokeWidth="1.5" transform="rotate(45 85 70)" />
    </svg>
  );
}

export function PracticeArtwork({ variant = 0 }: { variant?: number }) {
  const id = useId().replaceAll(':', '');
  const color = variant === 0 ? '#9c7446' : variant === 3 ? '#ad9dc9' : '#d8b0a4';
  return (
    <svg className="practice-artwork" viewBox="0 0 280 124" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-metal`} x1="30" y1="20" x2="240" y2="110" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff2d8" />
          <stop offset=".23" stopColor={color} />
          <stop offset=".52" stopColor="#f2e2cf" />
          <stop offset=".76" stopColor={color} />
          <stop offset="1" stopColor="#655160" />
        </linearGradient>
        <linearGradient id={`${id}-pillar`} x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#70637e" />
          <stop offset=".4" stopColor="#b7a8ce" />
          <stop offset=".65" stopColor="#d0c3e0" />
          <stop offset="1" stopColor="#776587" />
        </linearGradient>
        <radialGradient id={`${id}-record`}>
          <stop stopColor="#3e3943" />
          <stop offset=".7" stopColor="#24232b" />
          <stop offset="1" stopColor="#0e1015" />
        </radialGradient>
      </defs>
      <path d="M14 108h252M14 32h252" stroke="currentColor" strokeOpacity=".08" />
      {variant === 0 ? (
        <>
          <ellipse cx="142" cy="106" rx="102" ry="10" fill="#614725" opacity=".12" />
          <path
            d="M26 78C48 78 46 29 76 29S99 92 130 92 155 35 184 35 216 83 251 67"
            stroke="#6c5336"
            strokeOpacity=".2"
            strokeWidth="24"
            strokeLinecap="round"
            transform="translate(0 6)"
          />
          <path
            d="M26 78C48 78 46 29 76 29S99 92 130 92 155 35 184 35 216 83 251 67"
            stroke={`url(#${id}-metal)`}
            strokeWidth="22"
            strokeLinecap="round"
          />
          <path
            d="M26 72C48 72 46 23 76 23S99 86 130 86 155 29 184 29 216 77 251 61"
            stroke="#fff7e6"
            strokeOpacity=".45"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="26" cy="78" r="7" fill="#c2a57e" stroke="#eed7b0" />
          <circle cx="251" cy="67" r="7" fill="#8e704c" stroke="#e1c79f" />
        </>
      ) : variant === 3 ? (
        <>
          <ellipse cx="145" cy="110" rx="112" ry="9" fill="#000" opacity=".2" />
          {[30, 42, 58, 76, 94].map((h, i) => (
            <g key={i}>
              <path d={`M${29 + i * 47} ${107 - h}l10-6 27 0-10 6z`} fill="#d3c6e3" />
              <rect x={29 + i * 47} y={107 - h} width="27" height={h} rx="3" fill={`url(#${id}-pillar)`} />
              <path d={`M${56 + i * 47} ${107 - h}l10-6v${h}l-10 6z`} fill="#65566f" />
              <path d={`M${34 + i * 47} ${110 - h}v${h - 9}`} stroke="#f2e6fc" strokeOpacity=".22" />
            </g>
          ))}
          <path d="m22 95 234-76" stroke="#f7e9ff" strokeOpacity=".17" strokeDasharray="2 5" />
        </>
      ) : (
        <>
          <ellipse cx="157" cy="111" rx="96" ry="9" fill="#000" opacity=".2" />
          <circle cx="124" cy="62" r="54" fill="#b9978d" opacity=".3" />
          <circle cx="159" cy="62" r="57" fill={`url(#${id}-record)`} stroke="#5e5660" />
          {[51, 46, 41, 36, 31].map((r) => (
            <circle key={r} cx="159" cy="62" r={r} stroke="#b9accd" strokeOpacity=".14" />
          ))}
          <circle cx="159" cy="62" r="24" fill="#d9b5a2" />
          <circle cx="159" cy="62" r="4" fill="#342b32" />
          <path
            d="M240 16v48l-28 29"
            stroke="#15151b"
            strokeWidth="10"
            strokeLinecap="round"
            transform="translate(2 3)"
          />
          <path d="M240 16v48l-28 29" stroke={`url(#${id}-metal)`} strokeWidth="6" strokeLinecap="round" />
          <circle cx="240" cy="16" r="8" fill="#7c7079" stroke="#d6c0ad" />
          <path d="m205 92 8 7 10-11-7-6z" fill="#cbb7a7" />
        </>
      )}
    </svg>
  );
}

/** The first phrase of an actual exercise or song, scaled to its pitch range. */
export function MelodyPreview({ notes, activeIndex = -1 }: { notes: MapNote[]; activeIndex?: number }) {
  const id = useId().replaceAll(':', '');
  const preview = notes.slice(0, 15);
  const low = Math.min(...preview.map((n) => n.midi));
  const high = Math.max(...preview.map((n) => n.midi));
  const start = preview[0]?.startMs ?? 0;
  const duration = (preview.at(-1)?.startMs ?? 0) + (preview.at(-1)?.durMs ?? 0) - start;
  return (
    <svg viewBox="0 0 320 96" className="exercise-note-preview" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-note`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".55" />
        </linearGradient>
      </defs>
      {[18, 36, 54, 72].map((y) => (
        <path key={y} d={`M25 ${y}h295`} stroke="currentColor" strokeOpacity=".1" />
      ))}
      {[25, 74, 123, 172, 221, 270, 319].map((x) => (
        <path key={x} d={`M${x} 8v75`} stroke="currentColor" strokeOpacity=".07" strokeDasharray="2 4" />
      ))}
      {preview.length > 0 && (
        <>
          <text x="1" y="20" fill="currentColor" opacity=".45" fontSize="7" fontFamily="inherit">
            {midiToName(high)}
          </text>
          <text x="1" y="73" fill="currentColor" opacity=".45" fontSize="7" fontFamily="inherit">
            {midiToName(low)}
          </text>
        </>
      )}
      {preview.map((n, i) => {
        const x = 29 + ((n.startMs - start) / Math.max(1, duration)) * 286;
        const y = 66 - ((n.midi - low) / Math.max(1, high - low)) * 50;
        const width = Math.max(3, (n.durMs / Math.max(1, duration)) * 286 - 2);
        return (
          <g key={i} opacity={i === activeIndex ? 1 : 0.65 + i / 50}>
            <rect x={x} y={y + 3} width={width} height="9" rx="3" fill="#000" opacity=".23" />
            <rect
              x={x}
              y={y}
              width={width}
              height="9"
              rx="3"
              fill={i === activeIndex ? 'var(--accent)' : `url(#${id}-note)`}
              stroke="currentColor"
              strokeOpacity=".28"
              strokeWidth=".5"
            />
            <path
              d={`M${x + 2} ${y + 2}h${Math.max(0, width - 4)}`}
              stroke="#fff"
              strokeOpacity=".25"
              strokeLinecap="round"
            />
            {i === activeIndex && (
              <text
                x={x + width / 2}
                y={y - 6}
                fill="var(--accent)"
                fontSize="8"
                fontFamily="inherit"
                textAnchor="middle"
              >
                {midiToName(n.midi)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
