// Таймлайн в порядке исполнения: повтор с вольтами, D.S. al Coda, смена темпа, форшлаг до первой доли; путь через
// GP7-байты (Gp7Exporter → sniff → parseScore) даёт тот же таймлайн, что alphaTex.
import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { createConverter } from '../vendor/fretfall/fromScore.js';
import { tempoMapOf, tickToMs } from '../model/tempo';
import { parseScore } from './parseScore';
import { sniff } from './sniff';
import { buildTimeline } from './timeline';

const HEAD = '\\track "Guitar"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n';
// Такт 0 — вступление; 1 — начало повтора; 2 — первая вольта и конец повтора ×2; 3 — вторая вольта; 4 — темп 60.
const REPEATS = `\\tempo 120\n${HEAD}\\section "Intro" 0.6.4 0.6.4 0.6.4 0.6.4 | \\ro 3.6.1 | \\ae 1 \\rc 2 5.6.1 | \\ae 2 7.6.1 | \\tempo 60 0.5.1`;
// Сеньо на такте 0, «To Coda» в такте 1, D.S. al Coda в конце такта 2, кода — такт 3.
const DS_AL_CODA = `\\tempo 120\n${HEAD}\\jump segno 0.6.1 | \\jump dacoda 2.6.1 | \\jump dalsegnoalcoda 3.6.1 | \\jump coda 5.6.1`;
const GRACE = `\\tempo 120\n${HEAD}3.6.16 {gr} 0.6.4 0.6.4 0.6.2`;

function timelineOf(tex: string) {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings);
  createConverter(alphaTab).prepareScore(score);
  return buildTimeline(score, settings);
}
const order = (tex: string) => timelineOf(tex).timeline.bars.map((b) => [b.index, b.occ]);

describe('buildTimeline', () => {
  it('повтор с вольтами: 0, 1, 2, 1′, 3, 4 — у прохода свой occ', () => {
    expect(order(REPEATS)).toEqual([[0, 0], [1, 0], [2, 0], [1, 1], [3, 0], [4, 0]]);
  });

  it('тики и мс по ручному расчёту (±1 мс): 120 BPM — 2 с на такт, такт 4 при 60 BPM — 4 с', () => {
    const { timeline, tempo } = timelineOf(REPEATS);
    expect(timeline.bars.map((b) => [b.fromTick, b.toTick])).toEqual([0, 1, 2, 3, 4, 5].map((i) => [i * 3840, (i + 1) * 3840]));
    expect(timeline.bars[0].section).toBe('Intro');
    expect(timeline.durationTicks).toBe(6 * 3840);
    for (const [tick, ms] of [[0, 0], [3840, 2000], [5 * 3840, 10000], [5 * 3840 + 960, 11000], [6 * 3840, 14000]])
      expect(Math.abs(tickToMs(tempo, tick) - ms)).toBeLessThanOrEqual(1);
    // Темпы таймлайна восстанавливают ту же карту.
    expect(tickToMs(tempoMapOf(timeline.tempos), 6 * 3840)).toBeCloseTo(14000, 6);
    expect(timeline.beats).toHaveLength(6 * 4);
    expect(timeline.beats.filter((b) => b.downbeat).map((b) => b.tick)).toEqual(timeline.bars.map((b) => b.fromTick));
    expect(timeline.synthShiftTicks).toBe(0);
  });

  it('D.S. al Coda: 0, 1, 2, сеньо 0′, 1′, кода 3', () => {
    expect(order(DS_AL_CODA)).toEqual([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [3, 0]]);
  });

  it('форшлаг до первой доли сдвигает рендер синта (synthShiftTicks > 0)', () => {
    expect(timelineOf(GRACE).timeline.synthShiftTicks).toBeGreaterThan(0);
  });

  it('путь GP7-байтов даёт тот же таймлайн, что alphaTex', () => {
    const fromTex = timelineOf(REPEATS).timeline;
    const settings = new alphaTab.Settings();
    const bytes = new alphaTab.exporter.Gp7Exporter().export(alphaTab.importer.ScoreLoader.loadAlphaTex(REPEATS, settings), settings);
    const sniffed = sniff(bytes);
    expect(sniffed).toEqual({ ok: true, format: 'gp8' });
    const parsed = parseScore(bytes, 'gp8');
    createConverter(alphaTab).prepareScore(parsed.score);
    expect(buildTimeline(parsed.score, parsed.settings).timeline).toEqual(fromTex);
  });
});
