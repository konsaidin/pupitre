// Гитарный судья на картах своих фикстур (импорт alphaTex → играбельная карта) и синтетических кадрах: попадания, рано и
// поздно, вне окна, не та нота, ошибка октавы, удар без высоты, восьмые подряд, легато без атаки, аккорд, эталон A4,
// строгость, отклик дорожке, перемотка.
import { describe, expect, it } from 'vitest';
import { convertTex } from '../import/fixtures';
import { buildPlayableMap } from '../model/playable';
import type { Strictness, TabMap } from '../model/types';
import { foldSemitones, guitarJudge, pitchMatches, type GuitarStatus } from './guitarJudge';

const mapOf = (name: string): TabMap =>
  buildPlayableMap(convertTex(name).arrangements[0], { kind: 'synth', speed: 1, leadInMs: 0 }, { mode: 'max' });

function judgeFor(map: TabMap, patch: { a4Hz?: number; strictness?: Strictness } = {}) {
  const statuses: Array<[number, GuitarStatus]> = [];
  const j = guitarJudge(
    { map, difficulty: 'medium' },
    { toClock: (ms) => ms / 1000, a4Hz: patch.a4Hz ?? 440, strictness: patch.strictness ?? 'normal', onStatus: (i, s) => statuses.push([i, s]) },
  );
  j.onBegin(0);
  map.notes.forEach((_, i) => j.reset(i, 0));
  statuses.length = 0;
  /** Атака в t и высота midi каждые 10 мс с t + 20 по t + 140 (кадры — по порядку времени). */
  const play = (t: number, midi: number, clarity = 0.9) => {
    j.onFrame({ atMs: t, midi: NaN, clarity: 0, levelDb: -20, onset: true }, t);
    if (Number.isFinite(midi)) for (let d = 20; d <= 140; d += 10) j.onFrame({ atMs: t + d, midi, clarity, levelDb: -20, onset: false }, t + d);
  };
  const pitchOnly = (from: number, to: number, midi: number) => {
    for (let t = from; t <= to; t += 10) j.onFrame({ atMs: t, midi, clarity: 0.9, levelDb: -20, onset: false }, t);
  };
  const finalize = () => map.notes.map((_, i) => j.finalize(i));
  return { j, statuses, play, pitchOnly, finalize };
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

  it('точно в такт и в ноту — perfect; отклик дорожке: удар, затем вердикт', () => {
    const { play, finalize, statuses } = judgeFor(map);
    map.notes.forEach((e, i) => play(e.startMs + 10, midis[i]));
    const v = finalize();
    expect(v.map((x) => [x.judgement, x.kind, x.hitRatio])).toEqual(map.notes.map(() => ['perfect', 'hit', 1]));
    expect(statuses.slice(0, 2)).toEqual([[0, 'attacked'], [1, 'attacked']]);
    expect(statuses.filter(([, s]) => s === 'hit')).toHaveLength(7);
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

  it('аккорд: удар и одна высота из аккорда — попадание; удар без высоты — засчитан; чужая высота — не та', () => {
    const map = mapOf('chords');
    const [e0, e1, e2] = map.notes;
    expect(e0.notes).toHaveLength(6);
    const { play, finalize } = judgeFor(map);
    play(e0.startMs, e0.notes[0].midi); // бас
    play(e1.startMs, NaN);
    play(e2.startMs, e2.notes[0].midi + 1);
    const v = finalize();
    expect([v[0].kind, v[1].kind, v[1].hitRatio, v[2].kind]).toEqual(['hit', 'hit', 0.7, 'wrong']);
  });
});
