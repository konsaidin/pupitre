// Фурнитура головы и кабинета (SVG): ручка для переноски — винилово-кожаный ремень дугой со строчкой, концы под
// хромированными кронштейнами на винтах, тень на крышке головы; сигнальная лампа — гранёная линза («роза») в хромированной конической оправе; мини-
// тумблер — шайба, шестигранная гайка с фасками, резьбовая втулка и хромированный рычаг-«бита» с шариком. Свет на панель
// падает сверху-слева: блики там, тени — вниз-вправо (тень рычага считается отдельно от рычага и при перевороте не
// переворачивается). Включённая лампа светит изнутри граней и бросает красный отсвет на панель.
import { useId, type CSSProperties } from 'react';

const C = 20; // центр в координатах viewBox 0…40
const polar = (r: number, deg: number) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)];
const pt = ([x, y]: number[]) => `${x.toFixed(2)} ${y.toFixed(2)}`;

/** Огранка «роза»: 12 лучевых граней от центра и кольцо фасок со сдвигом на полграни. */
function Facets({ r }: { r: number }) {
  const n = 12, step = 360 / n, inner = r * 0.55;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const a = i * step - 90;
        return <path key={`c${i}`} d={`M${C} ${C}L${pt(polar(inner, a))}L${pt(polar(inner, a + step))}Z`} fill={i % 2 ? '#fff' : '#000'} fillOpacity={i % 2 ? 0.1 : 0.16} />;
      })}
      {Array.from({ length: n }, (_, i) => {
        const a = i * step - 90 + step / 2;
        return (
          <path key={`r${i}`} d={`M${pt(polar(inner, a - step / 2))}L${pt(polar(r, a - step / 2))}L${pt(polar(r, a + step / 2))}L${pt(polar(inner, a + step / 2))}Z`}
            fill={i % 2 ? '#000' : '#fff'} fillOpacity={i % 2 ? 0.2 : 0.08} />
        );
      })}
    </>
  );
}

