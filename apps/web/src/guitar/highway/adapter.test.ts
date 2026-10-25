// Адаптер TabMap → партия fretfall на синтетической карте devMap и патчи дорожки (VENDOR.md): метки ладов уходят в
// DOM-приёмник, проекция cam.project, масштаб рендера задаёт размер буфера, статусы и левша не роняют кадр,
// reduce-motion ставит камеру сразу; (10) вспышка и гашение промаха — от момента вердикта, когда нота уже ушла.
import { beforeAll, describe, expect, it } from 'vitest';
import { devMap } from '../model/devMap';
import { drawHighway, drawTab, STATUS, type FfCamera, type FfGemLabel } from '../vendor/fretfall/highway.js';
import { DEFAULT_STYLE, theme } from '../vendor/fretfall/themes.js';
import { adaptMap, setVerdict, stampStatuses } from './adapter';

// Заглушки канваса — как в апстрим-тесте highway.test.mjs: любой метод контекста — пустая функция; счётчики — вспышки
// (радиальные градиенты) и заливки серым промаха.
const texts: string[] = [];
const spy = { radial: 0, grey: 0 };
const context = new Proxy(
  {
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => {
      spy.radial++;
      return { addColorStop() {} };
    },
    fillText: (str: string) => texts.push(str),
    set fillStyle(v: unknown) {
      if (v === '#5F6679') spy.grey++;
    },
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

  it('(10) вспышка попадания и серая нота промаха — от момента вердикта, после ухода ноты с дорожки', () => {
    const a = adaptMap(devMap({ events: 200 }));
    const cam: FfCamera = {};
    // одиночная нота на ладу, сыгранная 0.6 с назад: на дорожке её уже нет
    const i = a.arr.notes.findIndex((n, k) => n.time > 2 && n.fret > 0 && !n.mute && n.chord === null && a.ffOfEvent[a.fromFf[k * 2]].length === 1);
    expect(i).toBeGreaterThan(0);
    const now = a.arr.notes[i].time + 0.6;
    const ev = a.fromFf[i * 2];
    const frame = (at: number) => {
      spy.radial = 0;
      spy.grey = 0;
      drawHighway(canvas(), a.arr, at, t, cam);
      return { ...spy };
    };
    const base = frame(now), base2 = frame(now + 0.2), base1 = frame(now + 0.1), base5 = frame(now + 0.5);
    setVerdict(a, ev, STATUS.hit, 20);
    stampStatuses(a, now - 0.05);
    expect(a.arr.statusAt[i]).toBe(now - 0.05);
    expect(frame(now).radial).toBe(base.radial + 1); // вспышка жива 200 мс от вердикта
    expect(frame(now + 0.2).radial).toBe(base2.radial); // и погасла
    setVerdict(a, ev, STATUS.missed);
    stampStatuses(a, now);
    expect(frame(now + 0.1).grey).toBe(base1.grey + 1); // промах гаснет на грифе
    expect(frame(now + 0.5).grey).toBe(base5.grey); // через 450 мс — погас
    setVerdict(a, ev, STATUS.none);
    stampStatuses(a, now + 0.6);
    expect(a.arr.statusAt[i]).toBeNaN(); // перемотка: снова ждёт
    // место вердикта — над всеми струнами на ладу ноты
    frame(now + 0.6);
    const top = cam.projectAbove!(i);
    for (let str = 0; str < a.arr.strings; str++) expect(top.y).toBeLessThan(cam.project!(a.arr.notes[i].fret, str, now + 0.6).y);
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
