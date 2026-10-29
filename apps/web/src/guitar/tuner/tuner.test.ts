// Тюнер без React: пресеты и их имена, пресет при открытии, ноты и центы от эталона, «в строю» на ±3 центах; сглаживание
// (чёткость, порог шума, медиана против выбросов, тишина атаки, удержание и угасание); струна — ближайшая, с запасом и
// подтверждением смены, не прыгает на атаке; гармоника у низких струн баса; замеры струн для «Сохранить строй».
import { describe, expect, it } from 'vitest';
import type { InputFrame } from '../../audio/instrument/session';
import {
  ATTACK_MS, createTuner, defaultPreset, floorDbOf, formatCents, GATE_DB, HOLD_MS, initialPreset, LIVE_MS, nearestNote,
  nearestString, noteHz, noteName, noteParts, presetById, presetFlats, presetName, PRESETS, referenceShift, savedTuningName,
  statusOf, SWITCH_FRAMES, tuningToSave, type Tuner, type TunerConfig,
} from './tuner';

const STEP = 5.3; // кадр ядра: 256 сэмплов при 48 кГц
const frame = (atMs: number, midi: number, patch: Partial<InputFrame> = {}): InputFrame => ({ atMs, midi, clarity: 0.95, levelDb: -20, onset: false, ...patch });

/** Кадры высоты midi (число или функция номера кадра) с from на ms мс; вернёт время после последнего. */
function feed(tuner: Tuner, midi: number | ((i: number) => number), from: number, ms: number, patch: Partial<InputFrame> = {}): number {
  let at = from;
  for (let i = 0; at < from + ms; i++, at += STEP) tuner.push(frame(at, typeof midi === 'number' ? midi : midi(i), patch));
  return at;
}

const STANDARD = presetById('e-standard').open;
const config = (patch: Partial<TunerConfig> = {}): TunerConfig => ({ a4Hz: 440, open: null, floorDb: GATE_DB, ...patch });

describe('пресеты строя', () => {
  it('восемь пресетов: имена — как у строя партий, число струн, инструмент', () => {
    expect(PRESETS.map((p) => `${presetName(p)}/${p.open.length}/${p.instrument}`)).toEqual([
      'E Standard/6/guitar', 'Drop D/6/guitar', 'D Standard/6/guitar', 'E♭ Standard/6/guitar', 'Drop C/6/guitar',
      'B Standard/7/guitar', 'E Standard/4/bass', 'B Standard/5/bass',
    ]);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(PRESETS.filter(presetFlats).map((p) => p.id)).toEqual(['eb-standard']);
  });

  it('по умолчанию — стандарт инструмента; сохранённый строй того же инструмента — его пресет', () => {
    expect(defaultPreset('guitar').id).toBe('e-standard');
    expect(defaultPreset('bass').id).toBe('bass4-e-standard');
    expect(initialPreset('guitar', undefined, 440).id).toBe('e-standard');
    // Drop D, снятый с небольшим разбросом
    expect(initialPreset('guitar', [38.04, 44.97, 50.02, 54.99, 59.01, 63.96], 440).id).toBe('drop-d');
    // строй баса при гитаре по умолчанию — не наш инструмент
    expect(initialPreset('guitar', [28, 33, 38, 43], 440).id).toBe('e-standard');
    expect(initialPreset('bass', [23, 28, 33, 38, 43], 440).id).toBe('bass5-b-standard');
    // замеры — при A4 = 440, строили от 432: стандарт при эталоне 432
    const shift = referenceShift(432);
    expect(initialPreset('guitar', STANDARD.map((m) => m + shift), 432).id).toBe('e-standard');
    expect(presetById('нет такого').id).toBe('e-standard');
  });
});

