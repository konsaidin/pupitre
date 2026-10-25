// Импорт → аранжировка (этап 6b) на своих alphaTex-фикстурах: старты ±1 мс к ручному расчёту; струны, лады, капо,
// строи; порядок (такт, проход) при повторах и D.S. al Coda; путь GP7-байтов совпадает с alphaTex; реестр R-tech N/N;
// перенос правок аппликатуры.
import { describe, expect, it } from 'vitest';
import { tempoMapOf, tickToMs } from '../model/tempo';
import type { GuitarArrangement } from '../model/types';
import { FIXTURES, converterNotes, convertBytes, convertTex, gp7Bytes } from './fixtures';
import { NOTE_FIELDS, techsOf } from './toArrangement';
import { transferUserEdits } from './userEdits';

const only = (name: string): GuitarArrangement => {
  const { arrangements } = convertTex(name);
  expect(arrangements).toHaveLength(1);
  return arrangements[0];
};
const msOf = (a: GuitarArrangement) => {
  const tempo = tempoMapOf(a.timeline.tempos);
  return a.events.map((e) => tickToMs(tempo, e.tick));
};
const notesOf = (a: GuitarArrangement) => a.events.flatMap((e) => e.notes.map((n) => [e.tick, n.string, n.fret, n.midi]));

describe('старты к ручному расчёту (±1 мс)', () => {
  it('смены темпа 120 → 60 → 180 BPM, четверти', () => {
    const want = [0, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 6333.33, 6666.67, 7000];
    msOf(only('tempo-changes')).forEach((ms, i) => expect(Math.abs(ms - want[i])).toBeLessThanOrEqual(1));
  });

  it('одиночные ноты: четверти и восьмые при 120 BPM; нотная длительность и сустейн', () => {
    const a = only('single-notes');
    msOf(a).forEach((ms, i) => expect(Math.abs(ms - [0, 500, 1000, 1500, 2000, 2250, 2500][i])).toBeLessThanOrEqual(1));
    expect(a.events.map((e) => e.notes[0].durTicks)).toEqual([960, 960, 960, 960, 480, 480, 960]);
    // сустейн — только у нот от 0.4 с: четверть (0.5 с) — да, восьмая (0.25 с) — нет
    expect(a.events.map((e) => e.notes[0].sustainTicks)).toEqual([960, 960, 960, 960, 0, 0, 960]);
  });

  it('лиги слиты в исходную ноту: половинная + четверть, затем лига через такт', () => {
    const a = only('ties');
    expect(a.events.map((e) => [e.tick, e.notes[0].durTicks])).toEqual([[0, 2880], [2880, 960 + 3840]]);
  });

  it('форшлаг до первой доли — отрицательный тик и предупреждение grace-shift', () => {
    const c = convertTex('grace');
    expect(c.arrangements[0].events[0].tick).toBeLessThan(0);
    expect(c.arrangements[0].events[0].notes[0].techs).toContain('grace');
    expect(c.arrangements[0].timeline.synthShiftTicks).toBeGreaterThan(0);
    expect(c.warnings.map((w) => w.code)).toContain('grace-shift');
  });
});

describe('струны, лады, капо, строи', () => {
  it('струна 0 — нижняя; MIDI открытых струн от нижней', () => {
    const a = only('single-notes');
    expect(a.tuning).toEqual({ openMidi: [40, 45, 50, 55, 59, 64], name: 'E Standard', offsets: [0, 0, 0, 0, 0, 0] });
    expect(notesOf(a)[0]).toEqual([0, 0, 3, 43]);
    expect(a.instrument).toBe('guitar');
  });

  it('капо 2: лады абсолютные (подняты на капо), открытая остаётся 0 и звучит от капо', () => {
    const a = only('capo2');
    expect(a.capo).toBe(2);
    expect(notesOf(a)).toEqual([[0, 0, 0, 42], [960, 0, 5, 45], [1920, 3, 0, 57], [1920, 4, 3, 62], [1920, 5, 0, 66], [2880, 2, 4, 54]]);
  });

  it('Drop D, бас-5, 7-струнная: строй, инструмент, роль', () => {
    const drop = only('drop-d');
    expect(drop.tuning).toEqual({ openMidi: [38, 45, 50, 55, 59, 64], name: 'Drop D', offsets: [-2, 0, 0, 0, 0, 0] });
    expect([drop.instrument, drop.role]).toEqual(['guitar', 'rhythm']);
    const bass = only('bass5');
    expect([bass.instrument, bass.role, bass.strings, bass.tuning.openMidi]).toEqual(['bass', 'bass', 5, [23, 28, 33, 38, 43]]);
    const seven = only('seven-string');
    expect([seven.instrument, seven.role, seven.strings, seven.tuning.openMidi]).toEqual(['guitar', 'lead', 7, [35, 40, 45, 50, 55, 59, 64]]);
  });

  it('аккорды: kind, шаблоны без повторов, формы руки, повтор аккорда подряд', () => {
    const a = only('chords');
    expect(a.events.map((e) => e.kind)).toEqual(['chord', 'chord', 'chord', 'doublestop', 'doublestop', 'chord']);
    expect(a.events[1].repeatOfPrev).toBe(true);
    expect(a.events[0].repeatOfPrev).toBeUndefined();
    // одинаковые аккорды — один шаблон
    expect(a.events[0].chordId).toBe(a.events[1].chordId);
    expect(a.chords[a.events[0].chordId!].frets).toEqual([0, 2, 2, 1, 0, 0]);
    expect(a.properties.chordCount).toBe(a.chords.length);
    for (const e of a.events) if (e.handShapeId !== undefined) expect(a.handShapes[e.handShapeId].chordId).toBeLessThan(a.chords.length);
  });
});

