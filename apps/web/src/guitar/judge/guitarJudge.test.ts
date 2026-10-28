// Гитарный судья на картах своих фикстур (импорт alphaTex → играбельная карта) и синтетических кадрах: попадания, рано и
// поздно, вне окна, не та нота, ошибка октавы, удар без высоты, восьмые подряд, легато без атаки, аккорд, эталон A4,
// строгость, отклик дорожке (ранний: попадание по первым кадрам высоты, не та нота — по концу окна высоты, промах — по
// часам), перемотка.
import { describe, expect, it } from 'vitest';
import { convertTex } from '../import/fixtures';
import { buildPlayableMap } from '../model/playable';
import type { Strictness, TabMap } from '../model/types';
import type { JudgeVerdict } from '../../game/judge';
import { chordEvidence, foldSemitones, guitarJudge, pitchMatches, type GuitarStatus } from './guitarJudge';

const mapOf = (name: string): TabMap =>
  buildPlayableMap(convertTex(name).arrangements[0], { kind: 'synth', speed: 1, leadInMs: 0 }, { mode: 'max' });

function judgeFor(map: TabMap, patch: { a4Hz?: number; strictness?: Strictness; finalizeDelayMs?: number } = {}) {
  const statuses: Array<[number, GuitarStatus]> = [];
  const told: Array<[number, GuitarStatus, JudgeVerdict | undefined]> = [];
  const j = guitarJudge(
    { map, difficulty: 'medium' },
    {
      toClock: (ms) => ms / 1000, a4Hz: patch.a4Hz ?? 440, strictness: patch.strictness ?? 'normal', finalizeDelayMs: patch.finalizeDelayMs,
      onStatus: (i, s, v) => {
        statuses.push([i, s]);
        told.push([i, s, v]);
      },
    },
  );
  j.onBegin(0);
  map.notes.forEach((_, i) => j.reset(i, 0));
  statuses.length = 0;
  told.length = 0;
  /** Атака в t и высота midi каждые 10 мс с t + 20 по t + 140 (кадры — по порядку времени). */
  const play = (t: number, midi: number, clarity = 0.9) => {
    j.onFrame({ atMs: t, midi: NaN, clarity: 0, levelDb: -20, onset: true }, t);
    if (Number.isFinite(midi)) for (let d = 20; d <= 140; d += 10) j.onFrame({ atMs: t + d, midi, clarity, levelDb: -20, onset: false }, t + d);
  };
  const pitchOnly = (from: number, to: number, midi: number) => {
    for (let t = from; t <= to; t += 10) j.onFrame({ atMs: t, midi, clarity: 0.9, levelDb: -20, onset: false }, t);
  };
  const finalize = () => map.notes.map((_, i) => j.finalize(i));
  return { j, statuses, told, play, pitchOnly, finalize };
}

describe('высота', () => {
  it('сведение в октаву и допуски: октава, полутон, бенд вверх', () => {
    expect(foldSemitones(12.3)).toBeCloseTo(0.3);
    expect(foldSemitones(-11.8)).toBeCloseTo(0.2);
    expect(pitchMatches(64.4, [64], false)).toBe(true);
    expect(pitchMatches(52.1, [64], false)).toBe(true); // октава ниже — ошибка YIN, засчитываем
    expect(pitchMatches(65, [64], false)).toBe(false);
    expect(pitchMatches(66, [64], true)).toBe(true); // бенд на тон
    expect(pitchMatches(63, [64], true)).toBe(false);
  });
});