describe('ноты, центы, эталон', () => {
  it('сдвиг эталона и частота ноты', () => {
    expect(referenceShift(440)).toBe(0);
    expect(referenceShift(880)).toBeCloseTo(12);
    expect(noteHz(69, 442)).toBeCloseTo(442);
    expect(noteHz(40, 440)).toBeCloseTo(82.41, 2);
  });

  it('«в строю» — до ±3 центов по округлённому значению', () => {
    expect(statusOf(0)).toBe('in');
    expect(statusOf(3.4)).toBe('in');
    expect(statusOf(-3.4)).toBe('in');
    expect(statusOf(3.6)).toBe('sharp');
    expect(statusOf(-3.6)).toBe('flat');
    expect(statusOf(-48)).toBe('flat');
  });

  it('центы со знаком, минус типографский; имена нот с ♯ или ♭', () => {
    expect([formatCents(12.4), formatCents(-7.6), formatCents(0.3), formatCents(-0.4)]).toEqual(['+12', '−8', '0', '0']);
    expect(noteName(61)).toBe('C♯4');
    expect(noteName(61, true)).toBe('D♭4');
    expect(noteName(40)).toBe('E2');
    expect(noteParts(51, true)).toEqual({ pitch: 'E♭', octave: '3' });
  });

  it('ближайшая нота с запасом у границы ±50 центов', () => {
    expect(nearestNote(69.45)).toBe(69);
    expect(nearestNote(69.55)).toBe(70);
    expect(nearestNote(69.55, 69)).toBe(69);
    expect(nearestNote(69.65, 69)).toBe(70);
  });

  it('порог уровня: фон + 6 дБ, не ниже GATE_DB', () => {
    expect(floorDbOf(NaN)).toBe(GATE_DB);
    expect(floorDbOf(-80)).toBe(GATE_DB);
    expect(floorDbOf(-40)).toBe(-34);
  });
});

describe('ближайшая струна', () => {
  it('ближайшая; прежняя держится, пока другая не ближе на запас; дальше крайних — не струна', () => {
    expect(nearestString(STANDARD, 40.3, 0)).toEqual({ string: 0, octave: 0 });
    expect(nearestString(STANDARD, 47.4, 0)?.string).toBe(1); // ля, +2.4
    expect(nearestString(STANDARD, 47.6, 0)?.string).toBe(2); // ре, −2.4
    expect(nearestString(STANDARD, 47.6, 0, 1)?.string).toBe(1); // запас 0.4
    expect(nearestString(STANDARD, 48.0, 0, 1)?.string).toBe(2);
    expect(nearestString(STANDARD, 36.5, 0)?.string).toBe(0);
    expect(nearestString(STANDARD, 69, 0)).toBeNull(); // ля первой октавы — лад на первой струне
    expect(nearestString(STANDARD, NaN, 0)).toBeNull();
  });

  it('у струн ниже предела детектора — кандидат октавой выше; прямая струна сильнее гармоники', () => {
    const bass4 = presetById('bass4-e-standard').open;
    // ми контроктавы (41 Гц) детектор слышит как ми большой октавы
    expect(nearestString(bass4, 40.1, 0)).toEqual({ string: 0, octave: 1 });
    expect(nearestString(bass4, 45, 0)).toEqual({ string: 1, octave: 1 });
    expect(nearestString(bass4, 38.2, 0)).toEqual({ string: 2, octave: 0 });
    const bass5 = presetById('bass5-b-standard').open;
    expect(nearestString(bass5, 35, 0)).toEqual({ string: 0, octave: 1 });
    // Drop C: до большой октавы (65 Гц) детектор слышит — до малой октавы остаётся третьей струной
    expect(nearestString(presetById('drop-c').open, 48, 0)).toEqual({ string: 2, octave: 0 });
  });
});