describe('направления слайдов и рычаг', () => {
  it('slideIn снизу, slideOut вверх, кривая рычага — в модели', () => {
    const notes = only('techniques').events.flatMap((ev) => ev.notes);
    expect(notes.find((n) => n.techs.includes('slideIn'))?.slideInFrom).toBe('below');
    expect(notes.find((n) => n.techs.includes('slideOut'))?.slideOutTo).toBe('up');
    const bar = notes.find((n) => n.techs.includes('whammy'));
    expect(bar?.whammy?.some((p) => p.cents < 0)).toBe(true);
  });
});

describe('порядок исполнения', () => {
  it('повтор, вольты и D.S. al Coda — порядок tickLookup alphaTab: после сеньо — обе вольты, затем кода', () => {
    const a = only('repeats-ds');
    const bars = a.timeline.bars.map((b) => `${b.index}.${b.occ}`);
    expect(bars).toEqual(['0.0', '1.0', '2.0', '1.1', '3.0', '4.0', '0.1', '1.2', '2.1', '3.1', '5.0']);
    // события идут теми же проходами и лежат внутри своих тактов
    const byBar = new Map(a.timeline.bars.map((b) => [`${b.index}.${b.occ}`, b]));
    let last = -Infinity;
    for (const e of a.events) {
      const bar = byBar.get(`${e.bar}.${e.occ}`)!;
      expect(e.tick >= bar.fromTick && e.tick < bar.toTick).toBe(true);
      expect(e.tick).toBeGreaterThan(last);
      last = e.tick;
    }
    expect(a.sections.map((s) => s.name)).toEqual(['Intro', 'Intro', 'Coda']);
  });
});

describe('путь GP7-байтов', () => {
  for (const name of FIXTURES) {
    it(`${name}: те же события, строй, капо и таймлайн, что у alphaTex`, () => {
      const fromTex = convertTex(name).arrangements;
      const fromGp = convertBytes(gp7Bytes(name)).arrangements;
      const pick = (a: GuitarArrangement) => ({ events: a.events, tuning: a.tuning, capo: a.capo, timeline: a.timeline, chords: a.chords, strings: a.strings });
      expect(fromGp.map(pick)).toEqual(fromTex.map(pick));
    });
  }
});

describe('реестр R-tech', () => {
  it('каждое поле ноты конвертера на всех фикстурах — техника, поле модели или «не судится»: N/N, 0 немаркированных', () => {
    const seen = new Set(FIXTURES.flatMap((name) => converterNotes(name).flatMap((n) => Object.keys(n))));
    const unmarked = [...seen].filter((key) => !Object.hasOwn(NOTE_FIELDS, key));
    expect(unmarked).toEqual([]);
    expect(seen.size).toBeGreaterThan(40);
  });

  it('каждое правило-техника срабатывает на фикстуре техник (кроме полей, которые alphaTab-конвертер не пишет)', () => {
    const notes = FIXTURES.flatMap(converterNotes);
    const silent = Object.entries(NOTE_FIELDS)
      .filter(([, rule]) => 'tech' in rule)
      .filter(([field, rule]) => 'tech' in rule && !notes.some((n) => rule.tech(n).length) && field !== 'slideUnpitchTo')
      .map(([field]) => field);
    expect(silent).toEqual([]);
    expect(new Set(notes.flatMap(techsOf)).size).toBeGreaterThanOrEqual(26);
  });
});

describe('transferUserEdits', () => {
  const a = only('single-notes');
  const withEdits: GuitarArrangement = {
    ...a,
    userEdits: { fingering: { [`${a.events[2].tick}:${a.events[2].notes[0].midi}`]: { string: 1, fret: 2 }, '99999:61': { string: 0, fret: 9 } } },
  };

  it('правка переживает сдвиг событий на 6 тиков; правка удалённой ноты — неперенесённая', () => {
    const shifted: GuitarArrangement = { ...a, events: a.events.map((e) => ({ ...e, tick: e.tick + 6 })) };
    const r = transferUserEdits(withEdits, shifted);
    expect(r.moved).toBe(1);
    expect(r.unmatched).toBe(1);
    expect(r.arrangement.userEdits?.fingering).toEqual({ [`${a.events[2].tick + 6}:${a.events[2].notes[0].midi}`]: { string: 1, fret: 2 } });
    expect(r.warning).toEqual({ code: 'user-edits-unmatched', detail: expect.any(String), count: 1 });
  });

  it('сдвиг больше 10 тиков — правка не переносится', () => {
    const far: GuitarArrangement = { ...a, events: a.events.map((e) => ({ ...e, tick: e.tick + 11 })) };
    expect(transferUserEdits(withEdits, far).unmatched).toBe(2);
  });
});
