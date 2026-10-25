// Контраст токенов «Рампы» по WCAG 2.2 (ui-spec §2.2, §2.6; инвариант 19): все пары считаются по значениям из
// rampa.css, поэтому правка палитры, уронившая AA, валит тест. Пороги: 4.5 — текст, 3 — графика (ноты на дорожке),
// 2 — неактивное и декор (fg-4: исключение WCAG 1.4.3, проверяем только, что оно не исчезло совсем).
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

type RGB = [number, number, number]; // sRGB 0..1 (гамма)
interface RGBA {
  rgb: RGB;
  a: number;
}

const CSS = readFileSync(new URL('./rampa.css', import.meta.url), 'utf8');

// ---------- разбор CSS: правила верхнего уровня (блоки @media пропускаются — цвета в них не меняются) ----------
interface Rule {
  selectors: string[];
  body: string;
}
function topLevelRules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    for (; j < src.length && depth; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
    }
    if (!prelude.startsWith('@')) {
      rules.push({ selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: src.slice(open + 1, j - 1) });
    }
    i = j;
  }
  return rules;
}
const RULES = topLevelRules(CSS);

function rule(pick: (r: Rule) => boolean, what: string): Rule {
  const found = RULES.filter(pick);
  if (found.length !== 1) throw Error(`rampa.css: ожидалось одно правило «${what}», найдено ${found.length}`);
  return found[0];
}
const only = (selector: string) => rule((r) => r.selectors.length === 1 && r.selectors[0] === selector, selector);

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--rp-[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function parseColor(value: string): RGBA {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    const v = parseInt(h, 16);
    return { rgb: [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255], a: 1 };
  }
  const rgb = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(value);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
    return { rgb: [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255], a };
  }
  throw Error(`Не цвет: ${value}`);
}

// ---------- цветовая математика ----------
const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const delin = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function toOklab([r, g, b]: RGB): RGB {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, A, B]: RGB): RGB {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((x) => Math.min(1, Math.max(0, delin(x)))) as RGB; // вне sRGB — обрезка, как у браузеров
}
const oklch = (L: number, C: number, h: number): RGB =>
  fromOklab([L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]);
// color-mix(in oklab, c1 p1, c2) — CSS Color 5: каналы премультиплицируются альфой
function mix(c1: RGBA, p1: number, c2: RGBA): RGBA {
  const p2 = 1 - p1;
  const a = p1 * c1.a + p2 * c2.a;
  const o1 = toOklab(c1.rgb);
  const o2 = toOklab(c2.rgb);
  return { rgb: fromOklab(o1.map((v, i) => (p1 * c1.a * v + p2 * c2.a * o2[i]) / a) as RGB), a };
}
const over = (top: RGBA, under: RGB): RGB => top.rgb.map((v, i) => v * top.a + under[i] * (1 - top.a)) as RGB;
// режимы наложения W3C Compositing по каналам: source с альфой поверх непрозрачного backdrop
const softLight = (b: number, s: number) =>
  s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b);
const screen = (b: number, s: number) => b + s - b * s;
const blend = (under: RGB, src: RGB, alpha: number, f: (b: number, s: number) => number): RGB =>
  under.map((b, i) => (1 - alpha) * b + alpha * f(b, src[i])) as RGB;

// ---------- токены тем ----------
const darkRule = rule((r) => r.selectors.includes('.rampa') && /--rp-fg-1\s*:/.test(r.body), '.rampa — цвета');
const DARK = declarations(darkRule.body);
const LIGHT = { ...DARK, ...declarations(only(".rampa[data-theme='light']").body) };
type Theme = Record<string, string>;
const color = (t: Theme, name: string): RGBA => {
  const v = t[`--rp-${name}`];
  if (!v) throw Error(`Нет токена --rp-${name}`);
  return parseColor(v);
};
const solid = (t: Theme, name: string): RGB => {
  const c = color(t, name);
  if (c.a !== 1) throw Error(`--rp-${name} полупрозрачный`);
  return c.rgb;
};