describe('одиночные ноты', () => {
  const map = mapOf('single-notes');
  const midis = map.notes.map((e) => e.notes[0].midi);

  it('карта фикстуры: 7 событий удара, четверти и восьмые при 120 BPM', () => {
    expect(map.notes.map((e) => [e.startMs, e.judge])).toEqual([
      [0, 'attack'], [500, 'attack'], [1000, 'attack'], [1500, 'attack'], [2000, 'attack'], [2250, 'attack'], [2500, 'attack'],
    ]);
  });

  it('точно в такт и в ноту — perfect; отклик дорожке: удар, затем попадание — до закрытия события, без повтора', () => {
    const { play, finalize, statuses } = judgeFor(map);
    map.notes.forEach((e, i) => play(e.startMs + 10, midis[i]));
    expect(statuses.slice(0, 4)).toEqual([[0, 'attacked'], [0, 'hit'], [1, 'attacked'], [1, 'hit']]);
    const v = finalize();
    expect(v.map((x) => [x.judgement, x.kind, x.hitRatio])).toEqual(map.notes.map(() => ['perfect', 'hit', 1]));
    expect(statuses.filter(([, s]) => s === 'hit')).toHaveLength(7);
  });

  it('ранний отклик: попадание — по трём кадрам высоты (≈ 40 мс после удара), со смещением', () => {
    const { j, told } = judgeFor(map);
    const at = 500 + 70;
    j.onFrame({ atMs: at, midi: NaN, clarity: 0, levelDb: -20, onset: true }, at);
    // +10 — раньше окна высоты (+20), +20 и +30 — ещё не ясно
    for (const d of [10, 20, 30]) j.onFrame({ atMs: at + d, midi: midis[1], clarity: 0.9, levelDb: -20, onset: false }, at + d);
    expect(told.map(([i, s]) => [i, s])).toEqual([[1, 'attacked']]);
    j.onFrame({ atMs: at + 40, midi: midis[1], clarity: 0.9, levelDb: -20, onset: false }, at + 40);
    expect(told.at(-1)).toEqual([1, 'late', expect.objectContaining({ kind: 'late', offsetMs: 70 })]);
  });

  it('ранний отклик: не та нота — когда окно высоты прошло, с услышанной высотой', () => {
    const { j, play, told } = judgeFor(map);
    play(1000, midis[2] + 2);
    expect(told.map(([, s]) => s)).toEqual(['attacked']);
    j.onFrame({ atMs: 1160, midi: NaN, clarity: 0, levelDb: -60, onset: false }, 1160);
    expect(told.at(-1)).toEqual([2, 'wrong', expect.objectContaining({ heardMidi: midis[2] + 2 })]);
  });

  it('ранний отклик: промах — по часам, когда окно прошло с запасом на доставку; до начала игры — нет', () => {
    const { j, told, play } = judgeFor(map, { finalizeDelayMs: 200 });
    j.onBegin(400);
    play(1000, midis[2]);
    j.onTick!(500 + 150 + 199, 1);
    expect(told.filter(([, s]) => s === 'missed')).toEqual([]);
    j.onTick!(500 + 150 + 201, 1);
    expect(told.filter(([, s]) => s === 'missed').map(([i]) => i)).toEqual([1]); // событие 0 — до точки старта
    j.onTick!(1000 + 150 + 201, 1);
    expect(told.filter(([, s]) => s === 'missed').map(([i]) => i)).toEqual([1]); // 2 — сыграно
  });

  it('ранний отклик: ложный низ атаки не мешает — попадание по трём нужным кадрам подряд', () => {
    const { j, told } = judgeFor(map);
    j.onFrame({ atMs: 1500, midi: NaN, clarity: 0, levelDb: -20, onset: true }, 1500);
    const seq = [midis[3], midis[3], midis[3] - 19, midis[3] - 19, midis[3], midis[3]];
    seq.forEach((m, k) => j.onFrame({ atMs: 1525 + k * 5, midi: m, clarity: 0.7, levelDb: -20, onset: false }, 1525 + k * 5));
    expect(told.map(([, s]) => s)).toEqual(['attacked']);
    j.onFrame({ atMs: 1555, midi: midis[3], clarity: 0.9, levelDb: -20, onset: false }, 1555);
    expect(told.at(-1)?.[1]).toBe('hit');
  });

  it('поздняя атака не затирает показанное попадание; перемотка сбрасывает и пропущенные', () => {
    const { j, told, pitchOnly, statuses } = judgeFor(map);
    pitchOnly(1490, 1530, midis[3]); // попадание по смене высоты, без атаки
    expect(told.at(-1)?.[1]).toBe('hit');
    j.onFrame({ atMs: 1560, midi: NaN, clarity: 0, levelDb: -20, onset: true }, 1560);
    expect(told.at(-1)?.[1]).toBe('hit');
    expect(j.reset(3, 2000)).toBe('skipped');
    expect(statuses.at(-1)).toEqual([3, 'none']);
  });

  it('сыграно во время ожидания (режим обучения) — попадание вовремя, кадры после него не пересчитывают', () => {
    const { j, told, finalize } = judgeFor(map);
    j.markHeld(2);
    expect(told.at(-1)).toEqual([2, 'hit', expect.objectContaining({ offsetMs: 0 })]);
    for (let d = 20; d <= 160; d += 10) j.onFrame({ atMs: 1000 + d, midi: midis[2] + 3, clarity: 0.9, levelDb: -20, onset: false }, 1000 + d);
    expect(finalize()[2]).toMatchObject({ judgement: 'perfect', kind: 'hit' });
  });

  it('кадры без высоты не портят медиану; редкие чужие кадры — не «не та нота»', () => {
    const { j, finalize } = judgeFor(map);
    j.onFrame({ atMs: 0, midi: NaN, clarity: 0, levelDb: -20, onset: true }, 0);
    for (let d = 20; d <= 140; d += 10) {
      const clear = d % 30 === 0;
      j.onFrame({ atMs: d, midi: clear ? midis[0] : NaN, clarity: clear ? 0.9 : 0.1, levelDb: -20, onset: false }, d);
    }
    j.onFrame({ atMs: 500, midi: NaN, clarity: 0, levelDb: -20, onset: true }, 500);
    for (const d of [40, 80]) j.onFrame({ atMs: 500 + d, midi: midis[1] - 7, clarity: 0.6, levelDb: -20, onset: false }, 500 + d);
    const v = finalize();
    expect(v[0]).toMatchObject({ judgement: 'perfect', kind: 'hit', hitRatio: 1 });
    expect(v[1]).toMatchObject({ judgement: 'good', kind: 'hit', hitRatio: 0.7 });
  });

  it('раньше и позже «точно» — good с early/late и смещением; вне окна — промах', () => {
    const { play, finalize } = judgeFor(map);
    play(0 - 80, midis[0]);
    play(500 + 120, midis[1]);
    play(1000 + 300, midis[2]); // за окном (late 150) третьей и до окна четвёртой (1500 − 110)
    const v = finalize();
    expect([v[0].judgement, v[0].kind, v[0].offsetMs]).toEqual(['good', 'early', -80]);
    expect([v[1].judgement, v[1].kind, v[1].offsetMs]).toEqual(['good', 'late', 120]);
    expect(v[0].hitRatio).toBe(0.8);
    expect(v[2].kind).toBe('missed');
    expect(v[3].kind).toBe('missed');
  });

  it('не та нота — wrong с услышанной высотой; ошибка октавы — попадание', () => {
    const { play, finalize } = judgeFor(map);
    play(0, midis[0] + 2);
    play(500, midis[1] + 12);
    play(1000, midis[2] - 12);
    const v = finalize();
    expect([v[0].judgement, v[0].kind, v[0].heardMidi]).toEqual(['miss', 'wrong', midis[0] + 2]);
    expect([v[1].kind, v[2].kind]).toEqual(['hit', 'hit']);
  });

  it('удар без внятной высоты (приглушённый) — засчитан с долей 0.7; низкая чистота высоты не считается', () => {
    const { play, finalize } = judgeFor(map);
    play(0, NaN);
    play(500, midis[1] + 3, 0.3); // высота есть, но мутная — как будто её нет
    const v = finalize();
    expect([v[0].judgement, v[0].hitRatio, v[1].judgement, v[1].hitRatio]).toEqual(['good', 0.7, 'good', 0.7]);
  });

  it('восьмые подряд (250 мс): каждая атака — своему событию', () => {
    const { play, finalize } = judgeFor(map);
    play(2000 + 5, midis[4]);
    play(2250 + 5, midis[5]);
    play(2500 + 5, midis[6]);
    const v = finalize();
    expect(v.slice(4).map((x) => x.kind)).toEqual(['hit', 'hit', 'hit']);
  });

  it('эталон A4 = 446 Гц: высота на 0.23 полутона выше — та же нота', () => {
    const shift = 12 * Math.log2(446 / 440);
    const { play, finalize } = judgeFor(map, { a4Hz: 446 });
    play(0, midis[0] + shift + 0.5);
    play(500, midis[1] + shift);
    const v = finalize();
    expect(v[0].kind).toBe('hit'); // 0.5 после поправки — в допуске 0.6
    expect(v[1].kind).toBe('hit');
  });

  it('строгий режим: окна уже — 125 мс позже уже за окном', () => {
    const normal = judgeFor(map);
    normal.play(500 + 125, midis[1]);
    expect(normal.finalize()[1].kind).toBe('late');
    const strict = judgeFor(map, { strictness: 'strict' });
    strict.play(500 + 125, midis[1]);
    expect(strict.finalize()[1].kind).toBe('missed');
  });

  it('перемотка: события до точки — пропуск, после — заново (дорожке — «снова ждёт»)', () => {
    const { j, play, statuses } = judgeFor(map);
    play(0, midis[0]);
    expect(j.reset(0, 1200)).toBe('skipped');
    expect(j.reset(3, 1200)).toBe('armed');
    expect(statuses.at(-1)).toEqual([3, 'none']);
    j.onBegin(1200);
    play(1500, midis[3]);
    expect(j.finalize(3).kind).toBe('hit');
  });
});

