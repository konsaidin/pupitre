// Лампы в окне головы (SVG): 12AX7 — колба с куполом и носиком откачки, серебряный геттер, слюда, два анода; EL34 — крупная
// колба, один большой анод, бакелитовый цоколь с ключом. Внутри головы темно: свет только от самих ламп — холодные
// почти не видны, горячие подсвечивают своё стекло, геттер и шасси (tube__glint). Накал всех ламп от одной обмотки:
// греются вместе и линейно (tone.css: тёмно-красное разгорается в оранжевое; над и под анодами, в щелях, ореолом).
import { useId } from 'react';

function Tube({ kind }: { kind: 'pre' | 'power' }) {
  const id = useId().replace(/:/g, '');
  const power = kind === 'power';
  // размеры колбы и анодов в координатах viewBox
  const w = power ? 56 : 40, h = power ? 132 : 100;
  const g = { l: power ? 8 : 6, r: power ? 48 : 34, top: power ? 9 : 7, foot: power ? 108 : 92 };
  const plates = power ? [{ x: 14, w: 28 }] : [{ x: 9, w: 9.5 }, { x: 21.5, w: 9.5 }];
  const py = power ? { t: 40, b: 92 } : { t: 30, b: 72 };
  const glass = `M${g.l} ${g.foot}V${g.top + 14}Q${g.l} ${g.top} ${w / 2} ${g.top - 1}Q${g.r} ${g.top} ${g.r} ${g.top + 14}V${g.foot}Z`;
  return (
    <svg className={`tube tube--${kind}`} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        {/* стекло в темноте: лишь край колбы чуть темнее фона */}
        <linearGradient id={`${id}-glass`} x1="0" x2="1">
          <stop offset="0" stopColor="#8a929c" stopOpacity="0.07" />
          <stop offset="0.12" stopColor="#8a929c" stopOpacity="0.02" />
          <stop offset="0.88" stopColor="#8a929c" stopOpacity="0.02" />
          <stop offset="1" stopColor="#8a929c" stopOpacity="0.07" />
        </linearGradient>
        {/* отражение собственного накала в стекле: тёплые края колбы */}
        <linearGradient id={`${id}-glint`} x1="0" x2="1">
          <stop offset="0" stopColor="#ff9a50" stopOpacity="0.2" />
          <stop offset="0.09" stopColor="#ff8a3c" stopOpacity="0" />
          <stop offset="0.91" stopColor="#ff8a3c" stopOpacity="0" />
          <stop offset="1" stopColor="#ff9a50" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id={`${id}-getter`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a3d42" />
          <stop offset="0.5" stopColor="#25272b" />
          <stop offset="1" stopColor="#141518" />
        </linearGradient>
        <linearGradient id={`${id}-plate`} x1="0" x2="1">
          <stop offset="0" stopColor="#141517" />
          <stop offset="0.45" stopColor="#2a2c30" />
          <stop offset="1" stopColor="#0e0f11" />
        </linearGradient>
        <radialGradient id={`${id}-heat`}>
          <stop offset="0" stopColor="#ffd9a6" />
          <stop offset="0.35" stopColor="#ff8a3a" />
          <stop offset="1" stopColor="#ff5a12" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-halo`} cy="0.55">
          <stop offset="0" stopColor="#ff9a48" stopOpacity="0.3" />
          <stop offset="0.6" stopColor="#ff6a1c" stopOpacity="0.07" />
          <stop offset="1" stopColor="#ff6a1c" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-in`}>
          <path d={glass} />
        </clipPath>
      </defs>
      {/* цоколь: бакелит с ключом у EL34, панелька у 12AX7 */}
      {power ? (
        <>
          <rect x={g.l - 1} y={g.foot - 2} width={g.r - g.l + 2} height={h - g.foot} rx="4" fill="#1d1612" />
          <rect x={g.l - 1} y={g.foot - 2} width={g.r - g.l + 2} height={h - g.foot} rx="4" fill="none" stroke="#000" strokeOpacity="0.6" />
          <rect x={g.l + 2} y={g.foot} width={g.r - g.l - 4} height="3" fill="#3b2e25" />
          <rect x={w / 2 - 3} y={h - 6} width="6" height="6" fill="#0d0a08" />
        </>
      ) : (
        <ellipse cx={w / 2} cy={g.foot + 3} rx={(g.r - g.l) / 2 + 3} ry="4" fill="#111214" stroke="#6b6e73" strokeWidth="0.8" />
      )}
      <g clipPath={`url(#${id}-in)`}>
        {/* внутри колбы: тёмная глубина, геттер, слюда, стойки, аноды */}
        <rect x="0" y="0" width={w} height={h} fill="#0d0e10" fillOpacity="0.55" />
        <ellipse cx={w / 2} cy={g.top + 7} rx={(g.r - g.l) / 2} ry={power ? 10 : 7} fill={`url(#${id}-getter)`} />
        {/* серебро геттера ловит свет накала снизу */}
        <ellipse className="tube__glint" cx={w / 2} cy={g.top + 9} rx={(g.r - g.l) / 2} ry={power ? 8 : 5.5} fill="#ff9a50" fillOpacity="0.14" />
        <rect className="tube__halo" x="0" y="0" width={w} height={h} fill={`url(#${id}-halo)`} />
        {[py.t - 4, py.b + 4].map((y) => (
          <rect key={y} x={g.l + 2} y={y - 0.8} width={g.r - g.l - 4} height="1.6" fill="#8d939a" fillOpacity="0.3" />
        ))}
        {[g.l + 4, g.r - 4].map((x) => (
          <line key={x} x1={x} y1={py.t - 6} x2={x} y2={py.b + 6} stroke="#6d7278" strokeOpacity="0.4" strokeWidth="0.8" />
        ))}
        {/* накал: в щелях и над/под анодами; два слоя — тёмно-красный и оранжевый */}
        {plates.map((p, i) => (
          <g key={i}>
            <rect className="tube__core tube__core--red" x={p.x + p.w / 2 - 1.2} y={py.t - 2} width="2.4" height={py.b - py.t + 4} fill="#c4260a" />
            <rect className="tube__core" x={p.x + p.w / 2 - 1.2} y={py.t - 2} width="2.4" height={py.b - py.t + 4} fill="#ff8c3c" />
            {[py.t - 1.5, py.b + 1.5].map((y) => (
              <ellipse key={y} className="tube__heat" cx={p.x + p.w / 2} cy={y} rx={p.w * 0.42} ry={power ? 2.8 : 2.1} fill={`url(#${id}-heat)`} />
            ))}
          </g>
        ))}
        {plates.map((p, i) => (
          <g key={`p${i}`}>
            <rect x={p.x} y={py.t} width={p.w} height={py.b - py.t} rx="1.2" fill={`url(#${id}-plate)`} />
            {/* щели анода */}
            {Array.from({ length: power ? 6 : 2 }, (_, k) => (
              <rect key={k} x={p.x + ((k + 1) * p.w) / (power ? 7 : 3) - 0.35} y={py.t + 3} width="0.7" height={py.b - py.t - 6} fill="#000" fillOpacity="0.55" />
            ))}
            <rect x={p.x} y={py.t} width={p.w} height={py.b - py.t} rx="1.2" fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="0.6" />
          </g>
        ))}
        {power && <rect className="tube__blue" x={14} y={py.t} width={28} height={py.b - py.t} rx="2" fill="none" stroke="#7d7cff" strokeWidth="2.4" />}
      </g>
      {/* стекло: в темноте почти невидимо; горячее — отражает свой накал краями колбы и носиком откачки */}
      <path d={glass} fill={`url(#${id}-glass)`} stroke="#8a929c" strokeOpacity="0.12" strokeWidth="0.8" />
      <path className="tube__glint" d={glass} fill={`url(#${id}-glint)`} stroke="#ff9a50" strokeOpacity="0.14" strokeWidth="0.7" />
      {!power && (
        <>
          <rect x={w / 2 - 2} y={g.top - 5} width="4" height="5" rx="2" fill="#8a929c" fillOpacity="0.12" />
          <rect className="tube__glint" x={w / 2 - 2} y={g.top - 5} width="4" height="5" rx="2" fill="#ff9a50" fillOpacity="0.18" />
        </>
      )}
    </svg>
  );
}

const ROW: Array<'pre' | 'power'> = ['pre', 'pre', 'pre', 'power', 'power', 'power', 'power'];

/** Окно с лампами: процессор включён — прогреваются, выключен — остывают; первый кадр — без перехода. */
export function Tubes({ hot }: { hot: boolean }) {
  return (
    <div className="amp-tubes" data-hot={hot || undefined} aria-hidden="true">
      <div className="amp-tubes__chassis">
        {ROW.map((kind, i) => (
          <Tube key={i} kind={kind} />
        ))}
      </div>
    </div>
  );
}
