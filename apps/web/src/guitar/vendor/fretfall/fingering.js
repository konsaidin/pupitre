// Hand positions and fingers for charts that don't say. One finger per fret: the index finger rests on the
// position fret and fingers 1-4 cover four frets. Over the whole song, pick positions that keep shifts few
// and short (dynamic programming over the groups of notes played together). No DOM, see fingering.test.mjs.

const SPAN = 4;

export const fingerFor = (fret, position) => Math.min(4, Math.max(1, fret - position + 1));

// notes: sorted by time, { time, sustain, fret }. Returns { anchors: [{ time, endTime, fret, width }], fingers: Map(note → 1..4) }
export function suggestPositions(notes) {
  const groups = [];
  for (const note of notes) {
    if (note.fret <= 0) continue; // open strings don't pin the hand
    const last = groups.at(-1);
    if (last && note.time - last.time < 0.005) last.notes.push(note);
    else groups.push({ time: note.time, notes: [note] });
  }
  if (!groups.length) return { anchors: [], fingers: new Map() };

  for (const group of groups) {
    const frets = group.notes.map((n) => n.fret);
    group.low = Math.min(...frets);
    group.high = Math.max(...frets);
    group.end = Math.max(...group.notes.map((n) => n.time + n.sustain));
    const from = Math.max(1, group.high - SPAN + 1);
    group.options = from <= group.low ? Array.from({ length: group.low - from + 1 }, (_, i) => from + i) : [group.low]; // wider than the hand: stretch from the lowest
  }

  const prefer = (group, p) => 0.1 * (group.low - p); // index finger on the lowest note when it fits
  let cost = new Map(groups[0].options.map((p) => [p, prefer(groups[0], p)]));
  const cameFrom = [null];
  for (let i = 1; i < groups.length; i++) {
    const group = groups[i], restful = group.time - groups[i - 1].end > 0.4; // shifting during a rest is easy
    const next = new Map(), from = new Map();
    for (const p of group.options) {
      let best = Infinity, via = null;
      for (const [q, c] of cost) {
        const shift = Math.abs(p - q), total = c + (shift ? (1 + 0.3 * shift) * (restful ? 0.5 : 1) : 0);
        if (total < best) [best, via] = [total, q];
      }
      next.set(p, best + prefer(group, p));
      from.set(p, via);
    }
    cost = next;
    cameFrom.push(from);
  }

  let p = [...cost].reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  for (let i = groups.length - 1; i >= 0; i--) {
    groups[i].position = p;
    p = cameFrom[i]?.get(p);
  }

  const fingers = new Map(), anchors = [];
  for (const group of groups) {
    for (const note of group.notes) fingers.set(note, fingerFor(note.fret, group.position));
    const width = Math.max(SPAN, group.high - group.position + 1), last = anchors.at(-1);
    if (last?.fret === group.position) last.width = Math.max(last.width, width);
    else anchors.push({ time: group.time, endTime: Infinity, fret: group.position, width });
  }
  anchors.forEach((a, i) => (a.endTime = anchors[i + 1]?.time ?? groups.at(-1).end));
  return { anchors, fingers };
}