// ---------- параметры плашек и постера — из правил rampa.css ----------
function num(re: RegExp, body: string, what: string): RegExpExecArray {
  const m = re.exec(body);
  if (!m) throw Error(`rampa.css: не найден ${what}`);
  return m;
}
const CHIP_TINT = Number(num(/color-mix\(in oklab, var\(--c\) ([\d.]+)%, var\(--rp-chip-base\)\)/, only('.rp-chip').body, 'тон .rp-chip')[1]) / 100;
const PROGRESS_TINT = Number(num(/color-mix\(in oklab, var\(--c\) ([\d.]+)%, var\(--rp-chip-base\)\)/, only('.rp-chip--progress').body, 'заливка .rp-chip--progress')[1]) / 100;
const LIGHT_PROGRESS_TINT = Number(num(/color-mix\(in oklab, var\(--c\) ([\d.]+)%, var\(--rp-chip-base\)\)/, only(".rampa[data-theme='light'] .rp-chip--progress").body, 'заливка .rp-chip--progress светлой темы')[1]) / 100;
const onart = num(/color-mix\(in oklab, var\(--c\) ([\d.]+)%, (rgb\([^)]*\))\)/, only('.rp-chip--onart').body, 'подложка .rp-chip--onart');
const ONART_TINT = Number(onart[1]) / 100;
const ONART_BASE = parseColor(onart[2]);
const OKLCH_H1 = /oklch\(([\d.]+) ([\d.]+) var\(--h1\)(?: \/ ([\d.]+))?\)/;
const posterBody = only('.rp-poster').body;
const spot = num(OKLCH_H1, posterBody, 'прожектор постера');
const ground = num(/linear-gradient\(\d+deg, oklch\(([\d.]+) ([\d.]+) var\(--h1\)\)/, posterBody, 'фон постера');
const art = num(OKLCH_H1, only('.rp-poster__art').body, 'рисунок постера');
const artScreen = num(OKLCH_H1, only('.rp-poster__art--screen').body, 'рисунок постера (screen)');
// Самые светлые места постера при любом оттенке h1: прожектор поверх фона и он же под рисунком (soft-light / screen).
// Подложка плашки размыта (blur 6px), поэтому зерно и мелкий узор усредняются — берём заливку, а не отдельный пиксель.
const POSTER_SPOTS: RGB[] = [];
for (let h = 0; h < 360; h++) {
  const lit = over({ rgb: oklch(+spot[1], +spot[2], h), a: +(spot[3] ?? 1) }, oklch(+ground[1], +ground[2], h));
  POSTER_SPOTS.push(lit, blend(lit, oklch(+art[1], +art[2], h), +(art[3] ?? 1), softLight));
  POSTER_SPOTS.push(blend(lit, oklch(+artScreen[1], +artScreen[2], h), +(artScreen[3] ?? 1), screen));
}

// ---------- реестр пар ----------
interface Pair {
  id: string;
  ratio: number;
  min: number;
}
const SURFACES = ['bg', 'surface-1', 'surface-2', 'surface-3', 'surface-4'];
const SIGNALS = ['ok', 'warn', 'bad', 'info', 'early', 'late'];
const CHIP_COLORS = [...SIGNALS, 'light', 'fg-2']; // fg-2 — плашка без модификатора (--c: var(--rp-fg-2))
const STRINGS = [0, 1, 2, 3, 4, 5, 6, 7];

function textPairs(t: Theme, theme: string, fgs: string[], bgs: string[], min: number): Pair[] {
  return fgs.flatMap((fg) => bgs.map((bg) => ({ id: `${theme}: ${fg} на ${bg}`, ratio: contrast(solid(t, fg), solid(t, bg)), min })));
}
function chipPairs(t: Theme, theme: string, kind: string, tint: number, bgs: string[]): Pair[] {
  return CHIP_COLORS.flatMap((c) =>
    bgs.map((bg) => {
      const text = color(t, c);
      const plate = over(mix(text, tint, color(t, 'chip-base')), solid(t, bg));
      return { id: `${theme}: ${c} на ${kind} поверх ${bg}`, ratio: contrast(text.rgb, plate), min: 4.5 };
    }),
  );
}
function onartPairs(t: Theme, theme: string): Pair[] {
  return CHIP_COLORS.map((c) => {
    const text = color(t, c);
    const plate = mix(text, ONART_TINT, ONART_BASE);
    const ratio = Math.min(...POSTER_SPOTS.map((p) => contrast(text.rgb, over(plate, p))));
    return { id: `${theme}: ${c} на плашке --onart поверх самого светлого места постера`, ratio, min: 4.5 };
  });
}

const GROUPS: Record<string, Pair[]> = {
  // §2.2: текст на поверхностях, свет-акцент, сигналы
  'тёмная — текст на поверхностях': textPairs(DARK, 'тёмная', ['fg-1', 'fg-2', 'fg-3', 'light', ...SIGNALS], SURFACES, 4.5),
  'тёмная — fg-4 (неактивное, декор)': textPairs(DARK, 'тёмная', ['fg-4'], SURFACES, 2),
  'тёмная — текст на светлой кнопке': textPairs(DARK, 'тёмная', ['on-light'], ['light'], 4.5),
  // §2.2: сигнальный текст на своей плашке (тон --c поверх --rp-chip-base) и на заливке плашки-прогресса
  'тёмная — плашки': chipPairs(DARK, 'тёмная', 'плашке', CHIP_TINT, SURFACES),
  // плашки не кладём на surface-4 (выбранное/нажатое): bad на заливке прогресса там 4.44
  'тёмная — плашки-прогресс': chipPairs(DARK, 'тёмная', 'заливке плашки-прогресса', PROGRESS_TINT, SURFACES.slice(0, 4)),
  // §2.2: плашки поверх постеров — только --onart
  'тёмная — плашки на постере': onartPairs(DARK, 'тёмная'),
  // §2.2: струны — нота (графика) к залу, тёмная цифра на ноте, текстовый вариант на поверхностях
  'струны': STRINGS.flatMap((i) => [
    { id: `нота str-${i} к hall`, ratio: contrast(solid(DARK, `str-${i}`), solid(DARK, 'hall')), min: 3 },
    { id: `цифра on-light на ноте str-${i}`, ratio: contrast(solid(DARK, 'on-light'), solid(DARK, `str-${i}`)), min: 4.5 },
    ...textPairs(DARK, 'тёмная', [`str-${i}-text`], SURFACES, 4.5),
  ]),
  // §2.6: светлая тема — весь текст на bg/s1/s2/s3; на s4 — только нейтральный (цветной текст на s4 не ставится)
  'светлая — текст на поверхностях': textPairs(
    LIGHT,
    'светлая',
    ['fg-1', 'fg-2', 'fg-3', 'light', ...SIGNALS, ...STRINGS.map((i) => `str-${i}-text`)],
    SURFACES.slice(0, 4),
    4.5,
  ),
  'светлая — нейтральный текст на surface-4': textPairs(LIGHT, 'светлая', ['fg-1', 'fg-2', 'fg-3', 'light'], ['surface-4'], 4.5),
  'светлая — fg-4 (неактивное, декор)': textPairs(LIGHT, 'светлая', ['fg-4'], SURFACES, 2),
  'светлая — текст на тёмной кнопке': textPairs(LIGHT, 'светлая', ['on-light'], ['light'], 4.5),
  'светлая — плашки': chipPairs(LIGHT, 'светлая', 'плашке', CHIP_TINT, SURFACES.slice(0, 4)),
  'светлая — плашки-прогресс': chipPairs(LIGHT, 'светлая', 'заливке плашки-прогресса', LIGHT_PROGRESS_TINT, SURFACES.slice(0, 4)),
};

const fmt = (x: number) => x.toFixed(2);
let checked = 0;
let passed = 0;

describe('контраст токенов Рампы (WCAG 2.2)', () => {
  for (const [group, pairs] of Object.entries(GROUPS)) {
    it(`${group}: ${pairs.length} пар`, () => {
      expect(pairs.length).toBeGreaterThan(0);
      checked += pairs.length;
      const failed = pairs.filter((p) => !(p.ratio >= p.min)).map((p) => `${p.id}: ${fmt(p.ratio)} < ${p.min}`);
      passed += pairs.length - failed.length;
      expect(failed).toEqual([]);
    });
  }

  it('сходится с расчётом ui-spec §2.2 (выборка опорных чисел)', () => {
    const ref: [string, string, number][] = [
      ['fg-1', 'bg', 18.5],
      ['fg-3', 'surface-4', 4.8],
      ['fg-4', 'bg', 3.49],
      ['bad', 'surface-4', 5.31],
      ['str-5-text', 'surface-4', 5.17],
    ];
    for (const [fg, bg, want] of ref) expect(+fmt(contrast(solid(DARK, fg), solid(DARK, bg)))).toBe(want);
    expect(+fmt(contrast(solid(DARK, 'str-5'), solid(DARK, 'hall')))).toBe(4.8);
    expect(+fmt(contrast(solid(DARK, 'on-light'), solid(DARK, 'light')))).toBe(18.82);
  });

  it('постер в светлой теме — «тёмный остров»: плашки --onart считаются по тёмной палитре', () => {
    expect(darkRule.selectors).toContain(".rampa[data-theme='light'] .rp-poster");
    expect(only(".rampa[data-theme='light']").selectors).toEqual([".rampa[data-theme='light']"]);
  });

  afterAll(() => {
    console.log(`КОНТРАСТ ${passed}/${checked} ≥ порогов (текст 4.5, графика 3, декор 2)`);
  });
});
