// Типы к вендорному highway.js (fretfall @ ed2bc3b, MIT; патчи Пюпитра 1–5, 7–9 — VENDOR.md) — по факту исходника.
// Объявлено только то, что берём; остальные экспорты highway.js (HEADSTOCKS, spline, bendAt…) — по мере надобности.
import type { FfAnchor, FfArrangement } from './fromScore.js';
import type { FfTheme } from './themes.js';

/** Настройки вида, которые рисовальщики читают из той же `t`, что и тема (в player.js — `{...theme(style), ...вид}`). */
export interface FfViewOptions {
  /** Градусы (апстрим: 30). */
  viewAngle?: number;
  /** Градусы, знак — сторона (апстрим: 5). */
  sideAngle?: number;
  /** Множители (апстрим: 1). */
  noteSpeed?: number;
  drawDistance?: number;
  fretWidth?: number;
  boardHeight?: number;
  /** Доля 0..1 (апстрим: 0.5). */
  fretNumbers?: number;
  noteLines?: number;
  guides?: boolean;
  notes3d?: boolean;
  /** Без шапки страницы: гриф крупнее и выше. */
  fill?: boolean;
  /** 'gradient' — светящиеся рамки позиции. */
  frames?: string;
  /** 'frame' | 'grey' | 'hide'. */
  repeatMarks?: string;
  markings?: 'black' | 'white';
  /** 'low' — нижняя струна сверху (как смотреть на гитару), 'high' — как в табулатуре. */
  stringOrder?: 'low' | 'high';
  /** Ключ HEADSTOCKS: 'inline' | 'pointed' | 'headless'. */
  headstock?: string;
  tabLayout?: 'scroll' | 'pages';
  /** 'all' | 'notes'. */
  tabMarks?: string;
  paper?: 'dark' | 'light';
  sheetScroll?: 'follow' | 'manual';
  sheetNotes?: boolean;
  beatBox?: boolean;

  // --- ПАТЧИ Пюпитра (VENDOR.md) ---
  /** (4) Масштаб рендера: пикселей буфера на CSS-пиксель (≤ 2); без него — DPR, тоже ≤ 2. */
  renderScale?: number;
  /** (7) Камера встаёт сразу, без пружин (prefers-reduced-motion). */
  reduceMotion?: boolean;
  /** (5) Левша: зеркало экрана без зеркала текста. */
  leftHanded?: boolean;
  /** (1) Что на ноте: лад или палец (апстрим — палец). */
  gemLabel?: 'fret' | 'finger';
  /** (1) Приёмник меток нот для DOM-слоя: задан — канвас цифр на нотах не рисует. Очищает вызывающий перед кадром. */
  gemSink?: FfGemLabel[];
  /** (8) «Софит» позиции руки; false — выключить (адаптивное качество). */
  soffit?: boolean;
}

/** (1) Метка ноты для DOM-слоя: CSS-пиксели канваса, size — высота цифр, alpha — прозрачность (появление из дали). */
export interface FfGemLabel {
  text: string;
  x: number;
  y: number;
  size: number;
  alpha: number;
}

/** (2) Статусы событий судьи для `arr.status` (Uint8Array по индексу ноты в `arr.notes`). */
export const STATUS: {
  readonly none: 0;
  readonly attacked: 1;
  readonly hit: 2;
  readonly early: 3;
  readonly late: 4;
  readonly wrong: 5;
  readonly missed: 6;
};

/** Партия, как её рисует дорожка Пюпитра: + (2) статусы нот. */
export type FfDrawArrangement = FfArrangement & { status?: Uint8Array };

export type FfDrawTheme = FfTheme & FfViewOptions;

/**
 * Состояние камеры между кадрами — держит вызывающий; `{}` — сразу встать на новую песню. Рисовальщики пишут в него
 * и свои поля (скорости пружин, кэш картинки грифа), поэтому тип открытый.
 */
export interface FfCamera {
  target?: { lo: number; hi: number; span: number; center: number };
  at?: number;
  center?: number;
  span?: number;
  left?: number;
  right?: number;
  /** (3) Проекция последнего кадра: лад (1 — первый), струна (0 — нижняя), секунды песни → CSS-пиксели канваса. */
  project?: (fret: number, string: number, sec: number) => { x: number; y: number; k: number };
  [key: string]: unknown;
}

/** Секунды нот в поле зрения при дальности и скорости нот вида. */
export function lookAhead(view: { drawDistance?: number; noteSpeed?: number }): number;

/**
 * Ведёт камеру к нужному кадру грифа; возвращает позицию руки на `now`. clock — мс монотонных часов (`performance.now()`),
 * now — секунды песни, capo — лад капо в этот момент.
 */
export function moveCamera(cam: FfCamera, anchors: readonly FfAnchor[], now: number, clock: number, capo?: number, snap?: boolean): FfAnchor;

/** 3D-дорожка. now — секунды песни. Пишет в `arr` свои кэши. */
export function drawHighway(
  canvas: HTMLCanvasElement,
  arr: FfDrawArrangement | null | undefined,
  now: number,
  t: FfDrawTheme,
  cam: FfCamera,
): void;

/** Нотный лист. */
export function drawSheet(
  canvas: HTMLCanvasElement,
  arr: FfArrangement | null | undefined,
  now: number,
  t: FfDrawTheme,
  cam?: FfCamera,
): void;

/** Табулатура. */
export function drawTab(canvas: HTMLCanvasElement, arr: FfArrangement | null | undefined, now: number, t: FfDrawTheme): void;
