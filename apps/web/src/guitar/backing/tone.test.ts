// Тон синт-минуса: усилитель держит заданный уровень и не пропускает верх выше кабинета, тишина остаётся тишиной, гейт
// глушит шум между нотами; панорама по закону alphaSynth; комната добавляет затухающий декоррелированный хвост и не
// трогает сухой сигнал при wet = 0.
import { describe, expect, it } from 'vitest';
import { ampSim, gatedRms, panInto, room } from './tone';
import type { StereoPcm } from './render';

const FS = 48000;
const sine = (hz: number, sec: number, amp: number) => Float32Array.from({ length: Math.round(sec * FS) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / FS));
const rms = (a: Float32Array, from = 0, to = a.length) => Math.sqrt(a.subarray(from, to).reduce((s, v) => s + v * v, 0) / Math.max(1, to - from));
/** Доля энергии выше 8 кГц: разность сигнала и его сглаживания скользящим средним по 3 отсчётам — грубый ФВЧ. */
const highShare = (a: Float32Array) => {
  let hi = 0, all = 0;
  for (let i = 1; i + 1 < a.length; i++) {
    const d = a[i] - (a[i - 1] + a[i] + a[i + 1]) / 3;
    hi += d * d;
    all += a[i] * a[i];
  }
  return hi / all;
};

describe('ampSim', () => {
  for (const model of ['high-gain', 'crunch'] as const) {
    it(`${model}: уровень по громким блокам — заданный, без NaN, верх срезан кабинетом`, () => {
      const di = sine(110, 2, 0.3);
      const out = ampSim(di, FS, model, 0.05);
      expect(out.length).toBe(di.length);
      expect(out.some(Number.isNaN)).toBe(false);
      expect(gatedRms(out)).toBeCloseTo(0.05, 3);
      // клиппинг рождает гармоники до самого верха — кабинет оставляет от них малую долю
      expect(highShare(out)).toBeLessThan(0.01);
    });
  }

  it('перегруз: у синуса появляются нечётные и (асимметрия каскадов) чётные гармоники', () => {
    const body = ampSim(sine(110, 1, 0.3), FS, 'high-gain', 0.1).subarray(FS / 4, (3 * FS) / 4);
    // амплитуда на частоте hz (одна точка ДПФ; на 0.5 с укладывается целое число периодов 110, 220, 330 Гц)
    const at = (hz: number) => {
      let re = 0, im = 0;
      body.forEach((v, i) => {
        re += v * Math.cos((2 * Math.PI * hz * i) / FS);
        im += v * Math.sin((2 * Math.PI * hz * i) / FS);
      });
      return Math.hypot(re, im);
    };
    const f0 = at(110);
    expect(at(330) / f0).toBeGreaterThan(0.05);
    expect(at(220) / f0).toBeGreaterThan(0.01);
  });

  it('тишина на входе — тишина той же длины', () => {
    const out = ampSim(new Float32Array(FS), FS, 'high-gain', 0.05);
    expect(out.length).toBe(FS);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('гейт: шум между нотами не раздувается гейном', () => {
    // нота 0.5 с, затем 1 с шума на −80 дБ
    const di = new Float32Array(Math.round(1.5 * FS));
    di.set(sine(110, 0.5, 0.3));
    for (let i = FS / 2; i < di.length; i++) di[i] = (Math.random() - 0.5) * 2e-4;
    const out = ampSim(di, FS, 'high-gain', 0.05);
    expect(rms(out, FS, di.length)).toBeLessThan(rms(out, 0, FS / 2) * 1e-3);
  });
});

describe('panInto', () => {
  const stereo = (n: number): StereoPcm => ({ left: new Float32Array(n), right: new Float32Array(n) });
  it('центр — √½ в оба канала, −1 — только левый, громкость — множитель', () => {
    const mono = Float32Array.of(1, 1);
    const c = stereo(2), l = stereo(2);
    panInto(c, mono, 0, 1);
    panInto(l, mono, -1, 0.5);
    expect([c.left[0], c.right[0]]).toEqual([expect.closeTo(Math.SQRT1_2, 6), expect.closeTo(Math.SQRT1_2, 6)]);
    expect([l.left[0], l.right[0]]).toEqual([expect.closeTo(0.5, 6), 0]);
  });
});

describe('room', () => {
  it('импульс → хвост затухает, левый и правый различаются; wet = 0 — сухой сигнал как есть', () => {
    const n = 2 * FS;
    const pcm: StereoPcm = { left: new Float32Array(n), right: new Float32Array(n) };
    pcm.left[0] = pcm.right[0] = 1;
    room(pcm, FS, 1);
    expect(pcm.left.some(Number.isNaN)).toBe(false);
    const early = rms(pcm.left, FS / 20, FS / 4), late = rms(pcm.left, (3 * FS) / 2, n);
    expect(early).toBeGreaterThan(1e-4);
    expect(late).toBeLessThan(early / 10);
    let diff = 0;
    for (let i = 1; i < n; i++) diff += Math.abs(pcm.left[i] - pcm.right[i]);
    expect(diff).toBeGreaterThan(0.1);

    const dry: StereoPcm = { left: sine(440, 0.1, 0.5), right: sine(440, 0.1, 0.5) };
    const copy = dry.left.slice();
    room(dry, FS, 0);
    expect(dry.left).toEqual(copy);
  });
});