describe('легато и аккорды', () => {
  it('хаммер: атаки нет, высота сменилась на нужную в окне — попадание', () => {
    const map = mapOf('techniques');
    const i = map.notes.findIndex((e) => e.judge === 'legato');
    expect(i).toBeGreaterThan(0);
    const e = map.notes[i];
    const { play, pitchOnly, j } = judgeFor(map);
    const prev = map.notes[i - 1];
    play(prev.startMs, prev.notes[0].midi);
    pitchOnly(e.startMs, e.startMs + 120, e.notes[0].midi);
    expect(j.finalize(i)).toMatchObject({ judgement: 'perfect', kind: 'hit' });
    expect(j.finalize(i - 1).kind).toBe('hit');
  });

  it('аккорд: удар без высоты — с долей 0.5; звуки аккорда мутно и вразнобой — попадание; чужая высота — не та', () => {
    const map = mapOf('chords');
    const [e0, e1, e2] = map.notes;
    expect(e0.notes).toHaveLength(6);
    const { play, finalize, j } = judgeFor(map);
    // струм: YIN прыгает между звуками, ясность низкая
    j.onFrame({ atMs: e0.startMs, midi: NaN, clarity: 0, levelDb: -20, onset: true }, e0.startMs);
    e0.notes.slice(0, 4).forEach((n, k) => j.onFrame({ atMs: e0.startMs + 30 + k * 20, midi: n.midi, clarity: 0.6, levelDb: -20, onset: false }, e0.startMs + 30 + k * 20));
    play(e1.startMs, NaN);
    play(e2.startMs, e2.notes[0].midi + 1, 0.6);
    const v = finalize();
    expect([v[0].kind, v[0].hitRatio, v[1].kind, v[1].hitRatio, v[2].kind]).toEqual(['hit', 1, 'hit', 0.5, 'wrong']);
  });

  it('аккорд: одна чистая нота — даже звук аккорда — «не та нота»; отклик — не по удару, а по концу окна высоты', () => {
    const map = mapOf('chords');
    const [e0] = map.notes;
    const { play, told, finalize, j } = judgeFor(map);
    play(e0.startMs, e0.notes[2].midi, 0.95); // чисто и ровно одна нота аккорда
    expect(told.map(([, st]) => st)).toEqual(['attacked']);
    j.onFrame({ atMs: e0.startMs + 160, midi: NaN, clarity: 0, levelDb: -60, onset: false }, e0.startMs + 160);
    expect(told.at(-1)).toEqual([0, 'wrong', expect.objectContaining({ heardMidi: e0.notes[2].midi })]);
    expect(finalize()[0].kind).toBe('wrong');
  });

  it('пауэр-корд (два класса высоты) — чистая нижняя нота засчитана: по ясности его от ноты не отличить', () => {
    const v = chordEvidence([40, 40, 40, 40, 40, 40], [0.95, 0.95, 0.95, 0.95, 0.95, 0.95], [40, 47, 52], false);
    expect(v).toEqual({ kind: 'hit', ratio: 1 });
    expect(chordEvidence([52, 52, 52, 52, 52], [0.95, 0.95, 0.95, 0.95, 0.95], [40, 44, 47, 52], false).kind).toBe('wrong');
  });
});
