// Свойства любой играбельной карты (01-architecture.md §3.4; приёмка этапа 11): возвращает список нарушений, пустой —
// карта годна. Проверяет: такты строго растут и стыкуются, последний не дальше конца; секции сплошные и из целых тактов;
// формы руки упорядочены; каждый chordId разрешается; каждое событие внутри своего такта; события по startMs.
import type { TabMap } from './types';

// Мс считаются одной функцией от тиков, поэтому стыки совпадают точно; допуск — только на сложение с плавающей точкой.
const EPS = 1e-6;

export function checkTabMap(map: TabMap): string[] {
  const out: string[] = [];
  const { bars, sections, handShapes, notes, chords } = map;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!(b.endMs > b.startMs)) out.push(`bars[${i}]: endMs ${b.endMs} ≤ startMs ${b.startMs}`);
    if (i > 0 && !(b.startMs > bars[i - 1].startMs)) out.push(`bars[${i}]: startMs ${b.startMs} не растёт`);
    if (i + 1 < bars.length && Math.abs(b.endMs - bars[i + 1].startMs) > EPS)
      out.push(`bars[${i}]: endMs ${b.endMs} ≠ startMs следующего ${bars[i + 1].startMs}`);
  }
  const last = bars.at(-1);
  if (last && last.endMs > map.durationMs + EPS) out.push(`bars: последний endMs ${last.endMs} > durationMs ${map.durationMs}`);

  const barEdges = new Set<number>();
  for (const b of bars) barEdges.add(b.startMs).add(b.endMs);
  const onEdge = (ms: number) => barEdges.has(ms) || bars.some((b) => Math.abs(b.startMs - ms) <= EPS || Math.abs(b.endMs - ms) <= EPS);
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!(s.endMs > s.startMs)) out.push(`sections[${i}] «${s.name}»: пустая или обратная`);
    if (i + 1 < sections.length && Math.abs(s.endMs - sections[i + 1].startMs) > EPS)
      out.push(`sections[${i}] «${s.name}»: не стыкуется со следующей (${s.endMs} ≠ ${sections[i + 1].startMs})`);
    if (!onEdge(s.startMs) || !onEdge(s.endMs)) out.push(`sections[${i}] «${s.name}»: границы не на границах тактов`);
  }

  const chordIds = new Set(chords.map((c) => c.id));
  for (let i = 0; i < handShapes.length; i++) {
    const h = handShapes[i];
    if (!(h.startMs <= h.endMs)) out.push(`handShapes[${i}]: startMs > endMs`);
    if (i > 0 && h.startMs < handShapes[i - 1].startMs) out.push(`handShapes[${i}]: не по порядку`);
    if (!chordIds.has(h.chordId)) out.push(`handShapes[${i}]: chordId ${h.chordId} нет в chords`);
  }
  const shapeIds = new Set(handShapes.map((h) => h.id));

  // Такт события ищется по (bar, occ, item); у повторённого такта — свой проход occ.
  const barOf = new Map(bars.map((b) => [`${b.item}:${b.index}:${b.occ}`, b]));
  for (let i = 0; i < notes.length; i++) {
    const e = notes[i];
    if (i > 0 && e.startMs < notes[i - 1].startMs) out.push(`notes[${i}]: startMs ${e.startMs} меньше предыдущего`);
    if (e.chordId !== undefined && !chordIds.has(e.chordId)) out.push(`notes[${i}]: chordId ${e.chordId} нет в chords`);
    if (e.handShapeId !== undefined && !shapeIds.has(e.handShapeId)) out.push(`notes[${i}]: handShapeId ${e.handShapeId} нет в handShapes`);
    const bar = barOf.get(`${e.item}:${e.bar}:${e.occ}`);
    if (!bar) out.push(`notes[${i}]: такта (${e.bar}, ${e.occ}) нет в bars`);
    else if (e.startMs < bar.startMs - EPS || e.startMs >= bar.endMs - EPS)
      out.push(`notes[${i}]: startMs ${e.startMs} вне такта (${e.bar}, ${e.occ}) [${bar.startMs}, ${bar.endMs})`);
    if (!e.notes.length) out.push(`notes[${i}]: событие без нот`);
  }
  return out;
}
