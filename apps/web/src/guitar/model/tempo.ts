// Темпокарта на оси PerfTick: обёртки над fretfall music.js (tempoMap/tickToMs/msToTick, 960 PPQ). Точки — в порядке
// исполнения (tickLookup alphaTab разворачивает повторы), поэтому tick ↔ мс — взаимно обратные кусочно-линейные функции.
import { msToTick as ffMsToTick, tempoMap, tickToMs as ffTickToMs, type FfTempoPoint } from '../vendor/fretfall/music.js';
import type { PerfTick } from './types';

export type TempoMap = readonly FfTempoPoint[];

/** changes — смены темпа `{tick, bpm}` по возрастанию tick; initialBpm — темп с начала (score.tempo). */
export function buildTempoMap(changes: Iterable<{ tick: PerfTick; bpm: number }>, initialBpm: number): TempoMap {
  const points: { tick: number; tempo: number }[] = [];
  for (const { tick, bpm } of changes) points.push({ tick, tempo: bpm });
  return tempoMap(points, initialBpm);
}

/** Время партитуры (мс от начала, без сдвига синта и скорости). */
export const tickToMs = (map: TempoMap, tick: PerfTick): number => ffTickToMs(map, tick);
export const msToTick = (map: TempoMap, ms: number): PerfTick => ffMsToTick(map, ms);

/** Темпы таймлайна (§3.2 `ScoreTimeline.tempos`) — точки карты без накопленных мс. */
export const temposOf = (map: TempoMap): { tick: PerfTick; bpm: number }[] => map.map((p) => ({ tick: p.tick, bpm: p.tempo }));

/** Обратно из `ScoreTimeline.tempos`: первая точка — темп с начала. */
export function tempoMapOf(tempos: readonly { tick: PerfTick; bpm: number }[]): TempoMap {
  if (!tempos.length) throw Error('Пустая темпокарта');
  const [first, ...rest] = tempos;
  if (first.tick !== 0) throw Error(`Темпокарта начинается с тика ${first.tick}, а не с 0`);
  return buildTempoMap(rest, first.bpm);
}
