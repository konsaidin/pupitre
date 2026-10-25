// Типы к вендорному themes.js (fretfall @ ed2bc3b, MIT; патчи Пюпитра: FONTS.*.href = null, набор rampa, STRINGS.cb, DEFAULT_STYLE) — по факту исходника.

/** Форма нот. */
export interface FfLook {
  label: string;
  /** 'glass' | 'pill' у апстрима. */
  gem: string;
}

/** Палитра; `str` — цвета струн от НИЖНЕЙ. headline/plate/glass — по желанию набора (см. chromeVars). */
export interface FfColors {
  label: string;
  bg: string;
  ink: string;
  text: string;
  muted: string;
  accent: string;
  floor0: string;
  floor1: string;
  lane: string;
  anchorLane: string;
  anchorFill: string;
  anchorOpacity: number;
  measure: string;
  beat: string;
  str: string[];
  post: string;
  anchorPost: string;
  nut: string;
  board: string;
  inlayDot: string;
  inlay: string;
  chordBox: string;
  chordFill: string;
  flash: string;
  numOn: string;
  numOff: string;
  phraseDone: string;
  phraseTodo: string;
  chip: string;
  chipBorder: string;
  headline?: string;
  plate?: string;
  glass?: boolean;
}

/** Набор шрифтов. `href` — всегда null (ПАТЧ: без Google Fonts, шрифты подключает приложение). */
export interface FfFontSet {
  label: string;
  href: string | null;
  ui: string;
  num: string;
  lyric: string;
  lyricStyle: string;
  display?: string;
}

/** Цвета струн от НИЖНЕЙ; без `str` — цвета палитры. */
export interface FfStringSet {
  label: string;
  str?: string[];
}

/** Ключи наборов LOOKS/COLORS/FONTS/STRINGS. */
export interface FfStyle {
  look: string;
  colors: string;
  fonts: string;
  strings: string;
}

export type FfTheme = FfLook & FfColors & FfFontSet;

export const LOOKS: Record<string, FfLook>;
export const COLORS: Record<string, FfColors>;
export const FONTS: Record<string, FfFontSet>;
export const STRINGS: Record<string, FfStringSet>;
export const DEFAULT_STYLE: FfStyle;

/** Тема = форма + палитра + шрифты (+ цвета струн набора STRINGS). */
export function theme(style: FfStyle): FfTheme;
/** CSS-переменные обвязки плеера по теме. */
export function chromeVars(t: FfTheme): Record<string, string>;
