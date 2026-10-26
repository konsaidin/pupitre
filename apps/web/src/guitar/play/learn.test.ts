// Режим обучения на фикстуре single-notes: игра встаёт на пересечённой несыгранной ноте (не на прыжке перемотки и не
// на уже засчитанной), продолжает после нужной высоты после удара или смены высоты (держать прошлую ноту той же
// высоты — не считается), аккорд — по удару; выключенный режим не ждёт.
import { describe, expect, it } from 'vitest';
import type { GamePhase } from '../../game/engine';
import { convertTex } from '../import/fixtures';
import { buildPlayableMap } from '../model/playable';
import { learnController, type LearnHost } from './learn';

const mapOf = (name: string) => buildPlayableMap(convertTex(name).arrangements[0], { kind: 'synth', speed: 1, leadInMs: 0 }, { mode: 'max' });

function harness(name = 'single-notes', enabled = true) {
  const map = mapOf(name);
  const log: string[] = [];
  const hits = new Set<number>();
  const struck = new Set<number>();
  let now = -100; // после отсчёта: слышимое время до начала песни отрицательное
  let phase: GamePhase = 'playing';
  const host: LearnHost = {
    events: map.notes,
    hit: (i) => hits.has(i),
    attacked: (i) => struck.has(i),
    heardMs: () => now,
    phase: () => phase,
    wait: (at) => {
      phase = 'waiting';
      log.push(`wait ${at}`);
    },
    proceed: () => {
      phase = 'playing';
      log.push('go');
    },
    markHeld: (i) => {
      hits.add(i);
      log.push(`held ${i}`);
    },
    a4Hz: 440,
    enabled: () => enabled,
  };
  const c = learnController(host);
  const to = (ms: number) => {
    for (; now < ms; now = Math.min(ms, now + 15)) c.tick();
    c.tick();
  };
  const pitch = (midi: number, n = 4) => {
    for (let k = 0; k < n; k++) c.onFrame({ atMs: 0, midi, clarity: 0.9, levelDb: -20, onset: false });
  };
  const onset = () => c.onFrame({ atMs: 0, midi: NaN, clarity: 0, levelDb: -20, onset: true });
  return { map, c, log, hits, struck, to, pitch, onset, jump: (ms: number) => { now = ms; c.tick(); }, setPhase: (p: GamePhase) => (phase = p) };
}

describe('режим обучения', () => {
  it('встаёт на несыгранной ноте; удар и нужная высота — дальше; уже сыгранную пропускает', () => {
    const h = harness();
    const midi = h.map.notes.map((e) => e.notes[0].midi);
    h.to(10);
    expect(h.log).toEqual(['wait 0']);
    expect(h.c.waitingFor()).toBe(0);
    h.pitch(midi[0] + 2); // не та нота — ждём
    expect(h.log).toEqual(['wait 0']);
    h.onset();
    h.pitch(midi[0]);
    expect(h.log).toEqual(['wait 0', 'held 0', 'go']);
    h.hits.add(1); // вторую засчитал судья раньше (сыграна чуть заранее)
    h.to(1010);
    expect(h.log.slice(3)).toEqual(['wait 1000']);
  });

  it('держать прошлую ноту той же высоты — не считается; смена высоты (легато) — считается', () => {
    const h = harness();
    const midi = h.map.notes.map((e) => e.notes[0].midi);
    h.to(10);
    h.pitch(midi[0]); // звучит «с прошлого раза», без удара и без смены
    expect(h.c.waitingFor()).toBe(0);
    h.pitch(midi[0] + 5, 2);
    h.pitch(midi[0]); // сменил высоту на нужную
    expect(h.log).toEqual(['wait 0', 'held 0', 'go']);
  });

  it('перемотка (прыжок часов) и выключенный режим — не ждут', () => {
    const h = harness();
    h.to(10);
    h.onset();
    h.pitch(h.map.notes[0].notes[0].midi);
    h.jump(2300); // перемотка вперёд мимо 500…2250
    h.to(2320);
    expect(h.log).toEqual(['wait 0', 'held 0', 'go']);
    const off = harness('single-notes', false);
    off.to(1200);
    expect(off.log).toEqual([]);
  });

  it('сыграл вовремя, судья ещё подтверждает высоту — не встаёт; не подтвердил — встаёт, звучащей ноты хватает', () => {
    const h = harness();
    const midi = h.map.notes[0].notes[0].midi;
    h.struck.add(0);
    h.to(10);
    expect(h.log).toEqual([]);
    h.hits.add(0); // подтвердил через 40 мс
    h.struck.add(1);
    h.to(600);
    expect(h.log).toEqual([]);
    h.to(700); // 180 мс после второй ноты (500), вердикта нет — ждём; удар уже был
    expect(h.log).toEqual(['wait 500']);
    h.pitch(h.map.notes[1].notes[0].midi);
    expect(h.log).toEqual(['wait 500', 'held 1', 'go']);
    expect(midi).toBeGreaterThan(0);
  });

  it('аккорд — по кадрам после удара (одна чистая нота — не аккорд); пауза во время ожидания — снова ждёт после продолжения', () => {
    const h = harness('chords');
    h.to(10);
    expect(h.c.waitingFor()).toBe(0);
    h.setPhase('paused');
    h.c.tick();
    h.setPhase('playing');
    h.c.tick();
    expect(h.c.waitingFor()).toBe(-1);
    h.jump(-50);
    h.to(10);
    expect(h.log).toEqual(['wait 0', 'wait 0']);
    // одна чистая нота аккорда — не аккорд: ждём дальше
    const chord = h.map.notes[0].notes.map((n) => n.midi);
    const frame = (atMs: number, midi: number, clarity: number) => h.c.onFrame({ atMs, midi, clarity, levelDb: -20, onset: false });
    h.c.onFrame({ atMs: 1000, midi: NaN, clarity: 0, levelDb: -20, onset: true });
    for (let t = 1030; t <= 1170; t += 20) frame(t, chord[2], 0.95);
    expect(h.log.at(-1)).toBe('wait 0');
    // струм: звуки аккорда мутно и вразнобой — едем
    h.c.onFrame({ atMs: 2000, midi: NaN, clarity: 0, levelDb: -20, onset: true });
    [0, 1, 2, 3].forEach((k) => frame(2030 + k * 25, chord[k], 0.6));
    frame(2160, NaN, 0);
    expect(h.log.at(-1)).toBe('go');
  });
});
