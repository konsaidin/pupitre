// Логотип Pupitre для железа экрана «Тон» — свой рисунок в духе логотипов усилителей 70–80-х: жирный рубленый курсив
// постоянной толщины, углы срезаны фасками, у «P» — шпора у основания, у «t» и «e» — пятки вправо. Буквы — многоугольники
// (полости — правилом evenodd), наклон — skewX. Отделки: chrome — выпуклый хром шильдиков головы и кабинета, cream —
// кремовый пластик на ткани, engraved — гравировка в металле (тёмная канавка, светлая нижняя кромка), ink — печать по
// эмали педалей (цвет — currentColor).
import { useId } from 'react';

type Pt = [number, number];
/** Буква: контуры (первый — внешний, остальные — полости) и ширина. Базовая линия — y = 100, высота заглавной — 0,
 *  высота строчной — 26, низ выносного элемента — 130. */
interface Glyph {
  w: number;
  shapes: Pt[][];
}

const GLYPHS: Glyph[] = [
  // P: стебель со шпорой влево у основания, чаша с фаской справа
  { w: 66, shapes: [[[0, 0], [52, 0], [66, 14], [66, 46], [52, 60], [21, 60], [21, 100], [-9, 100], [0, 88]], [[21, 21], [45, 21], [45, 39], [21, 39]]] },
  // u: фаска слева внизу
  { w: 58, shapes: [[[0, 26], [21, 26], [21, 79], [37, 79], [37, 26], [58, 26], [58, 100], [14, 100], [0, 86]]] },
  // p: чаша с фасками справа, выносной стебель
  { w: 60, shapes: [[[0, 26], [46, 26], [60, 40], [60, 86], [46, 100], [21, 100], [21, 130], [0, 130]], [[21, 47], [39, 47], [39, 79], [21, 79]]] },
  // i: стебель и квадратная точка
  { w: 21, shapes: [[[0, 26], [21, 26], [21, 100], [0, 100]], [[0, 0], [21, 0], [21, 17], [0, 17]]] },
  // t: стебель с перекладиной и пяткой вправо
  {
    w: 44,
    shapes: [[[8, 4], [29, 4], [29, 26], [44, 26], [44, 44], [29, 44], [29, 79], [44, 79], [44, 100], [22, 100], [8, 86], [8, 44], [0, 44], [0, 26], [8, 26]]],
  },
  // r: плечо с фаской
  { w: 46, shapes: [[[0, 26], [21, 26], [21, 33], [28, 26], [46, 26], [46, 47], [32, 47], [21, 58], [21, 100], [0, 100]]] },
  // e: закрытый глаз, открытый низ справа, пятка
  {
    w: 60,
    shapes: [[[14, 26], [46, 26], [60, 40], [60, 70], [21, 70], [21, 79], [60, 79], [60, 100], [14, 100], [0, 86], [0, 40]], [[21, 46], [39, 46], [39, 52], [21, 52]]],
  },
];
const GAP = 6;
const SLANT = Math.tan((14 * Math.PI) / 180);

/** Контур слова одной строкой d (наклон — уже в координатах) и его рамка. */
function wordmark(): { d: string; box: [number, number, number, number] } {
  let x = 0;
  let minX = Infinity, maxX = -Infinity;
  const parts: string[] = [];
  for (const g of GLYPHS) {
    for (const shape of g.shapes) {
      const pts = shape.map(([px, py]) => {
        // наклон вправо: верх уходит вправо относительно базовой линии
        const sx = x + px + (100 - py) * SLANT;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        return `${sx.toFixed(2)} ${py}`;
      });
      parts.push(`M${pts.join('L')}Z`);
    }
    x += g.w + GAP;
  }
  const pad = 4;
  return { d: parts.join(''), box: [minX - pad, -pad, maxX - minX + 2 * pad, 130 + 2 * pad] };
}

const MARK = wordmark();
const VIEW = MARK.box.map((v) => v.toFixed(1)).join(' ');

export type LogoFinish = 'chrome' | 'cream' | 'engraved' | 'ink';

const FILLS: Record<'chrome' | 'cream', string[]> = {
  chrome: ['#ffffff', '#c9ccd1', '#7c7f85', '#f4f5f7', '#9a9da3'],
  cream: ['#fffdf6', '#f1e9d3', '#cbbd99', '#f6efdc', '#d8caa6'],
};

export function PupitreLogo({ finish, className }: { finish: LogoFinish; className?: string }) {
  const id = useId().replace(/:/g, '');
  const d = MARK.d;
  if (finish === 'ink') {
    return (
      <svg className={className} viewBox={VIEW} aria-hidden="true">
        <path d={d} fill="currentColor" fillRule="evenodd" />
      </svg>
    );
  }
  if (finish === 'engraved') {
    // канавка в металле: свет сверху-слева — нижняя кромка канавки светлая, верхняя стенка в тени
    return (
      <svg className={className} viewBox={VIEW} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-groove`} x1="0" y1="0" x2="0" y2="130" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0d0e10" />
            <stop offset="0.6" stopColor="#2a2c30" />
            <stop offset="1" stopColor="#3a3c41" />
          </linearGradient>
        </defs>
        <path d={d} fill="#fff" fillOpacity="0.6" fillRule="evenodd" transform="translate(1.6 2.4)" />
        <path d={d} fill={`url(#${id}-groove)`} fillRule="evenodd" />
        <path d={d} fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="1.4" />
      </svg>
    );
  }
  const [a, b, c, e, f] = FILLS[finish];
  return (
    <svg className={className} viewBox={VIEW} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="130" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={a} />
          <stop offset="0.34" stopColor={b} />
          <stop offset="0.52" stopColor={c} />
          <stop offset="0.6" stopColor={e} />
          <stop offset="1" stopColor={f} />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={d} clipRule="evenodd" />
        </clipPath>
        <filter id={`${id}-soft`} x="-5%" y="-10%" width="110%" height="130%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      {/* тень на основу, тёмный кант, тело, блик по верхне-левой кромке внутри буквы */}
      <path d={d} fill="#000" fillOpacity="0.75" fillRule="evenodd" transform="translate(3 6)" filter={`url(#${id}-soft)`} />
      <path d={d} fill="none" stroke="#000" strokeOpacity="0.85" strokeWidth="5" strokeLinejoin="miter" />
      <path d={d} fill={`url(#${id}-body)`} fillRule="evenodd" />
      <g clipPath={`url(#${id}-clip)`}>
        <path d={d} fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="3" transform="translate(1.6 2.4)" />
        <path d={d} fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="3" transform="translate(-1.6 -2.4)" />
      </g>
    </svg>
  );
}