describe('сглаживание', () => {
  it('хроматика: нота, центы и частота от эталона', () => {
    const tuner = createTuner(config());
    const end = feed(tuner, 69.12, 0, 200);
    const r = tuner.read(end);
    expect(r.phase).toBe('live');
    expect(r.note).toBe(69);
    expect(r.cents).toBeCloseTo(12);
    expect(r.status).toBe('sharp');
    expect(r.hz).toBeCloseTo(443.07, 1);
    expect(r.targetHz).toBeCloseTo(440);
    // тот же звук при эталоне 443 — почти в строю
    tuner.configure(config({ a4Hz: 443 }));
    const at443 = tuner.read(end);
    expect(at443.note).toBe(69);
    expect(Math.abs(at443.cents)).toBeLessThan(1);
    expect(at443.status).toBe('in');
    expect(at443.targetHz).toBeCloseTo(443);
  });

  it('кадры с низкой чёткостью и на уровне шума не идут в счёт', () => {
    const tuner = createTuner(config({ floorDb: -40 }));
    let at = feed(tuner, 60, 0, 200, { clarity: 0.6 });
    at = feed(tuner, 60, at, 200, { levelDb: -45 });
    at = feed(tuner, NaN, at, 200);
    expect(tuner.read(at).phase).toBe('none');
    expect(tuner.read(at).midi).toBeNaN();
    at = feed(tuner, 60, at, 100, { levelDb: -30 });
    expect(tuner.read(at).note).toBe(60);
  });

  it('медиана: редкие октавные и случайные выбросы не сдвигают показ', () => {
    const tuner = createTuner(config());
    // соль малой октавы +5 центов; каждый 7-й кадр — октавой выше, каждый 11-й — случайная высота
    const glitch = (i: number) => (i % 7 === 3 ? 67.05 : i % 11 === 5 ? 61.3 : 55.05);
    const seen = new Set<string>();
    for (let i = 0, at = 0; i < 80; i++, at += STEP) {
      tuner.push(frame(at, glitch(i)));
      const r = tuner.read(at);
      if (r.phase === 'live') seen.add(`${r.note} ${Math.round(r.cents)}`);
    }
    expect([...seen]).toEqual(['55 5']);
  });

  it('без сигнала значение держится, потом гаснет', () => {
    const tuner = createTuner(config());
    const end = feed(tuner, 64, 0, 150);
    expect(tuner.read(end + 10).phase).toBe('live');
    expect(tuner.read(end + LIVE_MS + 10).phase).toBe('held');
    expect(tuner.read(end + LIVE_MS + 10).note).toBe(64);
    const gone = tuner.read(end + HOLD_MS + 10);
    expect(gone.phase).toBe('none');
    expect(gone.note).toBe(64); // последнее значение — для угасшего показа
  });
});