export function Jewel({ on }: { on: boolean }) {
  const id = useId().replace(/:/g, '');
  const lens = 12.6;
  return (
    <span className="amp-jewel" data-on={on || undefined} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <defs>
          <linearGradient id={`${id}-bezel`} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.35" stopColor="#c3c6ca" />
            <stop offset="0.65" stopColor="#6b6e73" />
            <stop offset="1" stopColor="#d9dbde" />
          </linearGradient>
          <radialGradient id={`${id}-dark`} cx="0.5" cy="0.55" r="0.6">
            <stop offset="0" stopColor="#7c1d14" />
            <stop offset="0.6" stopColor="#4a0d08" />
            <stop offset="1" stopColor="#1f0402" />
          </radialGradient>
          <radialGradient id={`${id}-lit`} cx="0.5" cy="0.52" r="0.6">
            <stop offset="0" stopColor="#fff2dc" />
            <stop offset="0.22" stopColor="#ff8a52" />
            <stop offset="0.62" stopColor="#e1260c" />
            <stop offset="1" stopColor="#7a0903" />
          </radialGradient>
          <filter id={`${id}-soft`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>
        {/* тень оправы на панели */}
        <circle cx={C + 1.2} cy={C + 1.8} r="18" fill="#000" fillOpacity="0.35" filter={`url(#${id}-soft)`} />
        {/* коническая хромированная оправа: внешний обод, скос, гнездо линзы */}
        <circle cx={C} cy={C} r="18" fill={`url(#${id}-bezel)`} />
        <circle cx={C} cy={C} r="16" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="0.8" />
        <path d={`M${pt(polar(16.8, 200))}A16.8 16.8 0 0 1 ${pt(polar(16.8, 300))}`} fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1" />
        <circle cx={C} cy={C} r={lens + 1} fill="#1a1b1d" />
        {/* линза: тёмная и светящаяся, огранка поверх обеих */}
        <circle cx={C} cy={C} r={lens} fill={`url(#${id}-dark)`} />
        <circle className="amp-jewel__lit" cx={C} cy={C} r={lens} fill={`url(#${id}-lit)`} />
        <Facets r={lens} />
        <circle cx={C} cy={C} r={lens} fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="0.8" />
        {/* блик внешнего света на выпуклом стекле */}
        <ellipse cx="15.4" cy="13.6" rx="4.2" ry="2.4" transform="rotate(-32 15.4 13.6)" fill="#fff" fillOpacity="0.6" filter={`url(#${id}-soft)`} />
        <ellipse cx="15" cy="13.4" rx="1.6" ry="0.9" transform="rotate(-32 15 13.4)" fill="#fff" fillOpacity="0.85" />
      </svg>
    </span>
  );
}

export function ToggleSwitch(props: { checked: boolean; onToggle: () => void; label: string; title?: string; ui: string }) {
  const id = useId().replace(/:/g, '');
  // Рычаг торчит из втулки к зрителю под углом вверх (вкл) или вниз (выкл): в проекции он короче и расширяется к
  // концу, шарик крупнее — он ближе к глазу. Тень отрывается от рычага: у основания лежит под ним, у кончика (выше всего
  // над панелью) уходит дальше всех вниз-вправо — поднятый рычаг даёт короткую тень, опущенный — длинную.
  const d = props.checked ? -1 : 1;
  const L = 12.5, wb = 1.7, wt = 3.1, ball = 4.4;
  const tip = C + d * L;
  const bat = `M${C - wb} ${C}L${C - wt} ${tip}L${C + wt} ${tip}L${C + wb} ${C}Z`;
  // смещение тени на высоте кончика над панелью
  const sx = 5.2, sy = 7.4;
  const shadow = `M${C - wb + 0.6} ${C + 0.9}L${C - wt + sx} ${tip + sy}L${C + wt + sx} ${tip + sy}L${C + wb + 0.6} ${C + 0.9}Z`;
  const hex = Array.from({ length: 6 }, (_, i) => pt(polar(9.6, i * 60 + 30))).join('L');
  return (
    <button type="button" className="amp-toggle" role="switch" aria-checked={props.checked} aria-label={props.label} title={props.title}
      onClick={props.onToggle} data-ui={props.ui}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-nut`} x1="0.1" y1="0.1" x2="0.9" y2="0.9">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.45" stopColor="#a9acb1" />
            <stop offset="0.55" stopColor="#6e7176" />
            <stop offset="1" stopColor="#c9ccd0" />
          </linearGradient>
          <linearGradient id={`${id}-bat`} x1="0" x2="1">
            <stop offset="0" stopColor="#5d6065" />
            <stop offset="0.38" stopColor="#f8f9fa" />
            <stop offset="0.6" stopColor="#babdc2" />
            <stop offset="1" stopColor="#4f5257" />
          </linearGradient>
          <radialGradient id={`${id}-ball`} cx="0.36" cy="0.32" r="0.7">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.5" stopColor="#b9bcc1" />
            <stop offset="1" stopColor="#55585d" />
          </radialGradient>
          <filter id={`${id}-soft`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
          {/* рычаг темнеет к основанию — уходит в тень втулки */}
          <linearGradient id={`${id}-depth`} gradientUnits="userSpaceOnUse" x1={C} y1={C} x2={C} y2={tip}>
            <stop offset="0" stopColor="#000" stopOpacity="0.55" />
            <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* тень гайки и рычага на панели — всегда вниз-вправо */}
        <circle cx={C + 1.4} cy={C + 2} r="11.5" fill="#000" fillOpacity="0.3" filter={`url(#${id}-soft)`} />
        <g fill="#000" fillOpacity="0.4" filter={`url(#${id}-soft)`}>
          <path d={shadow} />
          <circle cx={C + sx} cy={tip + sy} r={ball} />
        </g>
        {/* шайба, гайка с фасками, втулка */}
        <circle cx={C} cy={C} r="11.4" fill="#4a4d52" />
        <circle cx={C} cy={C} r="11.4" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="0.7" />
        <path d={`M${hex}Z`} fill={`url(#${id}-nut)`} stroke="#2a2c30" strokeOpacity="0.6" strokeWidth="0.6" />
        <circle cx={C} cy={C} r="7.2" fill="none" stroke="#000" strokeOpacity="0.18" strokeWidth="1.4" />
        <circle cx={C} cy={C} r="5" fill="#8b8e93" />
        <circle cx={C} cy={C} r="5" fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="0.6" />
        <circle cx={C} cy={C} r="3.2" fill="#2a2c30" />
        {/* рычаг: выход из втулки (тёмное кольцо), тело с бликом вдоль, затемнение к основанию, шарик */}
        <ellipse cx={C} cy={C} rx={wb + 1.1} ry={wb + 0.6} fill="#1a1b1d" />
        <path d={bat} fill={`url(#${id}-bat)`} stroke="#2a2c30" strokeOpacity="0.5" strokeWidth="0.4" />
        <path d={bat} fill={`url(#${id}-depth)`} />
        <path d={`M${C - wb * 0.35} ${C}L${C - wt * 0.35} ${tip}`} stroke="#fff" strokeOpacity="0.7" strokeWidth="0.6" strokeLinecap="round" />
        <circle cx={C} cy={tip} r={ball} fill={`url(#${id}-ball)`} stroke="#2a2c30" strokeOpacity="0.45" strokeWidth="0.4" />
        <ellipse cx={C - ball * 0.32} cy={tip - ball * 0.36} rx={ball * 0.38} ry={ball * 0.24} fill="#fff" fillOpacity="0.85" />
      </svg>
    </button>
  );
}

/** Винт с крестовым шлицем в координатах SVG. */
function Screw({ x, y, r = 2.6, turn = 20 }: { x: number; y: number; r?: number; turn?: number }) {
  return (
    <g transform={`rotate(${turn} ${x} ${y})`}>
      <circle cx={x} cy={y} r={r} fill="#d4d6da" stroke="#2a2c30" strokeOpacity="0.6" strokeWidth="0.5" />
      <circle cx={x - r * 0.25} cy={y - r * 0.3} r={r * 0.6} fill="#fff" fillOpacity="0.55" />
      <path d={`M${x - r * 0.7} ${y}H${x + r * 0.7}M${x} ${y - r * 0.7}V${y + r * 0.7}`} stroke="#2a2c30" strokeOpacity="0.8" strokeWidth="0.7" />
    </g>
  );
}

/** Ручка для переноски на крышке головы. */
export function CarryHandle() {
  const id = useId().replace(/:/g, '');
  // ремень: верхняя и нижняя кромки — дуги, концы уходят под кронштейны
  const top = 'M30 34.8Q130 3.6 230 34.8';
  const strap = 'M26 34Q130 2 234 34L234 44Q130 13 26 44Z';
  const bracket = (x: number) => (
    <g key={x}>
      <rect x={x} y="31" width="40" height="15" rx="4" fill={`url(#${id}-chrome)`} stroke="#1c1d20" strokeOpacity="0.7" strokeWidth="0.6" />
      <rect x={x + 2} y="32.2" width="36" height="2.2" rx="1.1" fill="#fff" fillOpacity="0.6" />
      <Screw x={x + 9} y={38.8} turn={35} />
      <Screw x={x + 31} y={38.8} turn={-15} />
    </g>
  );
  return (
    <span className="amp-head__handle" aria-hidden="true">
      <svg viewBox="0 0 260 48">
        <defs>
          <linearGradient id={`${id}-leather`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a3a3d" />
            <stop offset="0.3" stopColor="#1d1d20" />
            <stop offset="1" stopColor="#070708" />
          </linearGradient>
          <linearGradient id={`${id}-chrome`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.4" stopColor="#b7babf" />
            <stop offset="0.62" stopColor="#5f6267" />
            <stop offset="1" stopColor="#c9ccd0" />
          </linearGradient>
          {/* фактура винила: мелкий рельеф шума */}
          <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="5" result="n" />
            <feDiffuseLighting in="n" lightingColor="#808080" surfaceScale="1.2" diffuseConstant="1">
              <feDistantLight azimuth="235" elevation="50" />
            </feDiffuseLighting>
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
          <filter id={`${id}-soft`} x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          <clipPath id={`${id}-clip`}>
            <path d={strap} />
          </clipPath>
        </defs>
        {/* тень ремня на крышке головы: под серединой дуги — дальше и мягче */}
        <path d="M34 46Q130 26 226 46L226 48L34 48Z" fill="#000" fillOpacity="0.45" filter={`url(#${id}-soft)`} />
        <path d={strap} fill={`url(#${id}-leather)`} />
        <g clipPath={`url(#${id}-clip)`} opacity="0.22" style={{ mixBlendMode: 'overlay' }}>
          <rect x="0" y="0" width="260" height="48" fill="#fff" filter={`url(#${id}-grain)`} />
        </g>
        {/* кромка, строчка по обоим краям, тёмный низ */}
        <path d={top} fill="none" stroke="#fff" strokeOpacity="0.24" strokeWidth="0.9" />
        <path d="M34 36.6Q130 6.4 226 36.6" fill="none" stroke="#9c8a63" strokeOpacity="0.75" strokeWidth="0.7" strokeDasharray="2.6 1.8" />
        <path d="M34 41.4Q130 11.4 226 41.4" fill="none" stroke="#9c8a63" strokeOpacity="0.6" strokeWidth="0.7" strokeDasharray="2.6 1.8" />
        <path d="M26 44Q130 15 234 44" fill="none" stroke="#000" strokeOpacity="0.7" strokeWidth="1" />
        {[4, 216].map(bracket)}
      </svg>
    </span>
  );
}

/** Винты по углам (позиции — классами: соседние элементы не сбивают раскладку). */
export const Screws = () => (
  <>
    {(['tl', 'tr', 'bl', 'br'] as const).map((at, i) => (
      <i key={at} className={`screw screw--${at}`} style={{ '--turn': `${[18, 72, 131, 47][i]}deg` } as CSSProperties} aria-hidden="true" />
    ))}
  </>
);

/** Хромированные уголки корпуса. */
export const Corners = ({ small }: { small?: boolean }) => (
  <>
    {(['tl', 'tr', 'bl', 'br'] as const).map((at) => (
      <i key={at} className={`amp-corner amp-corner--${at}${small ? ' amp-corner--sm' : ''}`} aria-hidden="true" />
    ))}
  </>
);
