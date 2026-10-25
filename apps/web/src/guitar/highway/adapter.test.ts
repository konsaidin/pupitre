// Адаптер TabMap → партия fretfall на синтетической карте devMap и патчи дорожки (VENDOR.md): метки ладов уходят в
// DOM-приёмник, проекция cam.project, масштаб рендера задаёт размер буфера, статусы и левша не роняют кадр,
// reduce-motion ставит камеру сразу.
import { beforeAll, describe, expect, it } from 'vitest';
import { devMap } from '../model/devMap';
import { drawHighway, drawTab, STATUS, type FfCamera, type FfGemLabel } from '../vendor/fretfall/highway.js';
import { DEFAULT_STYLE, theme } from '../vendor/fretfall/themes.js';
import { adaptMap } from './adapter';

// Заглушки канваса — как в апстрим-тесте highway.test.mjs: любой метод контекста — пустая функция.
const texts: string[] = [];
const context = new Proxy(
  {
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillText: (str: string) => texts.push(str),
  } as Record<string, unknown>,
  { get: (target, key: string) => (key in target ? target[key] : () => {}) },
);
const canvas = () => ({ clientWidth: 1440, clientHeight: 900, width: 0, height: 0, getContext: () => context }) as unknown as HTMLCanvasElement;
beforeAll(() => {
  Object.assign(globalThis, {
    devicePixelRatio: 3,
    OffscreenCanvas: class { getContext() { return context; } },
    Path2D: class { moveTo() {} lineTo() {} arc() {} ellipse() {} quadraticCurveTo() {} rect() {} },
  });
});

describe('adaptMap', () => {
  const map = devMap({ events: 400 });
  const { arr, fromFf, ffOfEvent } = adaptMap(map);

  it('все ноты событий — в партии, по времени и струне; карта индексов взаимна', () => {
    const total = map.notes.reduce((n, e) => n + e.notes.length, 0);
    expect(arr.notes).toHaveLength(total);
    for (let i = 1; i < arr.notes.length; i++) {
      const [a, b] = [arr.notes[i - 1], arr.notes[i]];
      expect(a.time < b.time || (a.time === b.time && a.string <= b.string)).toBe(true);
    }
    ffOfEvent.forEach((list, ev) => list.forEach((i) => expect([fromFf[i * 2], fromFf[i * 2 + 1]]).toEqual([ev, expect.any(Number)])));
    expect(arr.status).toHaveLength(total);
  });

  it('аккорды: по одному на удар, индексы нот на месте, повтор помечен markRepeats', () => {
    const chordEvents = map.notes.filter((e) => e.chordId !== undefined);
    expect(arr.chords).toHaveLength(chordEvents.length);
    arr.chords.forEach((c) => c.notes.forEach((i) => expect(arr.notes[i].chord).toBe(arr.chords.indexOf(c))));
    expect(arr.chords.some((c) => c.highDensity)).toBe(true);
  });

  it('время в секундах, якоря и доли из карты', () => {
    expect(arr.notes[0].time).toBeCloseTo(map.notes[0].startMs / 1000, 9);
    expect(arr.anchors).toHaveLength(map.anchorsMs.length);
    expect(arr.beats.filter((b) => b.measure > 0)).toHaveLength(map.bars.length);
  });
});

describe('патчи дорожки', () => {
  const { arr } = adaptMap(devMap({ events: 200 }));
  const t = { ...theme(DEFAULT_STYLE), headstock: 'headless' };

  it('тема по умолчанию — Рампа', () => {
    expect(t.bg).toContain('radial-gradient');
    expect(t.num).toContain('Rampa Mono');
  });

  it('(1) метки — в DOM-приёмник, канвас цифр ладов на нотах не рисует; (3) cam.project', () => {
    const sink: FfGemLabel[] = [];
    const cam: FfCamera = {};
    texts.length = 0;
    drawHighway(canvas(), arr, 2, { ...t, gemLabel: 'fret', gemSink: sink }, cam);
    expect(sink.length).toBeGreaterThan(0);
    for (const label of sink) {
      expect(label.text).toMatch(/^\d+$/);
      expect(label.size).toBeGreaterThan(0);
    }
    expect(cam.project).toBeTypeOf('function');
    const near = cam.project!(5, 0, 2), far = cam.project!(5, 0, 4);
    expect(near.y).toBeGreaterThan(far.y); // дальние ноты выше на экране
    expect(near.k).toBeGreaterThan(far.k);
  });

  it('(4) renderScale задаёт размер буфера; без него — DPR, не выше 2', () => {
    const c1 = canvas();
    drawHighway(c1, arr, 1, { ...t, renderScale: 1.25 }, {});
    expect([c1.width, c1.height]).toEqual([1800, 1125]);
    const c2 = canvas();
    drawHighway(c2, arr, 1, t, {});
    expect([c2.width, c2.height]).toEqual([2880, 1800]);
  });

  it('(2) статусы и (5) левша не роняют кадр; левша зеркалит проекцию', () => {
    arr.status.fill(STATUS.hit, 0, 10);
    arr.status.fill(STATUS.missed, 10, 20);
    const right: FfCamera = {}, left: FfCamera = {};
    for (const now of [0.5, 1, 2, 3]) expect(() => drawHighway(canvas(), arr, now, t, right)).not.toThrow();
    for (const now of [0.5, 1, 2, 3]) expect(() => drawHighway(canvas(), arr, now, { ...t, leftHanded: true }, left)).not.toThrow();
    const a = right.project!(3, 2, 3), b = left.project!(3, 2, 3);
    expect(a.x + b.x).toBeCloseTo(1440, 0);
    expect(a.y).toBeCloseTo(b.y, 6);
  });

  it('табулатура (вид T) рисуется по той же партии', () => {
    for (const now of [0, 1.5, 4, 9]) expect(() => drawTab(canvas(), arr, now, { ...t, renderScale: 1 })).not.toThrow();
  });

  it('(7) reduce-motion: камера сразу на кадре', () => {
    const cam: FfCamera = {};
    drawHighway(canvas(), arr, 0, { ...t, reduceMotion: true }, cam);
    drawHighway(canvas(), arr, 20, { ...t, reduceMotion: true }, cam);
    expect(cam.center).toBe(cam.target?.center);
    expect(cam.span).toBe(cam.target?.span);
  });
});
