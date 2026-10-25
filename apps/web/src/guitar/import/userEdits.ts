// Перенос правок пользователя при пере-разборе (§3.1): аппликатура ключуется `${tick}:${midi}`, а не индексами событий —
// сегментация при пере-разборе меняется. Правка переходит на ноту той же высоты с |Δtick| ≤ 10 (ближайшую);
// неперенесённые считаются и попадают в предупреждение user-edits-unmatched.
import type { GuitarArrangement, ImportWarning } from '../model/types';

export const EDIT_MATCH_TICKS = 10;
export const editKey = (tick: number, midi: number) => `${tick}:${midi}`;

export interface TransferResult {
  arrangement: GuitarArrangement;
  moved: number;
  unmatched: number;
  warning?: ImportWarning;
}

export function transferUserEdits(old: GuitarArrangement, next: GuitarArrangement): TransferResult {
  const edits = old.userEdits?.fingering;
  if (!edits || !Object.keys(edits).length) return { arrangement: next, moved: 0, unmatched: 0 };
  // Ноты новой аранжировки по высоте: [tick, ...] — ближайшая по времени.
  const byMidi = new Map<number, number[]>();
  for (const e of next.events) for (const n of e.notes) (byMidi.get(n.midi) ?? byMidi.set(n.midi, []).get(n.midi)!).push(e.tick);
  const fingering: Record<string, { string: number; fret: number }> = {};
  let unmatched = 0;
  for (const [key, edit] of Object.entries(edits)) {
    const [tick, midi] = key.split(':').map(Number);
    let best: number | undefined;
    for (const t of byMidi.get(midi) ?? []) if (Math.abs(t - tick) <= EDIT_MATCH_TICKS && (best === undefined || Math.abs(t - tick) < Math.abs(best - tick))) best = t;
    if (best === undefined) unmatched++;
    else fingering[editKey(best, midi)] = edit;
  }
  const moved = Object.keys(fingering).length;
  return {
    arrangement: { ...next, userEdits: { ...next.userEdits, fingering } },
    moved,
    unmatched,
    ...(unmatched
      ? { warning: { code: 'user-edits-unmatched', detail: `правки аппликатуры без пары после пере-разбора`, count: unmatched } }
      : {}),
  };
}