describe('по струнам', () => {
  it('струна выбирается сама; у каждой — свой замер; смена струны — после подтверждения', () => {
    const tuner = createTuner(config({ open: STANDARD }));
    let at = feed(tuner, 39.9, 0, 200); // шестая, −10 центов
    let r = tuner.read(at);
    expect([r.string, r.note, Math.round(r.cents), r.status]).toEqual([0, 40, -10, 'flat']);
    tuner.push(frame(at, NaN, { onset: true }));
    at = feed(tuner, 45.02, at + 1, 200); // пятая, +2 цента
    r = tuner.read(at);
    expect([r.string, r.note, r.status]).toEqual([1, 45, 'in']);
    const m = tuner.measured();
    expect(m[0]).toBeCloseTo(39.9);
    expect(m[1]).toBeCloseTo(45.02);
    expect(m.slice(2).every(Number.isNaN)).toBe(true);
  });

  it('на атаке струна не прыгает: ложный низ первых кадров удара глушится', () => {
    const tuner = createTuner(config({ open: STANDARD }));
    let at = feed(tuner, 45, 0, 300);
    expect(tuner.read(at).string).toBe(1);
    // повторный удар по пятой: окно обнулено, первые ATTACK_MS кадры YIN показывает ми (ложный низ), потом — ля
    tuner.push(frame(at, NaN, { onset: true }));
    const strings = new Set<number>();
    for (let t = at; t < at + ATTACK_MS + 200; t += STEP) {
      tuner.push(frame(t, t < at + ATTACK_MS - 1 ? 40.1 : 45.01));
      strings.add(tuner.read(t).string);
    }
    expect([...strings]).toEqual([1]);
    expect(tuner.measured()[0]).toBeNaN();
  });

  it('переход на другую струну без пойманной атаки: смесь кадров в окне не пишется в замер прежней струны', () => {
    // шестая −8 центов, затем сразу пятая; атака не пришла (или пришла позже кадров) — окно какое-то время смешанное
    // шаг 5.5 мс — в окне чётное число кадров (в жизни кадры приходят пачками, и чётность окна гуляет)
    const tuner = createTuner(config({ open: STANDARD }));
    let at = 0;
    for (; at < 300; at += 5.5) tuner.push(frame(at, 39.92));
    for (; at < 600; at += 5.5) tuner.push(frame(at, 45));
    expect(tuner.read(at).string).toBe(1);
    const m = tuner.measured();
    expect(m[0]).toBeCloseTo(39.92, 3);
    expect(m[1]).toBeCloseTo(45, 3);
  });

  it('короткий заход высоты на соседнюю струну (меньше SWITCH_FRAMES значений) не меняет струну', () => {
    const tuner = createTuner(config({ open: STANDARD }));
    let at = feed(tuner, 50, 0, 300);
    // после удара и его тишины окно пустое: 4 кадра соли дают медиане соль на 3 значения — меньше подтверждения
    tuner.push(frame(at, NaN, { onset: true }));
    const strings = new Set<number>();
    at += ATTACK_MS + 1;
    for (let i = 0; i < 40; i++, at += STEP) {
      tuner.push(frame(at, i < 4 ? 55 : 50));
      strings.add(tuner.read(at).string);
    }
    expect(SWITCH_FRAMES).toBeGreaterThan(3);
    expect([...strings]).toEqual([2]);
    // устойчивая смена — струна сменилась
    at = feed(tuner, 55, at, 200);
    expect(tuner.read(at).string).toBe(3);
  });

  it('дальше крайних струн — нота без струны', () => {
    const tuner = createTuner(config({ open: STANDARD }));
    const at = feed(tuner, 76, 0, 200);
    const r = tuner.read(at);
    expect([r.string, r.note]).toEqual([-1, 76]);
  });

  it('бас: детектор слышит гармонику — струна, нота и замер по основному тону', () => {
    const tuner = createTuner(config({ open: presetById('bass4-e-standard').open }));
    const at = feed(tuner, 40.05, 0, 200); // ми контроктавы на +5 центов, услышанная октавой выше
    const r = tuner.read(at);
    expect([r.string, r.note, Math.round(r.cents)]).toEqual([0, 28, 5]);
    expect(r.hz).toBeCloseTo(41.32, 1);
    expect(r.targetHz).toBeCloseTo(41.2, 1);
    expect(tuner.measured()[0]).toBeCloseTo(28.05);
  });

  it('замеры — при A4 = 440, как измерены; заход в хроматику их не стирает, другой пресет — сбрасывает', () => {
    const tuner = createTuner(config({ open: STANDARD, a4Hz: 442 }));
    const shift = referenceShift(442);
    let at = 0;
    for (const m of STANDARD) {
      tuner.push(frame(at, NaN, { onset: true }));
      at = feed(tuner, m + shift, at + 1, 200);
    }
    const saved = tuningToSave(tuner.measured());
    expect(saved).not.toBeNull();
    saved!.forEach((m, i) => expect(m).toBeCloseTo(STANDARD[i] + shift, 3));
    expect(tuner.read(at).status).toBe('in');
    expect(savedTuningName(saved!, 442)).toBe('E Standard');
    tuner.configure(config({ open: null, a4Hz: 442 }));
    expect(tuner.measured()).toEqual([]);
    tuner.configure(config({ open: STANDARD, a4Hz: 442 }));
    expect(tuningToSave(tuner.measured())).toEqual(saved);
    tuner.configure(config({ open: presetById('drop-d').open, a4Hz: 442 }));
    expect(tuner.measured().every(Number.isNaN)).toBe(true);
    expect(tuningToSave(tuner.measured())).toBeNull();
  });

  it('сохранять нечего, пока не сняты все струны', () => {
    expect(tuningToSave([])).toBeNull();
    expect(tuningToSave([40, NaN, 50])).toBeNull();
    expect(tuningToSave([40.12345, 45])).toEqual([40.123, 45]);
  });
});
