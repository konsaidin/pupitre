// Canvas note highway in 3D. A perspective camera looks down the highway from just behind the strike line,
// so the strings there read as a fretboard and notes rise out of the distance. World units are fret widths;
// time runs along z. Drawn in a virtual space 900px tall, scaled to the canvas height.

import { lap } from './perf.js';
import { noteName } from './music.js';

// ПАТЧ Пюпитра (2): статусы событий судьи — arr.status (Uint8Array по индексу ноты в arr.notes); без arr.status — как в апстриме
export const STATUS = { none: 0, attacked: 1, hit: 2, early: 3, late: 4, wrong: 5, missed: 6 };
const HIT_STATUS = new Set([STATUS.hit, STATUS.early, STATUS.late]), MISS_STATUS = new Set([STATUS.wrong, STATUS.missed]);
const MISS_GREY = '#5F6679', MISS_EDGE = '#FF6A76'; // --rp-fg-4 и --rp-bad Рампы
const VH = 900, HIGHWAY = 84, NOTE_SPEED = 28; // fret widths of highway ahead of the strike line; fret widths a note travels per second
const STRING_W = 2.2, LANE_W = 0.9, ANCHOR_LANE_W = 2.4; // px: a string (thinnest wound, see stringWidth), a fret lane, the hand position's

// Seconds of notes in view for the drawing distance and note speed settings: faster notes are further apart and in
// view for less time, a longer drawing distance shows more of them
export const lookAhead = (view) => (HIGHWAY * (view.drawDistance ?? 1)) / (NOTE_SPEED * (view.noteSpeed ?? 1));
const GAP = 0.34, LAST_FRET = 24, PRESS_AHEAD = 1.2; // string spacing; how early a note's spot on the board lights up
const FRET_WIDTH = 1.25, BOARD_HEIGHT = 1.25; // the neck at 100% on the fret width and fretboard height sliders
// Fret widths from the board where arriving notes and frames light up: a distance, not a time, so everything lights
// at the same place on the highway whatever the note speed
const NEAR = 5;
const BEND_LIFT = 1, BEND_RISE = 1.6; // string gaps a bent string rises on the fretboard, and its trail on the highway, per step bent
const BEND_EASE = 2; // fret widths before the board over which the trail's rise settles to the string's
const RAIL = 0.19; // half the width of a bent note's trail
const GEM_DEPTH = 0.12; // how deep 3D notes are: 4 to 5 px at the board
const FRAME_AHEAD = 3, MIN_SPAN = 11; // seconds of hand positions framed ahead; frets in view at the closest zoom, less the fret of slack
const WHOLE_SONG = [{ time: -Infinity, endTime: Infinity, fret: 1, width: 4 }];
const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]; // where a fretboard has position dots
const CAPO_BACK = 0.15; // fret widths behind its fret wire a capo clamps on, where a finger would go
const NUM_W = 0.31, NUM_Z = 1.7; // fret widths across the neck and down the highway a fret number painted on the floor covers
const NUM_TILT = 1.4; // radians from upright past which the floor has turned edge-on: a number is kept to the ends of the neck, and only goes once it is a line, not a digit
const NUM_MIN_PX = 1; // px tall a number must come to on screen: below this it is a smudge, not a digit
const NUM_TALL = 1.2; // how much taller than wide the floor may leave a number before it is painted over less of the highway
const NUM_FLOOR_PX = 18; // px across a number is held to once the highway would paint it smaller: two digits still read at a glance

export const rounded = (u0, u1, v0, v1, round) => { // a rectangle with rounded corners, as points round its outline
  const [ua, ub, va, vb] = [Math.min(u0, u1), Math.max(u0, u1), Math.min(v0, v1), Math.max(v0, v1)], r = Math.min(round, (ub - ua) / 2, (vb - va) / 2);
  const corner = (cu, cv, from) => { // its ends given twice, so a spline through the outline runs straight between corners instead of looping
    const arc = Array.from({ length: 5 }, (_, j) => [cu + Math.cos(from + (j * Math.PI) / 8) * r, cv + Math.sin(from + (j * Math.PI) / 8) * r]);
    return [arc[0], ...arc, arc[4]];
  };
  return [...corner(ub - r, vb - r, 0), ...corner(ua + r, vb - r, Math.PI / 2), ...corner(ua + r, va + r, Math.PI), ...corner(ub - r, va + r, 1.5 * Math.PI)];
};
// Headstocks in front of the nut, named after their classic types rather than any maker, traced from photos of each and drawn
// at about five sixths of their length so they fit beside the nut. Measured in half neck widths from the middle of the nut: u runs
// away from the nut, v across toward the bass strings (±1: the neck's edges). An outline or cover is a smooth closed curve
// through its points (a point given twice is a corner). Posts run from `from` to `to`, lowest string nearest the nut; with a
// treble side, that share of the strings (the highest nearest the nut) goes to a row of its own on the other side, mirrored
// unless it runs from and to somewhere else. Each post has a key on the head's edge on its side: machine heads or tulips. A
// headless neck ends its strings in clamps instead
const mirror = (half) => [...half, half.at(-1), ...half.slice(0, -1).reverse().map(([u, v]) => [u, -v])]; // a corner at the tip
export const HEADSTOCKS = {
  inline: {
    label: '6 in line',
    outline: [[0, 1], [0.42, 1.05], [0.73, 1.3], [1.01, 1.53], [1.46, 1.45], [2.73, 1.08], [4.38, 0.62], [5.79, 0.17], [6.54, -0.13], [6.88, -0.35], [7.03, -0.88], [6.98, -1.56], [6.64, -2.11], [6.14, -2.38], [5.59, -2.34], [5.21, -2.05], [4.99, -1.66], [4.75, -1.39], [4.25, -1.3], [3.5, -1.39], [2.6, -1.6], [1.85, -1.81], [1.18, -1.75], [0.83, -1.36], [0.47, -1.06], [0, -1]],
    posts: { from: [1.56, 0.95], to: [6.01, -0.58] },
    keys: 'machine',
    tree: 2.47, // a string tree over the top two strings, this far out
  },
  fourTwo: {
    label: '4 + 2',
    outline: [[0, 1], [0.48, 1.03], [0.94, 1.35], [1.21, 1.72], [1.52, 1.72], [2.99, 1.31], [4.23, 0.95], [5.53, 0.57], [5.92, 0.28], [6.07, -0.36], [6.05, -1.03], [5.79, -1.53], [5.36, -1.67], [4.95, -1.53], [4.68, -1.29], [4.36, -1.19], [4.02, -1.32], [3.67, -1.56], [2.99, -1.67], [2.08, -1.6], [1.4, -1.43], [0.94, -1.16], [0.48, -1.03], [0, -1]],
    posts: { from: [1.81, 1.08], to: [4.94, -0.03], treble: { share: 1 / 3, from: [2.33, -1.03], to: [3.38, -0.69] } },
    keys: 'machine',
  },
  openBook: {
    label: '3 + 3 open book',
    outline: mirror([[0, 1], [0.48, 1.07], [0.96, 1.33], [1.47, 1.53], [3.16, 1.67], [4.98, 1.76], [6.25, 1.8], [6.25, 1.8], [6.42, 0.93], [6.3, 0]]),
    posts: { from: [2.5, 1.07], to: [5.1, 1.07], treble: { share: 1 / 2 } },
    keys: 'tulip',
    cover: [[0.22, 0], [0.22, 0.4], [0.36, 0.5], [0.78, 0.4], [1.3, 0.25], [1.82, 0.16], [2.13, 0.1], [2.24, 0], [2.13, -0.1], [1.82, -0.16], [1.3, -0.25], [0.78, -0.4], [0.36, -0.5], [0.22, -0.4], [0.22, 0]], // a bell truss rod cover
    screws: [[0.43, 0], [1.98, 0]],
  },
  pointed: {
    label: '3 + 3 pointed',
    outline: [[0, 1], [0.36, 1.12], [0.75, 1.47], [1.07, 1.84], [1.38, 1.93], [2.29, 1.73], [3.26, 1.55], [4.36, 1.35], [5.45, 1.12], [5.75, 0.95], [5.86, 0.43], [5.98, -0.22], [6.29, -0.75], [6.75, -1.22], [6.75, -1.22], [6.17, -1.24], [5.33, -1.3], [4.36, -1.37], [3.26, -1.55], [2.29, -1.73], [1.38, -1.93], [1.07, -1.84], [0.75, -1.47], [0.36, -1.12], [0, -1]],
    posts: { from: [2.07, 1], to: [4.65, 0.46], treble: { share: 1 / 2 } },
    keys: 'machine',
    cover: [[0.1, 0.44], [0.1, 0.44], [0.59, 0.4], [1.1, 0.28], [1.69, 0], [1.69, 0], [1.1, -0.28], [0.59, -0.4], [0.1, -0.44], [0.1, -0.44], [0.1, 0.44]], // a pointed arch truss rod cover
    screws: [],
  },
  headless: {
    label: 'Headless',
    outline: rounded(0.2, 0.95, -1.06, 1.06, 0.2),
    clamps: 0.58,
  },
};
// A headstock's parts for strings at the given heights (half neck widths, lowest string first): its outline, where each
// string ends (a post or clamp), and the key beside each post, at the outline's edge on the side of its row
export function headstockParts(head, strings) {
  const n = strings.length, outline = spline(head.outline, 10);
  let ends = strings.map((v) => [head.clamps, v]), sides = strings.map(() => 1);
  if (head.posts) {
    const { from, to, treble } = head.posts, high = treble ? Math.floor(n * treble.share + 1e-9) : 0, low = n - high;
    const row = (a, b, count) => (i) => a.map((c, k) => c + ((b[k] - c) * i) / Math.max(1, count - 1));
    const across = ([u, v]) => [u, -v];
    const bass = row(from, to, low), top = row(treble?.from ?? across(from), treble?.to ?? across(to), high);
    ends = strings.map((_, s) => (s < low ? bass(s) : top(n - 1 - s)));
    sides = strings.map((_, s) => (s < low ? 1 : -1));
  }
  const edge = (u, side) => { // the outline's outermost crossing at u toward that side
    let best = null;
    for (let i = 1; i < outline.length; i++) {
      const [u0, v0] = outline[i - 1], [u1, v1] = outline[i];
      if ((u0 - u) * (u1 - u) > 0 || u0 === u1) continue;
      const v = v0 + ((v1 - v0) * (u - u0)) / (u1 - u0);
      if (best === null || v * side > best * side) best = v;
    }
    return best ?? side;
  };
  const keys = head.keys ? ends.map(([u], s) => ({ u, side: sides[s], edge: edge(u, sides[s]) })) : [];
  return { outline, ends, keys };
}
// The same shapes every frame, until the headstock or the strings' spacing changes: worked out once
const headstocks = new WeakMap(), shapes = new Map();
const headstockFor = (head, strings) => {
  const key = strings.join(), known = headstocks.get(head);
  if (known?.key === key) return known.parts;
  const parts = headstockParts(head, strings);
  headstocks.set(head, { key, parts });
  return parts;
};
const headstockShape = (key, points) => {
  if (!shapes.has(key)) {
    if (shapes.size > 500) shapes.clear(); // the fretboard height slider makes new ones as it moves
    shapes.set(key, points());
  }
  return shapes.get(key);
};
// Points along a smooth curve through the given ones (Catmull-Rom), `steps` of them to each; a point given twice is a
// corner the curve comes into and leaves straight
export const spline = (points, steps = 8) => [
  ...points.slice(0, -1).flatMap((p1, i) => {
    const p0 = points[Math.max(0, i - 1)], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    if (p1[0] === p2[0] && p1[1] === p2[1]) return [p1];
    return Array.from({ length: steps }, (_, j) => {
      const s = j / steps;
      return [0, 1].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * s + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * s * s + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * s ** 3));
    });
  }),
  points.at(-1),
];

const shade = (color, amount) => { // a hex colour mixed toward white (amount > 0) or black (amount < 0)
  if (!color.startsWith('#')) return color;
  const mix = (i) => {
    const v = parseInt(color.slice(i, i + 2), 16);
    return Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount)).toString(16).padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
};
const alphas = new Map(); // the same few colours at the same few opacities, every frame: made once
const alpha = (color, a) => {
  if (!color.startsWith('#')) return color;
  const key = color + a;
  let rgba = alphas.get(key);
  if (!rgba) {
    if (alphas.size > 1000) alphas.clear();
    alphas.set(key, (rgba = `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${a})`));
  }
  return rgba;
};
// The index of the first of a list sorted by time at or after `time`
const firstAt = (list, time) => {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
// For each note, the index of the next and of the note before on its string (-1: none), and the longest any note is held: found
// once per arrangement, so a frame starts at the first note that can still show instead of the song's first
function stringLinks(arr) {
  if (arr.links?.next.length === arr.notes.length) return arr.links;
  const count = arr.notes.length, next = new Array(count).fill(-1), prev = new Array(count).fill(-1), seen = {};
  let held = 0;
  for (let i = 0; i < count; i++) {
    const { string, sustain } = arr.notes[i];
    if (seen[string] !== undefined) [prev[i], next[seen[string]]] = [seen[string], i];
    seen[string] = i;
    held = Math.max(held, sustain);
  }
  return (arr.links = { next, prev, held });
}
// Short text is set at quarter-pixel sizes and measured once per font and string: it shrinks smoothly with distance, and a
// font at a size not seen before is slow to set up. font: what g.font was just set to (reading g.font back is slow)
const fontSize = (px) => Math.round(px * 4) / 4;
const MARK_PX = 32; // the size floor markings are set in, before they're scaled
const metrics = new Map();
let measured = 0;
const measure = (g, font, str) => { // → { width, middle: how far the ink's middle is above the baseline, top: how far its top is }; measuring sets the font
  let known = metrics.get(font);
  if (!known) metrics.set(font, (known = new Map()));
  let m = known.get(str);
  if (!m) {
    if (++measured > 5000) { // every song brings its own chord names: start over now and then
      [measured, known] = [0, new Map()];
      metrics.clear();
      metrics.set(font, known);
    }
    g.font = font;
    const ink = g.measureText(str); // kept as numbers: a TextMetrics holds on to the browser's font data, and the frames stall collecting it
    known.set(str, (m = { width: ink.width, middle: (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2, top: ink.actualBoundingBoxAscent }));
  }
  return m;
};
// The floor in bands of flat colour, for each theme: filling a gradient that big is by far the slowest thing to draw without a GPU.
// The bands are an image a pixel wide, stretched over the floor without smoothing: one draw, where a fill for each band was 128
const FLOOR_BANDS = 128, floorStrips = new WeakMap();
const floorStrip = (t) => {
  if (!floorStrips.has(t)) {
    const strip = new OffscreenCanvas(1, FLOOR_BANDS), s = strip.getContext('2d');
    const [c0, c1] = [t.floor0, t.floor1].map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
    const colors = Array.from({ length: FLOOR_BANDS }, (_, i) => {
      const u = (i + 0.5) / FLOOR_BANDS;
      return `rgba(${c0.map((v, c) => Math.round(v + (c1[c] - v) * u))}, ${1 - u})`;
    });
    colors.forEach((color, i) => {
      s.fillStyle = color;
      s.fillRect(0, FLOOR_BANDS - 1 - i, 1, 1); // the strike line's band at the bottom
    });
    floorStrips.set(t, { strip, near: colors[0] });
  }
  return floorStrips.get(t);
};
const fades = new Map(); // gradients along the highway, by colour and opacities (see fade in drawHighway)
// Gradients from 0 to 1, top to bottom, made once for each canvas: a shape moving every frame is filled with one placed by the
// transform (a path keeps the transform it was made in, a gradient takes the one it's filled in) instead of a new gradient a frame
const units = new WeakMap();
const unitGradient = (g, key, stops) => {
  let known = units.get(g);
  if (!known) units.set(g, (known = new Map()));
  let grad = known.get(key);
  if (!grad) {
    grad = g.createLinearGradient(0, 0, 0, 1);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    known.set(key, grad);
  }
  return grad;
};
const uprights = new Map(); // top to bottom gradients for the fret wires and the headstock, the same every frame while the camera holds still
const upright = (g, y0, y1, c0, c1) => {
  const key = `${y0}|${y1}|${c0}|${c1}`;
  let grad = uprights.get(key);
  if (!grad) {
    if (uprights.size > 20) uprights.clear();
    grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    uprights.set(key, grad);
  }
  return grad;
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((v) => v / Math.hypot(...a));

// The fret a capo is clamped at by `time`, 0 for none: a chart moves it as it goes ("capo 2", "capo off") and a file
// with one of its own has it from the start. Scanned rather than searched: a song has one or two of them, not thousands
const capoAt = (capos, time) => {
  let fret = 0;
  for (const c of capos ?? []) {
    if (c.time > time) break;
    fret = c.fret;
  }
  return fret;
};
// A hand position too brief to be one: a sixtieth of a second at the far end of a slide is the chart saying where the
// slide starts, not somewhere the hand goes and settles. The camera already holds still through moves this small (see
// moveCamera), so the box on the board, the lane down the highway and the inlay numbers hold with it rather than
// lurching there and back. Framing is left on the chart's own positions, so a note under a brief one still gets shown
const STEADY = 0.15;
const steadied = new WeakMap();
const steady = (anchors) => {
  let out = steadied.get(anchors);
  if (!out) {
    out = [];
    for (const a of anchors) {
      const last = out[out.length - 1];
      if (last && a.endTime - a.time < STEADY) last.endTime = a.endTime; // too brief: the hand stays where it was
      else out.push({ ...a });
    }
    steadied.set(anchors, out);
  }
  return out;
};

const anchorAt = (anchors, time) => { // the last hand position to start by `time`, or the first
  let lo = 0, hi = anchors.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return anchors[Math.max(0, lo - 1)];
};

const smooth = (u) => u * u * (3 - 2 * u);

// Bends and the whammy bar. Charts store a curve of [share of the note, steps]; Guitar Pro often spreads a plain bend
// evenly over the whole note, but it is played up quickly and then held, as it is drawn here. So on the highway each
// change takes at most BEND_RAMP seconds, eased into an S, and then holds: from where it starts, or, when a curve only
// says when a later point is reached (the chart's bend values), up to that point.
const BEND_RAMP = 0.3;
const timedCurves = new WeakMap();
function timedCurve(note, key) { // → [seconds, steps, reached by then] points, or null
  let cache = timedCurves.get(note);
  if (!cache) timedCurves.set(note, (cache = {}));
  if (!(key in cache)) {
    const length = Math.max(note.sustain, 0.05), given = note[key] ?? (key === 'bendCurve' && note.bend ? [[0, 0], [0.25, note.bend]] : null);
    const points = given?.map(([share, steps]) => [share * length, steps, false]) ?? [];
    if (points.length && points[0][0] > 0.001) { // starts unbent, reaching the first point by its time
      points[0][2] = true;
      points.unshift([0, 0, false]);
    }
    cache[key] = points.length ? points : null;
  }
  return cache[key];
}
function curveAt(points, sec) {
  if (!points) return 0;
  let value = points[0][1];
  for (let i = 1; i < points.length && sec > points[i - 1][0]; i++) {
    const [[t0, v0], [t1, v1, reached]] = [points[i - 1], points[i]], ramp = Math.min(t1 - t0, BEND_RAMP) || 1e-6;
    value = v0 + (v1 - v0) * smooth(Math.min(1, Math.max(0, (sec - (reached ? t1 - ramp : t0)) / ramp)));
  }
  return value;
}
export const bendAt = (note, sec) => curveAt(timedCurve(note, 'bendCurve'), sec); // steps bent, sec seconds after the note starts
const whammyAt = (note, sec) => curveAt(timedCurve(note, 'whammy'), sec); // steps the bar is pushing the pitch, sec seconds after the note starts
const peaks = new WeakMap();
const bendPeak = (note) => { // asked for many times a frame: worked out once
  let peak = peaks.get(note);
  if (peak === undefined) peaks.set(note, (peak = Math.max(note.bend || 0, ...(note.bendCurve ?? []).map(([, v]) => v))));
  return peak;
};
// The chords named big beside the hand: runs of the same chord (named again, or restruck as a repeat) count as one
// span, from the first strike to when its last note stops, so the name stays put through a riff
function chordSpans(arr) {
  if (arr.chordSpans) return arr.chordSpans;
  const spans = [];
  for (const c of arr.chords) {
    const end = Math.max(c.time + 0.25, ...c.notes.map((j) => arr.notes[j].time + arr.notes[j].sustain));
    const last = spans.at(-1);
    if (last && c.time - last.end < 1 && (c.name ? c.name === last.name : c.highDensity)) last.end = Math.max(last.end, end);
    else if (c.name) spans.push({ name: c.name, time: c.time, end });
  }
  for (const h of arr.handShapes ?? []) if (h.arpeggio && h.name) spans.push({ name: h.name, time: h.startTime, end: h.endTime }); // an arpeggio is named while it's held
  return (arr.chordSpans = spans.sort((p, q) => p.time - q.time));
}
// Chord shapes worth rails on the highway: a chord and the repeats that follow it, from the first strike until the last
// one stops (or the next different chord starts), when that lasts long enough to see
function chordRails(arr) {
  if (arr.chordRails) return arr.chordRails;
  const rails = [], ends = (c) => Math.max(c.time + 0.15, ...c.notes.map((j) => arr.notes[j].time + arr.notes[j].sustain));
  for (let i = 0; i < arr.chords.length; i++) {
    const first = arr.chords[i];
    if (first.highDensity) continue;
    let end = ends(first), j = i + 1;
    for (; arr.chords[j]?.highDensity && arr.chords[j].time - end < 1; j++) end = Math.max(end, ends(arr.chords[j]));
    end = Math.min(end, arr.chords[j]?.time ?? Infinity);
    if (end - first.time > 0.2) rails.push({ time: first.time, end, frets: first.notes.map((n) => arr.notes[n].fret) });
  }
  for (const h of arr.handShapes ?? []) if (h.arpeggio) rails.push({ time: h.startTime, end: h.endTime, frets: h.frets, arpeggio: h }); // an arpeggio's shape, held while its notes are played
  return (arr.chordRails = rails);
}
const TEXT_MARKS = { artificial: 'AH', pinch: 'PH', tap: 'TH', semi: 'SH', feedback: 'FH' };

const bendLabel = (b) => (b < 0.5 ? '¼' : b === 0.5 ? '½' : b === 1 ? 'full' : b % 1 ? `${Math.floor(b)}½` : String(b));
const ease = (from, to, ms, tau) => {
  if (from === undefined) return to;
  const eased = from + (to - from) * (1 - Math.exp(-ms / tau));
  return Math.abs(to - eased) < 1e-6 ? to : eased; // settled: exactly still (see the board in drawHighway)
};

// Critically damped spring (Unity's SmoothDamp): cam[key] reaches target in about `time` seconds, speeding up and
// slowing down smoothly even when the target jumps, so the camera never lurches
function follow(cam, key, target, time, dt) {
  if (cam[key] === undefined) [cam[key], cam[key + 'Speed']] = [target, 0];
  const omega = 2 / time, x = omega * dt, decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const offset = cam[key] - target, pull = (cam[key + 'Speed'] + omega * offset) * dt;
  cam[key + 'Speed'] = (cam[key + 'Speed'] - omega * pull) * decay;
  cam[key] = target + (offset + pull) * decay;
  if (Math.abs(cam[key] - target) < 1e-6 && Math.abs(cam[key + 'Speed']) < 1e-6) [cam[key], cam[key + 'Speed']] = [target, 0]; // settled: exactly still, so what's drawn from the camera can be kept (see the headstock)
}

// Frame every hand position coming up in the next FRAME_AHEAD seconds: a big move zooms out to show
// both positions, then eases back in once the old one is behind.
function framing(anchors, now, capo = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const a of anchors) {
    if (a.endTime <= now || a.time >= now + FRAME_AHEAD) continue;
    lo = Math.min(lo, a.fret - 1);
    hi = Math.max(hi, a.fret - 1 + a.width);
  }
  if (lo === Infinity) {
    const a = anchorAt(anchors, now);
    [lo, hi] = [a.fret - 1, a.fret - 1 + a.width];
  }
  if (capo) lo = Math.min(lo, capo - 1); // a capo is the nut from where it sits: what the open strings sound stays in view
  const span = Math.max(MIN_SPAN, hi - lo + 2) + 1; // the extra fret of slack keeps small shifts from moving the camera
  return { lo, hi, span, center: Math.min(25 - span / 2, Math.max(span / 2 - 1, (lo + hi) / 2)) };
}

// Glides cam { center, span, left, right } toward the framing; returns the hand position right now
export function moveCamera(cam, anchors, now, clock, capo = 0, snap = false) {
  const want = framing(anchors, now, capo), view = cam.target;
  if (snap) { // ПАТЧ Пюпитра (7): reduce-motion — камера встаёт на кадр сразу, без пружин и доводки
    cam.target = want;
    [cam.span, cam.spanSpeed, cam.center, cam.centerSpeed, cam.at] = [want.span, 0, want.center, 0, clock];
    const here = anchorAt(steady(anchors), now);
    [cam.left, cam.right] = [here.fret - 1, here.fret - 1 + here.width];
    return here;
  }
  const outside = !view || want.lo < view.center - view.span / 2 || want.hi > view.center + view.span / 2;
  const tooWide = view && view.span - Math.max(want.span, framing(anchors, now + FRAME_AHEAD, capo).span) > 2; // don't zoom in just to zoom out again
  if (outside || tooWide) cam.target = want;
  const ms = Math.min(clock - (cam.at ?? clock), 100);
  cam.at = clock;
  follow(cam, 'span', cam.target.span, cam.target.span > cam.span ? 0.8 : 1.4, ms / 1000); // out a little sooner than in
  follow(cam, 'center', cam.target.center, 1, ms / 1000);
  const here = anchorAt(steady(anchors), now); // the box holds through a position too brief to be one
  cam.left = ease(cam.left, here.fret - 1, ms, 90);
  cam.right = ease(cam.right, here.fret - 1 + here.width, ms, 90);
  return here;
}

// A chevron with its point at (x, y), pointing up (dir -1) or down (dir 1): a bar in its colour on a dark edge, lit along
// its middle, so it reads on any background
function chevron(g, x, y, w, h, dir, color, ink) {
  g.beginPath();
  g.moveTo(x - w, y - dir * h);
  g.lineTo(x, y);
  g.lineTo(x + w, y - dir * h);
  g.lineWidth = Math.max(3, h * 1.15);
  g.strokeStyle = ink;
  g.stroke();
  g.lineWidth = Math.max(1.5, h * 0.65);
  g.strokeStyle = color;
  g.stroke();
  g.lineWidth = Math.max(0.6, h * 0.2);
  g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  g.stroke();
}

function line2(g, x1, y1, x2, y2) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

// The canvas sized to the screen and cleared, drawn on in the virtual space: VH tall, W wide; B device pixels per unit
// ПАТЧ Пюпитра (4): масштаб рендера вместо голого DPR — renderScale задаёт вызывающий по бюджету пикселей; без него —
// DPR; в обоих случаях не выше 2. scale — CSS-пикселей на единицу виртуального пространства (для DOM-слоёв)
function clearCanvas(canvas, renderScale) {
  const dpr = Math.min(renderScale ?? (devicePixelRatio || 1), 2), cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const g = canvas.getContext('2d'), scale = ch / VH, W = cw / scale, B = dpr * scale;
  g.setTransform(B, 0, 0, B, 0, 0);
  g.clearRect(0, 0, W, VH);
  return { g, W, B, scale };
}

// cam is kept by the caller between frames; reset it to {} to snap to a new song
export function drawHighway(canvas, arr, now, t, cam) {
  const { g: onCanvas, W, B, scale: unitPx } = clearCanvas(canvas, t.renderScale);
  let g = onCanvas; // the board is drawn into an image of its own now and then (see there)
  if (!arr) return;

  const anchors = arr.anchors.length ? arr.anchors : WHOLE_SONG;
  const capo = capoAt(arr.capos, now);
  const here = moveCamera(cam, anchors, now, performance.now(), capo, !!t.reduceMotion);
  const n = arr.strings, spacing = Math.min(0.5, (5 * GAP) / Math.max(1, n - 1)), gap = spacing * BOARD_HEIGHT * (t.boardHeight ?? 1), stack = gap * (n - 1); // the height setting spreads the strings, and their notes grow with them
  const ys = (s) => (t.stringOrder === 'high' ? s : n - 1 - s) * gap; // lowest string on top, like looking down at the guitar, or highest on top, like tab
  // Which way a bend moves a string: the hand pushes the treble strings towards the bass ones and pulls the bass strings
  // back the other way, for the room to do it. Either way it runs into the neck rather than off the edge of it
  const bendWay = (string) => (string >= n / 2 ? 1 : -1) * (t.stringOrder === 'high' ? -1 : 1);
  const SPEED = NOTE_SPEED * (t.noteSpeed ?? 1), LOOK = lookAhead(t);
  const boardLo = -0.22, boardHi = stack + 0.22, floor = boardLo - 0.06, far = LOOK * SPEED;
  const Z = (dt) => Math.max(0, dt) * SPEED; // played notes stay on the board while they fade: the camera is right behind it
  const color = (s) => t.str[s % t.str.length];
  const noteLine = t.noteLines === 0 ? null : `rgba(255, 255, 255, ${t.noteLines ?? 0.5})`; // the white line under each note and frame
  const numberInk = +t.fretNumbers || 0; // how solid the fret numbers on the floor are painted, 0 for none (a player that still sets it true gets them solid)

  // Camera just behind and above the strike line, looking far down the highway, as in Tabizera: notes come up
  // out of the distance and the lanes run to a vanishing point under the header. The view angle swings it around
  // the strike line, lower for a flatter view, higher to look down on the highway (45°: behind and above equally). The
  // side angle swings it around sideways too: from the left the highway runs off to the left, and the low frets come closer.
  // The lens is shifted so the strings sit in the same place on screen however far the camera zooms out, aimed at the
  // middle of a board of standard height: a taller board grows upwards and the fret numbers under it stay put
  const span = cam.span, focus = [cam.center, (spacing * (n - 1)) / 2, 0], angle = ((t.viewAngle ?? 30) * Math.PI) / 180, reach = 0.6 * Math.SQRT2 * span;
  const straight = [focus[0], stack + reach * Math.sin(angle), -reach * Math.cos(angle)], ahead = unit(sub([focus[0], 0, 2.2 * span], straight)), up = cross(ahead, [1, 0, 0]);
  const side = ((t.sideAngle ?? 0) * Math.PI) / 180, [ss, cs] = [Math.sin(side), Math.cos(side)], rel = sub(straight, focus), behind = dot(rel, ahead), above = dot(rel, up);
  const fwd = [-ss, ahead[1] * cs, ahead[2] * cs], right = [cs, ahead[1] * ss, ahead[2] * ss]; // swung around the camera's up
  const eye = [focus[0] + above * up[0] + behind * fwd[0], focus[1] + above * up[1] + behind * fwd[1], above * up[2] + behind * fwd[2]];
  const budget = Math.min(W * 0.88, VH * (t.fill ? 1.3 : 1.05)), focal = (budget * dot(sub(focus, eye), fwd)) / span; // wide screens show more neck, not bigger frets
  // The fret width setting stretches the picture across the screen: wider frets, strings and depth as they are, however the
  // camera is swung. Capped so the framed hand positions fit
  const stretch = Math.min(FRET_WIDTH * (t.fretWidth ?? 1), (W * span) / (budget * Math.max(1, span - 2.5)));
  let shiftX = 0, shiftY = 0, mirrored = false; // ПАТЧ Пюпитра (5): левша — зеркало экрана в P(), включается после расчёта сдвигов
  const [cex, cey, cez] = eye, [cfx, cfy, cfz] = fwd, [crx, cry, crz] = right, [cux, cuy, cuz] = up; // unpacked: P runs thousands of times a frame
  const P = (x, y, z) => { // → [screen x, screen y, pixels per world unit there (across the neck, times stretch)]
    const dx = x - cex, dy = y - cey, dz = z - cez, k = focal / Math.max(0.05, dx * cfx + dy * cfy + dz * cfz);
    const sx = W / 2 + (dx * crx + dy * cry + dz * crz) * stretch * k + shiftX;
    return [mirrored ? W - sx : sx, VH / 2 - (dx * cux + dy * cuy + dz * cuz) * k + shiftY, k];
  };
  const [fx, fy, k0] = P(...focus);
  [shiftX, shiftY] = [W / 2 - fx, VH * (t.fill ? 0.83 : 0.81) - fy]; // the board low on screen, the highway's far end under the header (t.fill: no header, so bigger and up to near the top)
  const [, yl] = P(cam.center - span / 2, floor, 0), [, yr] = P(cam.center + span / 2, floor, 0), [, yc] = P(cam.center, floor, 0);
  shiftY -= Math.min(VH * 0.08, Math.max(0, yl - yc, yr - yc)); // swung, the near end of the view comes down: lift it back toward where the middle was. The same lift at any zoom, so the board holds still
  mirrored = !!t.leftHanded;
  // ПАТЧ Пюпитра (3): проекция для DOM-слоёв (метки ладов, вердикты): лад (1 — первый), струна (0 — нижняя), секунды
  // песни → CSS-пиксели канваса и k — CSS-пикселей на единицу ширины грифа там
  cam.project = (fret, string, sec) => {
    const [px, py, k] = P(fret - 0.5, ys(string), Z(sec - now));
    return { x: px * unitPx, y: py * unitPx, k: k * unitPx };
  };
  lap('setup');

  const path = (points, close = true) => {
    g.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [px, py] = P(points[i][0], points[i][1], points[i][2]);
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    if (close) g.closePath();
  };
  const line3 = (a, b) => {
    path([a, b], false);
    stroke();
  };
  // A gem's face, and the outline of everything shaped like one (targets, repeats, where a slide lands): square, or for
  // rounded notes a capsule along its string, which slants when the camera is swung to a side
  const gem = (x, y, z, hw, hh) => {
    if (t.gem !== 'pill') return path([[x - hw, y - hh, z], [x + hw, y - hh, z], [x + hw, y + hh, z], [x - hw, y + hh, z]]);
    const [lx, ly] = P(x - hw, y, z), [rx, ry] = P(x + hw, y, z), [, top] = P(x, y + hh, z), [, bottom] = P(x, y - hh, z);
    const along = Math.atan2(ry - ly, rx - lx), r = Math.min(Math.abs(bottom - top), Math.hypot(rx - lx, ry - ly)) / 2, [dx, dy] = [r * Math.cos(along), r * Math.sin(along)];
    g.beginPath();
    g.arc(lx + dx, ly + dy, r, along + Math.PI / 2, along + Math.PI * 1.5);
    g.arc(rx - dx, ry - dy, r, along - Math.PI / 2, along + Math.PI / 2);
    g.closePath();
  };
  // A chord's frame covers the whole hand position (four frets at least, more if the chord stretches) and every
  // string, standing on the floor
  const frameAt = (frets, time) => {
    const a = anchorAt(anchors, time), fretted = frets.filter((f) => f > 0);
    return [Math.min(a.fret - 1, ...fretted.map((f) => f - 1)) + 0.05, Math.max(a.fret - 1 + Math.max(4, a.width), ...fretted) - 0.05];
  };
  const xMark = (x, y, z, w, h) => { // both bars in one stroke, so a translucent X is no brighter where they cross
    path([[x - w, y - h, z], [x + w, y + h, z]], false);
    const [ax, ay] = P(x - w, y + h, z), [bx, by] = P(x + w, y - h, z);
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    stroke();
  };
  // Mutes: a palm mute is a big white X across the note, a fret-hand mute a small white X in its middle, each over a
  // dark edge so it reads on any string's colour. hw and hh: the gem's half size; color: the X's own colour instead
  // (greyed out on a repeat, and an open string's bar keeps its colour)
  // The numbers on a gem — the finger to press with — are black, or white with a dark edge (the markings setting)
  const white = t.markings === 'white', marks = white ? '#ffffff' : t.ink;
  const muteMark = (x, y, z, k, hw, hh, palm, color = null) => {
    const [w, h] = palm ? [hw * 0.85, hh * 0.8] : [Math.min(hw, 0.34) * 0.72, hh * 0.82]; // the fret hand's is big now, and faint
    if (!color) { // the dark edge
      g.strokeStyle = alpha(t.ink, palm ? 0.7 : 0.35);
      g.lineWidth = palm ? Math.max(3.5, 0.1 * k) : Math.max(2.5, 0.06 * k);
      xMark(x, y, z, w, h);
    }
    g.strokeStyle = color ?? (palm ? '#ffffff' : alpha('#ffffff', 0.42));
    g.lineWidth = Math.max(color ? 2 : palm ? 1.8 : 1.2, (palm ? 0.05 : 0.035) * k);
    xMark(x, y, z, w, h);
  };
  // size in world units at the strike line. Text on the floor shrinks with distance far more gently than the
  // highway (as in Tabizera), so the numbers of notes a few seconds away stay readable; text on a gem keeps to its size
  // Text is set in one size for each weight and scaled into place: distance gives nearly every number a size of its own, and
  // a font at a size not seen before is slow to set up and lay out. Sets the font and the transform (put back with unscale);
  // → how far the ink's middle is above the baseline, in the font's size
  let textFont = null; // what g.font was last set to here (reading it back is slow)
  let originY = 0; // where the canvas being drawn on starts: the board is drawn into an image of its own now and then (see there)
  const setFont = (font) => {
    if (font !== textFont) g.font = textFont = font;
  };
  const fonts = {};
  const scaled = (str, x, y, px, weight, align) => {
    const font = (fonts[weight] ??= `${weight} ${MARK_PX}px ${t.num}`), s = px / MARK_PX;
    measure(g, font, str);
    setFont(font);
    g.textAlign = mirrored && align !== 'center' ? (align === 'right' ? 'left' : 'right') : align; // ПАТЧ (5): зеркальная сторона подписи
    g.setTransform(B * s, 0, 0, B * s, B * x, B * (y - originY));
    return measure(g, font, str).middle;
  };
  const unscale = () => g.setTransform(B, 0, 0, B, 0, -B * originY);
  const fillFrom = (grad, y0, y1) => { // fill the current path with a unit gradient (see unitGradient) running from y0 down to y1
    g.fillStyle = grad;
    g.setTransform(B, 0, 0, B * (y1 - y0), 0, B * (y0 - originY));
    g.fill();
    unscale();
  };
  const label = (str, x, y, z, size, fill, weight = 700, align = 'center', halo = true, onGem = false) => {
    const [px, py, k] = P(x, y, z), px2 = size * (onGem ? k : Math.sqrt(k * k0));
    if (px2 < (onGem ? 1 : 8) || px < -60 || px > W + 60) return; // numbers on gems fade in from the far end, however small
    g.textBaseline = 'alphabetic';
    const middle = scaled(str, px, py, px2, weight, align); // centre the digits themselves, not the font's em box
    if (halo) { // a dark halo lifts numbers off the lines and gems behind them
      g.lineWidth = MARK_PX * 0.2;
      g.strokeStyle = alpha(t.ink, 0.9);
      g.strokeText(str, 0, middle);
    }
    g.fillStyle = fill;
    g.fillText(str, 0, middle);
    unscale();
    g.textBaseline = 'middle';
  };
  // Text painted on the floor, lying in it: the glyph's own axes are put on the floor's, so it foreshortens with the lanes
  // it sits between. The transform is fitted to the corners the text actually covers, which over something this small is
  // near enough the perspective itself; canvas text is vector, so it stays crisp however it's sheared. Like road markings
  // it is drawn long down the highway, which the foreshortening squashes back to about its width
  const floorLabel = (str, x, z, w, depth, fill, weight = 700) => {
    // Paint on the road obeys the road: a number keeps its size on the floor (w and depth are that size) and shrinks with
    // the highway, so it reads as painted where it lies rather than floating over it. It stops shrinking only where it
    // would go under what can be read at a glance, and holds there — so it is never larger than the ones nearer in,
    // which is what painting it back out towards a fixed size on screen used to do
    const [px, py] = P(x, floor, z);
    const [nx, ny] = P(x + w, floor, z), natural = Math.hypot(nx - px, ny - py); // what the highway alone would give it
    const grow = natural > 0.01 ? Math.max(1, NUM_FLOOR_PX / natural) : 1;
    const [ax, ay] = P(x + w * grow, floor, z), wide = Math.hypot(ax - px, ay - py);
    // The length it is painted over is cut back near the board: down there the floor is steep enough that the whole of it
    // comes up on screen, and a glyph drawn long enough to read at the back stands up narrow and stretched (NUM_TALL)
    let deep = depth * grow, [zx, zy] = P(x, floor, z + deep), tall = Math.hypot(zx - px, zy - py);
    for (let pass = 0; pass < 3 && tall > wide * NUM_TALL; pass++) { // the highway falls away as it is trimmed, so the trim settles over a pass or two
      deep *= (wide * NUM_TALL) / tall;
      [zx, zy] = P(x, floor, z + deep);
      tall = Math.hypot(zx - px, zy - py);
    }
    // Out towards the ends of the neck the floor's own up turns away from the screen's and lays a glyph on its side: past
    // NUM_TILT it is no longer worth reading, and it fades out rather than popping as the camera swings
    const tilt = Math.abs(Math.atan2(zx - px, py - zy));
    if (px < -60 || px > W + 60 || tall < NUM_MIN_PX || tilt > NUM_TILT) return;
    const was = g.globalAlpha;
    // Held at the floor it recedes in tone rather than size, the way paint does through haze, so the far rows still sit
    // behind the near ones; and in from the far end, so nothing pops
    g.globalAlpha = was * Math.min(1, (NUM_TILT - tilt) / 0.2, (tall - NUM_MIN_PX) / 3) * Math.max(0.45, grow ** -0.5);
    const font = (fonts[weight] ??= `${weight} ${MARK_PX}px ${t.num}`);
    setFont(font);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const { top } = measure(g, font, str); // hung from z by the top of its ink, so numbers sharing a line sit flush under it whatever their size
    const across = mirrored ? -1 : 1; // ПАТЧ (5): у левши ось грифа на экране смотрит влево — глиф не зеркалим
    g.setTransform( // font px across → w of neck; font px up → depth of highway
      (across * B * (ax - px)) / MARK_PX, (across * B * (ay - py)) / MARK_PX,
      (-B * (zx - px)) / MARK_PX, (-B * (zy - py)) / MARK_PX,
      B * px, B * (py - originY),
    );
    g.fillStyle = fill; // no halo: sheared text can't come off the glyph cache, so stroking it as well costs a second one
    g.fillText(str, 0, top);
    unscale();
    g.globalAlpha = was;
    g.textBaseline = 'middle';
  };
  const [, nearY] = P(focus[0], floor, 0), [, farY] = P(focus[0], floor, far);
  const fade = (c, a0, a1) => { // the same fade for everything that asks for it until the highway's ends move: a new gradient for every trail is dear
    const span = `${nearY}|${farY}`;
    if (fades.span !== span || fades.size > 300) {
      fades.clear();
      fades.span = span;
    }
    const key = `${c}|${a0}|${a1}`;
    let grad = fades.get(key);
    if (!grad) {
      grad = g.createLinearGradient(0, nearY, 0, farY);
      grad.addColorStop(0, alpha(c, a0));
      grad.addColorStop(1, alpha(c, a1));
      fades.set(key, grad);
    }
    return grad;
  };
  // Glows. A shadow blur is a pass of its own for every shape, by far the dearest thing a GPU canvas draws (it halved the
  // frame rate), so a glowing shape gets a soft edge drawn around it instead: its outline stroked a few times, wider and
  // fainter, under it. blur is how far out the glow reaches; faded: the shape is filled or stroked with a fade, and glows with one
  let halo = null;
  const glow = (on, color, blur = 10, faded = false) => (halo = on ? { color, blur, faded } : null);
  const HALO = [[0.6, 0.05], [0.35, 0.13], [0.15, 0.27]]; // reach as a share of blur, opacity: stacked, they fall off as a blur does
  const THIN_HALO = [[0.4, 0.3]]; // a glow of a pixel or two (the strings') looks the same in one layer, and every string has one
  const withHalo = (filled) => {
    if (!halo) return;
    const { lineWidth, globalAlpha } = g, light = filled ? 1 : Math.min(1, (2 * lineWidth) / halo.blur); // a blurred thin line spreads out faint
    g.save();
    g.strokeStyle = halo.faded ? fade(halo.color, 1, 0.1) : halo.color;
    for (const [reach, opacity] of halo.blur > 4 ? HALO : THIN_HALO) {
      g.lineWidth = (filled ? 0 : lineWidth) + 2 * halo.blur * reach;
      g.globalAlpha = globalAlpha * opacity * light;
      g.stroke();
    }
    g.restore();
  };
  const stroke = () => {
    withHalo(false);
    g.stroke();
  };
  const fill = () => {
    withHalo(true);
    g.fill();
  };
  g.textBaseline = 'middle';
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Floor and grid: a lane for every fret wire, a line for every beat. The floor, wider than any view, fades from floor0 at
  // the strike line to nothing at the far end, as a gradient would, in bands between whole device pixels (see FLOOR_BANDS),
  // clipped to its edges. Swung, the strike line slants and the floor's far ends can be beside the camera: the floor in front of it
  const { strip, near } = floorStrip(t);
  let [l, r] = [-60, LAST_FRET + 60];
  if (side) {
    const edge = focus[0] + (1 - dot(sub([focus[0], floor, 0], eye), fwd)) / fwd[0]; // where the floor comes to a fret width in front
    [l, r] = fwd[0] > 0 ? [Math.max(-60, edge), LAST_FRET + 60] : [-60, Math.min(LAST_FRET + 60, edge)];
  }
  g.save();
  path([[l, floor, 0], [r, floor, 0], [r, floor, far], [l, floor, far]]);
  g.clip();
  if (side) {
    g.fillStyle = near;
    g.fillRect(0, nearY, W, VH - nearY); // the strike line's near end, below the middle's
  }
  g.imageSmoothingEnabled = false;
  g.drawImage(strip, 0, farY, W, nearY - farY);
  g.restore();
  const lines = (from, to) => { // a straight line added to the path: lines of a kind go in one path, stroked once
    const [x0, y0] = P(...from), [x1, y1] = P(...to);
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
  };
  g.strokeStyle = fade(t.lane, 0.5, 0.04);
  g.lineWidth = LANE_W;
  g.beginPath();
  for (let w = 0; w <= LAST_FRET; w++) lines([w, floor, 0], [w, floor, far]);
  stroke();
  for (const bar of [false, true]) { // beats, then the bar lines over them
    g.strokeStyle = bar ? t.measure : t.beat;
    g.lineWidth = bar ? 1.6 : 1;
    g.beginPath();
    const arriving = []; // the one or two at the far end fade in like the notes do, each at its own depth, instead of the whole line popping into the horizon
    for (let b = firstAt(arr.beats, now); b < arr.beats.length; b++) {
      const beat = arr.beats[b], dt = beat.time - now;
      if (dt > LOOK) break;
      if (beat.measure >= 0 !== bar) continue;
      if (dt > LOOK - 0.4) arriving.push(dt);
      else lines([0, floor, Z(dt)], [LAST_FRET, floor, Z(dt)]);
    }
    stroke();
    for (const dt of arriving) {
      g.globalAlpha = (LOOK - dt) / 0.4;
      g.beginPath();
      lines([0, floor, Z(dt)], [LAST_FRET, floor, Z(dt)]);
      stroke();
    }
    g.globalAlpha = 1;
  }

  // Inlay fret numbers down the highway: a row on every bar line, so wherever the eye is there is a
  // ruler near it. The frets under the hand position are left out — its notes carry their own numbers, and sit on them.
  // A row stays lit the whole way in, so the ruler is still there to read at the moment its notes land
  if (numberInk)
    for (let b = firstAt(arr.beats, now); b < arr.beats.length; b++) {
      const beat = arr.beats[b], dt = beat.time - now;
      if (dt > LOOK) break;
      if (beat.measure < 0) continue;
      const a = anchorAt(steady(anchors), beat.time), z = Z(dt);
      g.globalAlpha = Math.min(1, (LOOK - dt) / 0.4); // in with its bar line, so a row never lands on the horizon all at once
      for (const f of INLAYS) if (f < a.fret || f >= a.fret + a.width) floorLabel(String(f), f - 0.5, z, NUM_W, NUM_Z, alpha(t.inlay, numberInk));
    }
  g.globalAlpha = 1;

  // Hand positions, unless the guides are turned off: a faint band down the highway with thin edges on the
  // floor. A move starts a new band
  const zones = t.guides === false ? [] : steady(anchors).filter((a) => a.endTime > now && a.time < now + LOOK);
  // ПАТЧ Пюпитра (8): «софит» позиции руки — свет на полу от линии удара, гаснет вдаль, и еле заметный конус к точке
  // схода; два дешёвых градиента, без blur
  if (t.soffit !== false && zones.length) {
    const lit = anchorAt(steady(anchors), now), sl = lit.fret - 1, sr = sl + lit.width, key = `soffit|${t.anchorFill}|${nearY}|${farY}`;
    let near = fades.get(key);
    if (!near) {
      near = g.createLinearGradient(0, nearY, 0, nearY + (farY - nearY) * 0.4);
      near.addColorStop(0, alpha(t.anchorFill, 0.2));
      near.addColorStop(1, alpha(t.anchorFill, 0));
      fades.set(key, near);
    }
    g.fillStyle = fade(t.anchorFill, 0.05, 0);
    path([[sl, floor, 0], [sr, floor, 0], [(sl + sr) / 2, floor, far]]);
    fill();
    g.fillStyle = near;
    path([[sl, floor, 0], [sr, floor, 0], [sr, floor, far * 0.4], [sl, floor, far * 0.4]]);
    fill();
  }
  zones.forEach((a, i) => {
    const z0 = Z(Math.max(0, a.time - now)), z1 = Z(Math.min(LOOK, a.endTime - now)), l = a.fret - 1, r = l + a.width;
    g.fillStyle = fade(t.anchorFill, t.anchorOpacity, 0.02);
    path([[l, floor, z0], [r, floor, z0], [r, floor, z1], [l, floor, z1]]);
    fill();
    g.strokeStyle = fade(t.anchorLane, 0.55, 0.04);
    g.lineWidth = ANCHOR_LANE_W * 0.6;
    for (const x of [l, r]) line3([x, floor, z0], [x, floor, z1]);
    if (i && a.time > now) line3([l, floor, z0], [r, floor, z0]);
  });

  // Bar markings on the floor where they happen (meter, key, tempo, feel, repeats, endings, jumps, ottava, free text like
  // "pizz."), and crescendo and diminuendo hairpins beside them. They keep to a line along the highway, just left of the
  // framed neck: it moves with the camera, so on screen it stays in place wherever the hand is
  const moments = new Map(), moment = (time) => { // everything at the same moment goes on one line, so nothing overlaps
    const key = Math.round(time * 100);
    if (!moments.has(key)) moments.set(key, { dt: time - now, texts: [], pins: [] });
    return moments.get(key);
  };
  for (const m of arr.markers ?? []) if (m.time >= now && m.time <= now + LOOK && !moment(m.time).texts.includes(m.text)) moment(m.time).texts.push(m.text);
  for (const h of arr.hairpins ?? []) if (h.time >= now && h.time <= now + LOOK) moment(h.time).pins.push(h.kind);
  const markLine = Math.min(cam.center - (cam.span / 2 + 0.5) / stretch, -0.5); // the same place on screen at any fret width, but never over the lanes: framed high up the neck it keeps left of the nut (and the clamp below keeps it on screen)
  for (const { dt, texts, pins } of moments.values()) { // right-aligned against the line at the depth of their bar, in perspective
    // Set in one font size and scaled to its depth: a size of its own every frame would set up a new font every frame, and
    // quarter-pixel sizes (see fontSize) would make a long line of right-aligned text jump
    const [px, py, k] = P(markLine, floor, Z(dt)), scale = Math.sqrt(k * k0), text = texts.join('  ·  '), space = 0.25 * scale;
    const font = `700 ${MARK_PX}px ${t.num}`, shrink = (0.3 * scale) / MARK_PX;
    const textWidth = text ? measure(g, font, text).width * shrink : 0, width = textWidth + pins.length * (0.9 * scale + space);
    setFont(font);
    let right = Math.max(px - 0.3 * scale, 16 + width); // a little padding from the line, kept on screen
    g.globalAlpha = Math.min(1, (LOOK - dt) / 0.4);
    if (text) {
      g.save();
      g.translate(right, py);
      g.scale(shrink, shrink);
      g.textAlign = 'right';
      g.lineWidth = MARK_PX * 0.2;
      g.strokeStyle = alpha(t.ink, 0.9);
      g.strokeText(text, 0, 0);
      g.fillStyle = t.accent;
      g.fillText(text, 0, 0);
      g.restore();
      right -= textWidth + space;
    }
    for (const kind of pins) { // a hairpin, as in notation, where it starts: opening for a crescendo, closing for a diminuendo
      const left = right - 0.9 * scale, open = 0.14 * scale, [tip, mouth] = kind === 'cresc' ? [left, right] : [right, left];
      for (const [color, lineWidth] of [[alpha(t.ink, 0.9), Math.max(3.5, 0.12 * scale)], [t.text, Math.max(1.5, 0.05 * scale)]]) {
        g.strokeStyle = color;
        g.lineWidth = lineWidth;
        g.beginPath();
        g.moveTo(mouth, py - open);
        g.lineTo(tip, py);
        g.lineTo(mouth, py + open);
        stroke();
      }
      right = left - space;
    }
  }
  g.globalAlpha = 1;
  lap('floor');


  const visible = [], indexOf = new Map(); // ПАТЧ (2): индекс ноты в arr.notes — ключ arr.status
  for (let i = firstAt(arr.notes, now - stringLinks(arr).held - 0.3); i < arr.notes.length; i++) {
    const note = arr.notes[i];
    if (note.time > now + LOOK) break;
    const lasts = Math.max(note.sustain, (note.slideTo ?? note.slideUnpitchTo ?? null) === null ? 0 : 0.25, 0.15);
    if (note.time + lasts >= now - 0.05) {
      visible.push(note);
      indexOf.set(note, i);
    }
  }
  const statusOf = (note) => (arr.status ? arr.status[indexOf.get(note)] ?? STATUS.none : STATUS.none);

  const chordOf = (note) => (note.chord === null || note.chord === undefined ? null : arr.chords[note.chord]);
  // Shown by the frame alone: a repeated chord, and one the hand has damped — there is no pitch in it to draw, so its
  // strings would only be colour saying "play this" over a mark saying the opposite
  const frameOnly = (note) => chordOf(note)?.fretHandMute || (t.repeatMarks === 'frame' && (note.repeat || chordOf(note)?.highDensity));
  const spot = (note) => { // x along the neck (an open string spans the hand position), y at its string's height
    const a = anchorAt(anchors, note.time), open = note.fret === 0;
    return { a, open, x: open ? a.fret - 1 + a.width / 2 : note.fret - 0.5, y: ys(note.string) };
  };
  // A slide glides from x along the neck over its note's length (a quarter second at least), easing in and out. Its trail
  // follows it, and so do its gem and its target on the fretboard while it sounds: a sliding chord moves with its slide
  const slideX = (note, x, sec) => { // sec seconds into the note; an open string keeps to its bar (its slide is an arch, see the trails)
    const span = note.slideSpan ?? Math.max(note.sustain, 0.25); // tied onward: it has to be there when the next takes over
    const to = note.slideTo ?? note.slideUnpitchTo ?? null, p = Math.min(1, Math.max(0, sec / span));
    // The hand leaves late and arrives early, the way a real one does, so the curve swings across rather than drifting:
    // smootherstep, which holds at both ends and crosses hard in the middle
    return to === null || note.fret === 0 ? x : x + (to - 0.5 - x) * p * p * p * (p * (p * 6 - 15) + 10);
  };

  // A bend raises what shows the note: its trail on the highway, and its string and target on the fretboard, all by the
  // same amount, so they meet at the board
  // sec seconds into the note: a bend moves the string the way the hand pushes it, the bar moves every string the way the pitch goes
  const liftAt = (note, sec) => (bendAt(note, sec) * bendWay(note.string) + whammyAt(note, sec)) * gap * BEND_LIFT;
  const noteLift = (note) => { // while it sounds
    const sec = now - note.time;
    return sec < 0 || note.fret === 0 || !(bendPeak(note) > 0) ? 0 : liftAt(note, Math.min(sec, Math.max(note.sustain, 0.15)));
  };

  // Strings being bent right now: the whole string pushed up by the finger, as a real one is, in a straight line from the nut
  // to the fretted note and on to the end of the board
  const bending = new Map();
  for (const note of visible) {
    const dt = note.time - now, held = Math.max(note.sustain, 0.15);
    if (dt > 0 || -dt > held || note.fret === 0 || !(bendPeak(note) > 0)) continue;
    bending.set(note.string, { note, x: note.fret - 0.5, dy: noteLift(note) });
  }
  const stringPath = (s, lift = 0, sounding = false) => { // along the string at the board from where it ends on the headstock (or, sounding, from the nut: nothing past it rings), bent where it is being bent
    const b = bending.get(s), y0 = ys(s) + lift, start = sounding ? [[0, y0, 0]] : [ends ? [ends[s][0], ends[s][1] + lift, 0] : [-0.6, y0, 0], [0, y0, 0]];
    if (!b) return path([...start, [LAST_FRET + 0.6, y0, 0]], false);
    path([...start, [b.x, y0 + b.dy, 0], [LAST_FRET + 0.6, y0, 0]], false); // bent on the neck only
  };
  const boardY = (note) => ys(note.string) + noteLift(note); // a bent note rides with its string


  // The headstock in front of the nut, in the theme's colours (see HEADSTOCKS). Kept to its shape whatever the fret width;
  // the strings run on over it to where they end (see stringPath), and what they wind onto goes over them further down
  const head = HEADSTOCKS[t.headstock], half = (boardHi - boardLo) / 2, flip = t.stringOrder === 'high' ? -1 : 1;
  const onHead = ([u, v]) => [(-u * half) / stretch, stack / 2 + v * half * flip, 0];
  const headV = (s) => ((ys(s) - stack / 2) * flip) / half; // a string's height, in the headstock's terms
  const parts = head && headstockFor(head, Array.from({ length: n }, (_, s) => headV(s)));
  const ends = parts?.ends.map(onHead);
  const paint = (fillStyle, strokeStyle, width = 1) => { // fill and outline the current path
    if (fillStyle) { g.fillStyle = fillStyle; fill(); }
    if (strokeStyle) { g.strokeStyle = strokeStyle; g.lineWidth = width; stroke(); }
  };
  const oval = (uv, ru, rv) => { // an oval on the headstock, radii in half neck widths
    const [x, y] = onHead(uv), [px, py] = P(x, y, 0), [ex] = P(x + (ru * half) / stretch, y, 0), [, ey] = P(x, y + rv * half, 0);
    g.beginPath();
    g.ellipse(px, py, Math.abs(ex - px), Math.abs(ey - py), 0, 0, Math.PI * 2);
  };
  const box = (u0, u1, v0, v1, round) => path(headstockShape(`${u0},${u1},${v0},${v1},${round}`, () => rounded(u0, u1, v0, v1, round)).map(onHead)); // a small part on the headstock, leaning with the board
  const drawPlate = () => {
    for (const { u, side, edge } of parts.keys) { // keys, sticking out from under the plate's edge
      const span = (a, b) => [edge + side * a, edge + side * b];
      if (head.keys === 'machine') { // long across the neck: the view flattens them
        box(u - 0.15, u + 0.15, ...span(-0.12, 0.08), 0.03);
        paint(alpha(t.text, 0.12), alpha(t.anchorLane, 0.35));
        box(u - 0.03, u + 0.03, ...span(0.06, 0.22), 0);
        paint(alpha(t.text, 0.28));
        box(u - 0.11, u + 0.11, ...span(0.2, 0.68), 0.1);
        paint(alpha(t.text, 0.18), alpha(t.anchorLane, 0.55));
      } else { // tulips
        box(u - 0.035, u + 0.035, ...span(-0.05, 0.22), 0);
        paint(alpha(t.text, 0.28));
        oval([u, edge + side * 0.18], 0.08, 0.04);
        paint(alpha(t.text, 0.3));
        oval([u, edge + side * 0.4], 0.14, 0.2);
        paint(alpha(t.text, 0.18), alpha(t.anchorLane, 0.55));
      }
    }
    // The plate: its finish darkening toward the treble side, a bevel inside the lit edge
    path(parts.outline.map(onHead));
    const [, bassY] = P(...onHead([0, 1.6])), [, trebleY] = P(...onHead([0, -1.2]));
    paint(upright(g, bassY, trebleY, t.floor0, t.ink));
    g.save();
    g.clip();
    paint(null, alpha(t.text, 0.07), 0.3 * half * k0);
    g.restore();
    glow(true, t.anchorLane, 8);
    paint(null, alpha(t.anchorLane, 0.6), Math.max(1.5, 0.03 * k0));
    glow(false);
    if (head.cover) { // the truss rod cover and its screws
      path(headstockShape(head.cover, () => spline(head.cover)).map(onHead));
      paint(alpha(t.text, 0.09), alpha(t.text, 0.4));
      for (const screw of head.screws) {
        oval(screw, 0.04, 0.04);
        paint(alpha(t.nut, 0.85));
      }
    }
  };
  const stringWidth = (s) => STRING_W * (0.7 + 0.14 * (n - 1 - s)); // wound strings are thicker
  // The headstock's plate, keys and cover move only with the view: when the board is drawn again because the hand moved, they come
  // from an image of their own, made once the view has held still for a frame
  const plate = () => {
    if (cam.plate?.key !== view || cam.plate.t !== t) {
      cam.plate = { key: view, t };
      return drawPlate();
    }
    const kept = cam.plate;
    if (!kept.image) {
      const [xs, heights] = [[], []];
      for (const uv of [...parts.outline, ...parts.keys.map(({ u, side, edge }) => [u, edge + side * 0.8])]) {
        const [x, y] = P(...onHead(uv));
        xs.push(x);
        heights.push(y);
      }
      const x0 = Math.floor(Math.max(0, Math.min(...xs) - 24) * B) / B, x1 = Math.min(W, Math.max(...xs) + 24);
      const y0 = Math.floor(Math.max(0, Math.min(...heights) - 24) * B) / B, y1 = Math.min(VH, Math.max(...heights) + 24);
      kept.image = new OffscreenCanvas(Math.max(1, Math.ceil((x1 - x0) * B)), Math.max(1, Math.ceil((y1 - y0) * B)));
      const [outer, outerY, outerFont] = [g, originY, textFont];
      [g, originY, textFont, kept.x, kept.y] = [kept.image.getContext('2d'), 0, null, x0, y0];
      g.setTransform(B, 0, 0, B, -x0 * B, -y0 * B);
      g.lineCap = g.lineJoin = 'round';
      drawPlate();
      [g, originY, textFont] = [outer, outerY, outerFont];
    }
    g.drawImage(kept.image, kept.x, kept.y, kept.image.width / B, kept.image.height / B);
  };
  const drawBoard = () => {
    // The fingerboard at the strike line. Everything on the board comes after it, and the notes come after the
    // strings, so nothing hides them
    g.fillStyle = t.board;
    path([[0, boardLo, 0], [LAST_FRET + 0.6, boardLo, 0], [LAST_FRET + 0.6, boardHi, 0], [0, boardHi, 0]]);
    fill();
    g.fillStyle = alpha(t.anchorFill, 0.16);
    path([[cam.left, boardLo, 0], [cam.right, boardLo, 0], [cam.right, boardHi, 0], [cam.left, boardHi, 0]]);
    fill();
    g.fillStyle = t.inlayDot;
    const between = (at) => (Math.max(0, Math.ceil(at) - 1) + 0.5) * gap; // halfway between the strings around `at`, counted in strings (on a string: the gap under it)
    g.beginPath();
    for (const f of INLAYS) for (const y of f % 12 ? [between((n - 1) / 2)] : [between((n - 1) / 4), stack - between((n - 1) / 4)]) { // one dot in the middle, a pair a gap off either side of it
      const [px, py, k] = P(f - 0.5, y, 0);
      g.moveTo(px + 0.1 * k, py);
      g.ellipse(px, py, 0.1 * k, 0.08 * k, 0, 0, Math.PI * 2);
    }
    fill();
    if (capo > 0) { // behind a capo the neck is dead wood
      g.fillStyle = alpha(t.ink, 0.5);
      path([[0, boardLo, 0], [capo - CAPO_BACK, boardLo, 0], [capo - CAPO_BACK, boardHi, 0], [0, boardHi, 0]]);
      fill();
    }
    if (parts) plate(); // the headstock in front of the nut

    // The strike line: metal fret wires, the nut, the hand position's posts, and the strings
    const [, wireTop] = P(focus[0], boardHi, 0), [, wireBottom] = P(focus[0], boardLo, 0);
    g.strokeStyle = upright(g, wireTop, wireBottom, alpha(t.anchorPost, 0.75), t.post); // lit from above, like fret wire
    g.lineWidth = Math.max(1.5, 0.05 * k0);
    g.beginPath();
    for (let w = 1; w <= LAST_FRET; w++) lines([w, boardLo - 0.04, 0], [w, boardHi + 0.04, 0]);
    stroke();
    g.strokeStyle = t.nut;
    g.lineWidth = Math.max(3, 0.12 * k0);
    line3([0, boardLo - 0.06, 0], [0, boardHi + 0.06, 0]);
    glow(true, t.anchorPost, 12);
    g.strokeStyle = t.anchorPost;
    g.lineWidth = Math.max(3, 0.07 * k0);
    for (const x of [cam.left, cam.right]) line3([x, boardLo - 0.14, 0], [x, boardHi + 0.14, 0]);
    glow(false);
    for (let s = 0; s < n; s++) {
      const width = stringWidth(s);
      glow(true, color(s), 3);
      g.strokeStyle = alpha(color(s), 0.9);
      g.lineWidth = width;
      stringPath(s); // on the headstock and along the neck in one stroke
      stroke();
      glow(false);
      g.strokeStyle = 'rgba(255, 255, 255, 0.25)'; // the light catching the string
      g.lineWidth = Math.max(0.6, width * 0.3);
      stringPath(s, 0.012);
      stroke();
    }
    if (parts) { // over the string ends: what they wind onto, and a string tree
      parts.ends.forEach(([u, v], s) => {
        if (head.clamps) {
          box(u - 0.1, u + 0.1, v - 0.1, v + 0.1, 0.04);
          paint(alpha(t.text, 0.22), alpha(t.text, 0.45));
          oval([u, v], 0.05, 0.05);
          paint(t.nut);
        } else { // a post in its bushing, the string wound round the side it comes from
          oval([u, v], 0.17, 0.17);
          paint(alpha(t.ink, 0.5), alpha(t.nut, 0.4));
          oval([u, v], 0.085, 0.085);
          paint(t.nut);
          oval([u, v], 0.03, 0.03);
          paint(alpha(t.ink, 0.85));
          const [px, py, k] = P(...ends[s]), [nutX, nutY] = P(0, ys(s), 0), toNut = Math.atan2(nutY - py, nutX - px);
          g.beginPath();
          g.arc(px, py, 0.1 * half * k, toNut - 1.3, toNut + 1.3);
          paint(null, color(s), stringWidth(s));
        }
      });
      if (head.tree) { // pressing the top two strings down on their way to their posts
        const vs = [n - 2, n - 1].map((s) => { const [pu, pv] = parts.ends[s]; return headV(s) + ((pv - headV(s)) * head.tree) / pu; });
        box(head.tree - 0.05, head.tree + 0.05, Math.min(...vs) - 0.08, Math.max(...vs) + 0.08, 0.04);
        paint(alpha(t.nut, 0.7), alpha(t.ink, 0.6));
      }
    }

    // Fret numbers under the board: the hand position in the accent colour, the inlay frets bold. Nothing is behind them to
    // need a halo, and outlined text is slow to draw
    for (const bold of [false, true]) // a weight at a time: switching fonts is dear
      for (let f = 1; f <= LAST_FRET; f++) {
        const on = f >= here.fret && f < here.fret + here.width, inlay = INLAYS.includes(f);
        if ((on || inlay) === bold) label(String(f), f - 0.5, boardLo - 0.3, 0, on ? 0.3 : inlay ? 0.26 : 0.2, on ? t.accent : inlay ? t.inlay : t.numOff, bold ? 800 : 500, 'center', false);
      }
  };
  // The board, the headstock, the fret wires, the strings and the fret numbers hold still while the camera and the hand position do
  // and no string is bent, and with their glow they are much of what a frame draws: once they have held still for a frame they are
  // drawn into an image of their own, as wide as the screen, and that is drawn until something of theirs moves. All of it lies flat
  // at the strike line, so where four corners of the board and the headstock's far end land on screen say where all of it does:
  // to a tenth of a device pixel, and the hand position to as little, it holds still as soon as what's left of a glide can't be seen
  const landing = (x, y) => P(x, y, 0).slice(0, 2).map((v) => Math.round(v * B * 10)).join(':');
  const view = [t.headstock, n, gap, flip, W, B, Math.round(stretch * 1e4), landing(0, boardLo), landing(LAST_FRET, boardLo), landing(0, boardHi), landing(LAST_FRET, boardHi), landing(-4, stack / 2)].join();
  const still = !bending.size && [view, here.fret, here.width, capo, Math.round(cam.left * 1000), Math.round(cam.right * 1000)].join();
  if (!still || cam.board?.key !== still || cam.board.t !== t) {
    cam.board = still && { key: still, t };
    drawBoard();
  } else {
    const board = cam.board;
    if (!board.drawn) {
      // From over the top of the board to under its fret numbers, and round the headstock out to its keys' tips (nearer the camera,
      // swung, they come out bigger than at the nut), with room for the glow
      const heights = [[0, boardHi + 0.2], [LAST_FRET, boardHi + 0.2], [0, boardLo - 0.9], [LAST_FRET, boardLo - 0.9]].map(([x, y]) => P(x, y, 0)[1]);
      if (parts) heights.push(...[...parts.outline, ...parts.keys.map(({ u, side, edge }) => [u, edge + side * 0.8])].map((uv) => P(...onHead(uv))[1]));
      const y0 = Math.floor(Math.max(0, Math.min(...heights) - 24) * B) / B, y1 = Math.min(VH, Math.max(...heights) + 24);
      const [width, height] = [Math.ceil(W * B), Math.max(1, Math.ceil((y1 - y0) * B))];
      if (cam.boardImage?.width !== width || cam.boardImage.height !== height) cam.boardImage = new OffscreenCanvas(width, height); // kept from one still stretch to the next
      [g, originY, textFont, board.y, board.drawn] = [cam.boardImage.getContext('2d'), y0, null, y0, true];
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, width, height);
      unscale();
      g.lineCap = g.lineJoin = 'round';
      g.textBaseline = 'middle';
      drawBoard();
      [g, originY, textFont] = [onCanvas, 0, null];
    }
    g.drawImage(cam.boardImage, 0, board.y, cam.boardImage.width / B, cam.boardImage.height / B);
  }
  lap('board');

  // Sounding notes light their string from the nut on, with a flash where they landed. A note left ringing
  // (let ring, an arpeggio) glows as it's struck and then stays lit without the glow: a glow on every ringing string is dear
  const ringing = (note, dt) => note.letRing && -dt > 0.25;
  for (const note of visible) {
    const dt = note.time - now;
    if (dt > 0 || -dt > Math.max(note.sustain, 0.15) || note.mute) continue;
    const judged = !!arr.status, hit = HIT_STATUS.has(statusOf(note)); // ПАТЧ (2): с судьёй струна горит только у попадания
    if (judged && !hit) continue;
    const c = color(note.string), y = boardY(note);
    glow(!ringing(note, dt), c, 10);
    g.strokeStyle = c;
    g.lineWidth = STRING_W + 3;
    stringPath(note.string, 0, true);
    stroke();
    glow(false);
    if (-dt < 0.2) {
      const [px, py, k] = P(spot(note).x, y, 0);
      g.save();
      g.translate(px, py);
      g.scale(1, 0.4); // squash a round glow into a flat ellipse
      const flash = g.createRadialGradient(0, 0, 0, 0, 0, 0.5 * k); // kept inside the fret so the next target stays visible
      flash.addColorStop(0, alpha(t.flash, 0.8 * (1 + dt / 0.2)));
      if (judged) flash.addColorStop(0.45, alpha(c, 0.7 * (1 + dt / 0.2))); // ПАТЧ (2): белое ядро → цвет струны → прозрачно
      flash.addColorStop(1, alpha(judged ? c : t.flash, 0));
      g.fillStyle = flash;
      g.beginPath();
      g.arc(0, 0, 0.5 * k, 0, Math.PI * 2);
      fill();
      if (judged) { // ПАТЧ (2): кольцо попадания расходится за 180 мс
        const u = Math.min(1, -dt / 0.18);
        g.strokeStyle = alpha(c, 0.8 * (1 - u));
        g.lineWidth = 2 / 0.4;
        g.beginPath();
        g.arc(0, 0, (0.35 + 0.4 * u) * k, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
  }

  // A chord shape being held: its frame lit on the board
  g.strokeStyle = t.anchorLane;
  g.lineWidth = 2.5;
  glow(true, t.anchorLane, 10);
  for (const shape of arr.handShapes ?? []) {
    if (shape.startTime > now || shape.endTime <= now || shape.endTime - shape.startTime < 0.3 || !shape.frets.some((f, str) => f >= 0 && str < n)) continue;
    const [l, r] = frameAt(shape.frets.filter((f, str) => str < n), shape.startTime);
    path([[l, boardLo, 0], [r, boardLo, 0], [r, boardHi, 0], [l, boardHi, 0]]);
    stroke();
  }
  glow(false);
  if (capo > 0) { // The capo, clamped over the strings just behind its fret wire: from there they play open. Drawn here
    // rather than into the board's image, so it stays on top of a string lit by a note sounding on it
    const x = capo - CAPO_BACK;
    g.strokeStyle = t.nut;
    g.lineWidth = Math.max(4, 0.17 * k0);
    line3([x, boardLo - 0.16, 0], [x, boardHi + 0.16, 0]);
    g.strokeStyle = alpha(t.ink, 0.45); // the dark rubber down its middle
    g.lineWidth = Math.max(1, 0.05 * k0);
    line3([x, boardLo - 0.13, 0], [x, boardHi + 0.13, 0]);
  }
  lap('strings');

  // Under every frame and gem: a white line on the floor under each note, marking its beat (chords get theirs under the
  // frame; the note lines setting sets how white, down to none), and a stem from each fretted note down to it
  for (const note of visible) {
    const dt = note.time - now, z = Z(dt), chord = chordOf(note), { a, open, x: from, y } = spot(note), x = slideX(note, from, -dt);
    if (dt < -0.15 || note.tied || Math.abs(P(x, y, z)[0] - W / 2) > W / 2 + 200) continue; // tied: no beat of its own
    const hw = open ? (a.width - 0.2) / 2 : 0.34;
    g.globalAlpha = dt < 0 ? Math.max(0, 1 + dt / 0.15) : Math.min(1, (LOOK - dt) / 0.4);
    if (!chord && noteLine) {
      g.strokeStyle = noteLine;
      g.lineWidth = 2;
      line3([x - hw, floor, z], [x + hw, floor, z]);
    }
    if (open || frameOnly(note)) continue;
    g.strokeStyle = alpha(color(note.string), note.repeat || chord?.highDensity ? 0.35 : 0.75); // fainter under a repeat
    g.lineWidth = 1.5;
    line3([x, Math.min(y, boardY(note)) - 0.42 * gap, z], [x, floor, z]);
  }
  g.globalAlpha = 1;

  // Under every gem: slide ramps into and out of notes, slurs from a hammer-on or pull-off back to its note, ties,
  // and tails. A tail is a ribbon along its string that fades into the distance; its shape is the technique: a slide
  // drifts along the neck, a bend or the whammy bar rises and falls with its curve, vibrato is an even wave up and down, tremolo
  // picking jitters, let ring is dashed
  const arc = (from, to, bulge) => { // a curve between two points on the highway, rising by bulge in the middle
    const points = Array.from({ length: 13 }, (_, j) => {
      const u = j / 12;
      return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u + Math.sin(Math.PI * u) * bulge, from[2] + (to[2] - from[2]) * u];
    });
    path(points, false);
    stroke();
  };
  // Chord shapes being held or played again: two glowing rails on the floor along the frame's edges. An
  // arpeggio's rails don't glow (they run for seconds, under notes that ring), and where its shape is taken they start with
  // the outline of its frame, and its name
  for (const rail of chordRails(arr)) {
    if (rail.end <= now || rail.time >= now + LOOK) continue;
    const [l, r] = frameAt(rail.frets, rail.time), dt = rail.time - now, z0 = Z(Math.max(dt, 0)), z1 = Z(Math.min(rail.end - now, LOOK));
    g.globalAlpha = Math.min(1, (LOOK - Math.max(dt, 0)) / 0.4);
    glow(!rail.arpeggio, t.anchorLane, 10, true);
    g.strokeStyle = fade(t.anchorLane, 1, 0.2);
    g.lineWidth = 3.5;
    for (const side of [l, r]) line3([side, floor, z0], [side, floor, z1]);
    glow(false);
    if (rail.arpeggio && dt > 0) {
      g.strokeStyle = alpha(t.anchorLane, 0.7);
      g.lineWidth = 1.5;
      path([[l, floor, z0], [l, boardHi, z0], [r, boardHi, z0], [r, floor, z0]], false);
      stroke();
      if (rail.arpeggio.name && z0 > NEAR) label(rail.arpeggio.name, l - 0.12, boardHi / 2, z0, 0.34, t.text, 600, 'right');
    }
  }
  g.globalAlpha = 1;

  const across = (later, at) => { // a note lying across a trail where the trail is at along the neck
    const over = spot(later);
    return Math.abs(over.x - at) < (over.open ? (over.a.width - 0.2) / 2 + 0.1 : 0.45);
  };
  for (const [i, note] of visible.entries()) {
    const dt = note.time - now, chord = chordOf(note), slide = note.slideTo ?? note.slideUnpitchTo ?? null;
    const { a, open, x, y } = spot(note), c = color(note.string), z = Z(dt);
    const hw = (open ? (a.width - 0.2) / 2 : 0.34) * (note.grace ? 0.6 : 1), hh = (open ? 0.12 : 0.42) * gap * (note.grace ? 0.6 : 1);
    if (dt > -0.15 && !chord?.highDensity && !note.repeat) {
      g.globalAlpha = Math.min(1, (LOOK - dt) / 0.4);
      g.strokeStyle = c;
      g.lineWidth = 2;
      g.setLineDash([4, 4]);
      if (note.slideIn) line3([x + (note.slideIn === 'below' ? -1.4 : 1.4), y - hh, Math.max(0, z - 1)], [x + (note.slideIn === 'below' ? -hw : hw), y, z]);
      if (note.slideOut) line3([x + (note.slideOut === 'up' ? hw : -hw), y, z], [x + (note.slideOut === 'up' ? 1.4 : -1.4), y - hh, z + 1]);
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    const tail = slide === null ? note.sustain : Math.max(note.sustain, 0.25);
    const moves = slide !== null || note.bend || note.bendCurve || note.whammy;
    // A link in a tied chain keeps its trail however short it is: the ring carries on either side of it, and the gap
    // where a held fret sits between two slides is the join, not a note too brief to bother drawing
    const linked = note.tied || typeof note.tieTo === 'number';
    if ((tail <= 0.2 && !linked) || dt + tail <= 0 || (chord && !moves && !linked) || frameOnly(note)) continue; // chords sustain without trails: their frames already show the beats — unless one is tied onward, where the trail is the only thing carrying it to what it ties to
    if (open && slide) { // a slide from an open string: an arch from its bar to the fret it lands on when the note ends
      g.strokeStyle = c;
      g.lineWidth = 2.5;
      g.setLineDash(note.letRing ? [7, 6] : []);
      arc([x, y, Z(Math.max(dt, 0))], [slide - 0.5, y, Z(Math.min(dt + tail, LOOK))], gap * 1.5);
      g.setLineDash([]);
    }
    // A trail ends where the next note in its way starts: the next chord, the next note on its string (a slide runs into
    // the note it slides to), or a later note lying across it. Cut there in time, so the trail keeps its shape as it comes
    let next = null;
    for (let j = i + 1; j < visible.length && visible[j].time <= note.time + tail + 0.02; j++) {
      const later = visible[j];
      if (later.time <= note.time + 0.005) continue;
      if (chordOf(later) || later.string === note.string || across(later, x)) {
        next = later;
        break;
      }
    }
    const d0 = Math.max(dt, 0), bent = note.bend || note.bendCurve || note.whammy;
    const falls = slide !== null && note.slideTo === null; // slid off rather than slid to: it dies away where it stops
    let d1 = Math.min(dt + tail, LOOK, next ? next.time - now : Infinity);
    if (d1 <= d0) continue;
    const along = (d) => {
      const sec = d - dt, zz = Z(d);
      const railed = note.bend || note.bendCurve || note.whammy; // a rail stays straight: its vibrato shows in the mark above the note
      const wave = note.vibrato && !railed ? Math.sin((zz / 1.6) * Math.PI * 2) * gap * (note.vibratoWide ? 0.45 : 0.25) : 0; // the string pushed up and let back, a steady wavelength along the highway
      const jitter = note.tremolo ? (Math.floor(zz / 0.3) % 2 ? 0.05 : -0.05) : 0;
      // A bend raises the trail in a smooth S where the pitch rises, holds it up and lowers it again for a release; it rises
      // a little more than the string on the fretboard, so it reads from behind, and settles to the string at the board
      const rise = BEND_LIFT + (BEND_RISE - BEND_LIFT) * smooth(Math.min(1, zz / BEND_EASE));
      return [slideX(note, x, sec) + jitter, y + wave + (liftAt(note, sec) * rise) / BEND_LIFT, zz];
    };
    // Raised, or running into a note on a string below it (in a chord, the one lying across it), the trail would show past
    // that note: end it where it reaches the note's bottom edge on screen
    const end = next && along(d1)[0], member = next && chordOf(next)?.notes.find((j) => across(arr.notes[j], end));
    const stop = typeof member === 'number' ? arr.notes[member] : next;
    // Past that note on screen means above its bottom edge while over it from side to side: a trail beside it (a slide on its
    // way there, a bend beside a chord's other notes) shows in full. A trail that starts past it, the two a few pixels apart
    // in the distance, isn't cut either: cut to nothing, it would vanish until they came close and then grow back
    if (next && !next.tied && (bent || across(stop, end))) { // a tied note draws no gem, so there is nothing to keep clear of: the trail runs straight on into it
      const at = spot(stop), zs = Z(stop.time - now), half = at.open ? (at.a.width - 0.2) / 2 : 0.34;
      const bottom = P(at.x, at.y - (at.open ? 0.12 : 0.42) * gap, zs)[1] + 3, [l] = P(at.x - half, at.y, zs), [r] = P(at.x + half, at.y, zs);
      const past = (d) => {
        const [px, py] = P(...along(d));
        return py < bottom && px > Math.min(l, r) - 2 && px < Math.max(l, r) + 2;
      };
      if (past(d1) && !past(d0)) {
        let lo = d0, hi = d1;
        for (let j = 0; j < 24; j++) [lo, hi] = past((lo + hi) / 2) ? [lo, (lo + hi) / 2] : [(lo + hi) / 2, hi];
        d1 = lo;
      }
      if (d1 <= d0 + 0.001) continue;
    }
    const straight = slide === null && !bent && !note.vibrato && !note.tremolo; // a straight line along the highway stays straight in perspective: its two ends draw it
    const steps = straight ? 1 : Math.min(400, Math.max(12, Math.ceil((d1 - d0) * SPEED * 8)));
    const spine = Array.from({ length: steps + 1 }, (_, j) => along(d0 + ((d1 - d0) * j) / steps));
    if (open && !chord) { // an open string sounds as a lane as wide as the hand position, edged in its colour
      g.fillStyle = fade(c, note.letRing ? 0.14 : 0.26, 0.03);
      path([...spine.map(([px, py, pz]) => [px - hw, py, pz]), ...spine.slice().reverse().map(([px, py, pz]) => [px + hw, py, pz])]);
      fill();
      glow(!note.letRing, c, 6, true);
      g.strokeStyle = fade(c, 0.95, 0.3);
      g.lineWidth = 2.5;
      g.setLineDash(note.letRing ? [7, 6] : []);
      for (const side of [-hw, hw]) {
        path(spine.map(([px, py, pz]) => [px + side, py, pz]), false);
        stroke();
      }
      g.setLineDash([]);
      glow(false);
    } else if (note.bend || note.bendCurve || note.whammy) { // a bend: a solid band, raised where the string is bent
      const band = (half) => path([...spine.map(([px, py, pz]) => [px - half, py, pz]), ...spine.slice().reverse().map(([px, py, pz]) => [px + half, py, pz])]);
      band(RAIL);
      g.fillStyle = fade(c, 1, 0.6);
      fill();
      band(RAIL * 0.35); // a slightly darker stripe along the middle
      g.fillStyle = fade(shade(c, -0.22), 1, 0.55);
      fill();
      glow(true, c, 8, true);
      g.strokeStyle = fade(shade(c, 0.6), 1, 0.5); // bright edges
      g.lineWidth = 2;
      for (const side of [-RAIL, RAIL]) {
        path(spine.map(([px, py, pz]) => [px + side, py, pz]), false);
        stroke();
      }
      glow(false);
    } else {
      glow(!note.letRing, c, 6, true);
      // The same rail a bend rides on, so a bend that turns into a slide, or a slide that rings on, keeps one width the
      // whole way instead of changing shape where the technique changes. A slide off the end (slideUnpitchTo, no target
      // pitch) is the hand letting go, so its rail narrows away to nothing over its second half
      const wide = (j) => (falls ? RAIL * Math.min(1, 2 * (1 - j / (spine.length - 1))) : RAIL);
      // Left open, so the one path serves twice: filled for the ribbon, then stroked for its two bright edges — which is
      // where the white line down the middle used to be. A trail is drawn for every note that rings, so it is worth the
      // path it saves
      path([...spine.map(([px, py, pz], j) => [px - wide(j), py, pz]), ...spine.map(([px, py, pz], j) => [px + wide(j), py, pz]).reverse()], false);
      g.fillStyle = falls ? fade(c, 0.9, 0) : fade(c, note.letRing ? 0.5 : 0.9, note.letRing ? 0.2 : 0.45); // plain to see from the far end, not only as it arrives
      fill();
      g.strokeStyle = falls ? fade(shade(c, 0.6), 0.85, 0) : fade(shade(c, 0.6), 1, 0.5);
      g.lineWidth = 2;
      g.setLineDash(note.letRing ? [7, 6] : []);
      stroke();
      g.setLineDash([]);
      glow(false);
    }
  }
  lap('trails');

  // Notes, far to near: gems riding at their string's height
  const boxed = new Set();
  for (let i = visible.length - 1; i >= 0; i--) {
    const note = visible[i], dt = note.time - now, z = Z(dt);
    const chord = chordOf(note), { a, open, x: from } = spot(note), x = slideX(note, from, -dt), y = boardY(note); // a note being bent rides up with its string
    const muted = note.mute || chord?.fretHandMute, palm = note.palmMute || chord?.palmMute;
    const missed = MISS_STATUS.has(statusOf(note)); // ПАТЧ (2): промах и не та нота — серая с красной кромкой
    const c = missed ? MISS_GREY : color(note.string);
    const hw = (open ? (a.width - 0.2) / 2 : 0.34) * (note.grace ? 0.6 : 1), hh = (open ? 0.12 : 0.42) * gap * (note.grace ? 0.6 : 1); // grace notes are small

    if (dt < -0.15) continue;
    const faded = dt < 0 ? Math.max(0, 1 + dt / 0.15) : Math.min(1, (LOOK - dt) / 0.4); // fade in at the far end, out once played
    g.globalAlpha = faded;

    if (chord && !boxed.has(note.chord)) {
      boxed.add(note.chord);
      // Repeats of the chord before get the same frame, empty and faint until it comes close: then strum again
      const [l, r] = frameAt(chord.notes.map((j) => arr.notes[j].fret), note.time), shown = g.globalAlpha;
      const near = z < NEAR, veiled = (chord.fretHandMute || chord.palmMute) && t.repeatMarks !== 'hide'; // a muted chord: its whole frame, X and all, at half
      const weight = (near ? 0.65 : chord.highDensity && t.repeatMarks !== 'frame' ? 0.18 : 0.5) * (veiled ? 0.5 : 1); // a frame on its own keeps its full weight
      path([[l, floor, z], [r, floor, z], [r, boardHi, z], [l, boardHi, z]]);
      if (t.frames === 'gradient') { // a panel glowing up from the floor, fading out above the top string
        const [, bottom] = P(l, floor, z), [, top] = P(l, boardHi, z), lit = near ? t.anchorLane : t.anchorFill;
        fillFrom(unitGradient(g, `${lit}|${weight}`, [[0, alpha(lit, weight * 0.6)], [1, alpha(lit, 0)]]), bottom, top);
      } else {
        g.globalAlpha = shown * weight;
        if (!chord.highDensity) {
          g.fillStyle = t.chordFill;
          fill();
        }
        g.strokeStyle = near ? t.anchorLane : t.chordBox;
        g.lineWidth = near || !chord.highDensity ? 1.5 : 1.2;
        glow(near, t.anchorLane, 8);
        stroke();
        glow(false);
      }
      g.globalAlpha = shown; // a white line under every frame, box or gradient, marks the moment to play it
      g.strokeStyle = noteLine;
      g.lineWidth = 2;
      if (noteLine) line3([l, floor, z], [r, floor, z]);
      // A whole hand laid across the strings mutes them all at once, so it is one X over the chord rather than one on
      // every string: big enough to read as the hand it is. The frame and the X are one thing drawn at half, so the
      // chord reads as veiled rather than wearing a faint mark. A palm-muted chord's first strike has gems to carry
      // its mark; its repeats are the frame alone, so the frame wears the X for them, squished to half its height
      if (veiled && (chord.fretHandMute || chord.highDensity)) {
        // Inset from the frame, so it reads as a mark laid on the chord rather than part of its box; drawn in strokes
        // about as broad as a note's rail. One pass and no glow: a note is lit, a chord damped by the hand is veiled
        const [, , kk] = P((l + r) / 2, floor, z);
        const mx = (l + r) / 2, mw = ((r - l) / 2) * 0.78, mh = ((boardHi - floor) / 2) * (chord.fretHandMute ? 0.72 : 0.3), my = chord.fretHandMute ? (floor + boardHi) / 2 : floor + mh * 1.4; // the damp's X fills the frame; a palm mute's sits low, just off the floor
        g.globalAlpha = shown * 0.5;
        g.strokeStyle = 'rgba(255, 255, 255, 0.5)'; // half again within the veiled frame
        g.lineWidth = Math.max(3, 0.28 * kk);
        g.lineCap = 'round';
        xMark(mx, my, z, mw, mh);
        g.lineCap = 'butt';
        g.globalAlpha = shown;
      }
      if (chord.accent) { // played harder: the frame's top corners shine white
        const arm = Math.min(0.6, (r - l) * 0.22), drop = (boardHi - floor) * 0.35;
        const size = Math.min(1, P(l, boardHi, z)[2] / P(l, boardHi, NEAR)[2]); // thinner in the distance, as the frame is
        g.strokeStyle = '#ffffff';
        g.lineWidth = Math.max(1, 3.5 * size * (chord.accent === 'heavy' ? 1.4 : 1));
        g.lineCap = 'square';
        glow(true, '#ffffff', Math.max(2, 12 * size));
        path([[l, boardHi - drop, z], [l, boardHi, z], [l + arm, boardHi, z]], false);
        stroke();
        path([[r - arm, boardHi, z], [r, boardHi, z], [r, boardHi - drop, z]], false);
        stroke();
        glow(false);
        g.lineCap = 'round';
      }
      if (chord.barre && (!chord.highDensity || t.repeatMarks === 'grey')) { // one finger across several strings: a bar over them at its fret (a repeat's like its other marks: greyed out, or left off)
        const bx = chord.barre.fret - 0.5;
        g.strokeStyle = chord.highDensity ? t.muted : 'rgba(255, 255, 255, 0.7)';
        g.lineWidth = Math.max(3, 0.1 * P(bx, stack / 2, z)[2]);
        const [y0, y1] = [ys(chord.barre.from), ys(chord.barre.to)].sort((p, q) => p - q);
        line3([bx, y0 - gap * 0.4, z], [bx, y1 + gap * 0.4, z]);
        label(chord.barre.half ? '½B' : 'B', bx, boardHi + 0.12, z, 0.22, chord.highDensity ? t.muted : t.text);
      }
      if (chord.strum || chord.roll) { // strum or roll beside the frame: down runs from the low strings to the high ones
        const ax = l - 0.25, lowSide = ys(0) > ys(n - 1) ? boardHi - 0.1 : floor + 0.15, highSide = lowSide > stack / 2 ? floor + 0.15 : boardHi - 0.1;
        const [from, to] = (chord.strum ?? chord.roll) === 'down' ? [lowSide, highSide] : [highSide, lowSide];
        g.strokeStyle = t.text;
        g.lineWidth = 2;
        if (chord.roll) path(Array.from({ length: 17 }, (_, j) => [ax + Math.sin((j / 16) * Math.PI * 6) * 0.06, from + ((to - from) * j) / 16, z]), false); // rolled: a wavy arrow
        else path([[ax, from, z], [ax, to, z]], false);
        stroke();
        const head = to < from ? 0.14 : -0.14;
        line3([ax - 0.08, to + head, z], [ax, to, z]);
        line3([ax + 0.08, to + head, z], [ax, to, z]);
      }
      const before = arr.chords[note.chord - 1], changed = !before || note.time - before.time > 1 || before.name !== chord.name;
      if (z > NEAR && chord.name && !chord.highDensity && changed) label(chord.name, l - 0.12, boardHi / 2, z, 0.34, t.text, 600, 'right'); // name it once per change
    }

    const [cx, cy, k] = P(x, y, z);
    if (cx < -200 || cx > W + 200 || frameOnly(note)) {
      g.globalAlpha = 1;
      continue;
    }
    const repeated = note.repeat || chord?.highDensity;
    // A tied note is the one before, still ringing: the trail draws where it slid or bent to, and a gem here would say
    // strike it again. Its marks still stack above, so a vibrato or a bend held through the tie keeps them
    if (repeated) { // the same chord again: just outlines on its beat, lit as they arrive
      const near = z < NEAR;
      g.globalAlpha *= near ? 0.9 : 0.4;
      g.strokeStyle = c;
      g.lineWidth = near ? 2 : 1.5;
      glow(near, c, 8);
      gem(x, y, z, hw, hh);
      stroke();
      glow(false);
      if (((note.palmMute && !chord?.palmMute) || (note.mute && !chord?.fretHandMute)) && t.repeatMarks !== 'hide') muteMark(x, y, z, k, open ? 0.34 : hw, open ? gap * 0.3 : hh, palm, t.muted); // its mute, greyed out; a whole hand's is the chord's own X
      g.globalAlpha = faded;
    } else if (!note.tied) {
      if (!open && numberInk) {
        const fret = note.harmonic || note.harmonicPinch ? `<${note.fret}>` : note.ghost ? `(${note.fret})` : String(note.fret);
        const size = note.grace ? 0.7 : 1; // painted on the floor like the inlay row, so it reads as far back as that one does, and holds until the note lands
        floorLabel(fret, x, z, NUM_W * size, NUM_Z * size, alpha(c, numberInk)); // hung under the note's own line, so a chord's numbers read as one row
      }
      if (note.dynamicLabel) label(note.dynamicLabel, x - 0.6, floor, z, 0.3, t.text, 'italic 700', 'right'); // where the dynamic changes

      if (note.ghost) g.globalAlpha = faded * 0.5;
      if (t.gem === 'pill') { // a capsule; in 3D its back shows a few pixels behind it, lit as a square gem's top
        if (t.notes3d !== false) {
          gem(x, y, z + GEM_DEPTH, hw, hh);
          g.fillStyle = c;
          fill();
          g.fillStyle = 'rgba(255, 255, 255, 0.35)';
          fill();
        }
        gem(x, y, z, hw, hh);
        g.fillStyle = c;
        fill();
      } else { // a square gem with a lit face; in 3D a thin box with a lit top, lit from above
        const harmonic = note.harmonic || note.harmonicPinch, depth = GEM_DEPTH;
        if (!harmonic && t.notes3d !== false) { // top and sides first; the face covers whichever side faces away
          for (const [side, shade] of [
            [[[x - hw, y + hh, z], [x + hw, y + hh, z], [x + hw, y + hh, z + depth], [x - hw, y + hh, z + depth]], 'rgba(255, 255, 255, 0.35)'],
            [[[x - hw, y - hh, z], [x - hw, y + hh, z], [x - hw, y + hh, z + depth], [x - hw, y - hh, z + depth]], 'rgba(0, 0, 0, 0.4)'],
            [[[x + hw, y - hh, z], [x + hw, y + hh, z], [x + hw, y + hh, z + depth], [x + hw, y - hh, z + depth]], 'rgba(0, 0, 0, 0.4)'],
          ]) {
            path(side);
            g.fillStyle = c;
            fill();
            g.fillStyle = shade;
            fill();
          }
        }
        glow(z < NEAR, c, 8);
        g.fillStyle = c;
        if (harmonic) path([[x, y + hh * 1.3, z], [x + hw * 0.8, y, z], [x, y - hh * 1.3, z], [x - hw * 0.8, y, z]]);
        else gem(x, y, z, hw, hh);
        fill();
        glow(false);
        const [, ty] = P(x, y + hh, z), [, by] = P(x, y - hh, z);
        fillFrom(unitGradient(g, 'shine', [[0, 'rgba(255, 255, 255, 0.45)'], [0.5, 'rgba(255, 255, 255, 0)'], [1, 'rgba(0, 0, 0, 0.25)']]), ty, by);
        g.strokeStyle = missed ? MISS_EDGE : 'rgba(255, 255, 255, 0.6)';
        g.lineWidth = missed ? 2 : 1;
        stroke();
      }
      // A whole hand's damp is the chord's one X, so its notes say nothing. A palm mute is on the chord's frame and on
      // every note of its first strike, so the gems say it too; a string muted on its own still carries its own
      if (palm || (note.mute && !chord?.fretHandMute))
        muteMark(x, y, z, k, open ? 0.34 : hw, open ? gap * 0.3 : hh, palm, open && palm ? c : null); // on an open string's thin bar, the palm mute's X keeps its colour

      if (!open && !muted && !palm) { // a mute's X takes the middle of the gem
        // ПАТЧ Пюпитра (1): на ноте — лад (t.gemLabel 'fret') или палец (как в апстриме); при t.gemSink цифры не рисуются
        // на канвасе, а уходят в DOM-слой меток (CSS-пиксели): чёткие при любом renderScale
        const finger = note.finger ?? (chord?.fingers?.[note.string] >= 0 ? chord.fingers[note.string] : null);
        const onGem = t.gemLabel === 'fret' ? String(note.fret) : finger !== null ? (finger === 0 ? 'T' : String(finger)) : '';
        if (onGem) { // shown from the far end, fading in until 40% of the way along the drawing distance
          const shown = g.globalAlpha, fadeIn = Math.min(1, Math.max(0, (1 - dt / LOOK) / 0.4));
          if (t.gemSink) {
            const [px, py, k] = P(x, y, z - 0.01), size = gap * 0.62 * k;
            if (size >= 1 && px >= -60 && px <= W + 60) t.gemSink.push({ text: onGem, x: px * unitPx, y: py * unitPx, size: size * unitPx, alpha: shown * fadeIn });
          } else {
            g.globalAlpha = shown * fadeIn;
            label(onGem, x, y, z - 0.01, gap * 0.62, marks, 700, 'center', white, true);
            g.globalAlpha = shown;
          }
        }
      }
    }
    if (repeated && t.repeatMarks === 'hide') {
      g.globalAlpha = 1;
      continue;
    }

    const ink = repeated ? t.muted : t.text; // marks on a repeated note are greyed out
    g.globalAlpha = faded * (repeated ? 0.8 : 1) * Math.min(1, Math.max(0, (1 - dt / LOOK) / 0.15)); // fading in from the far end, a little after the note
    if (note.ghost) { // ghost note: dimmed, in brackets
      const [lx] = P(x - hw, y, z), [rx] = P(x + hw, y, z), r = hh * k * 1.5;
      g.strokeStyle = repeated ? ink : c;
      g.lineWidth = Math.max(1.2, 0.035 * k);
      g.beginPath();
      g.arc(lx + r * 0.35, cy, r, Math.PI * 0.7, Math.PI * 1.3);
      stroke();
      g.beginPath();
      g.arc(rx - r * 0.35, cy, r, -Math.PI * 0.3, Math.PI * 0.3);
      stroke();
    }
    if (note.grace) { // grace note: small, with a slash
      g.strokeStyle = ink;
      g.lineWidth = Math.max(1, 0.03 * k);
      line2(g, cx - hw * k * stretch * 1.2, cy + hh * k * 1.4, cx + hw * k * stretch * 1.2, cy - hh * k * 1.4);
    }
    if (note.showString) { // the string's number in a circle, to the left of the note
      const [lx] = P(x - hw, y, z), r = 0.12 * k, sx = lx - r - 0.06 * k;
      g.strokeStyle = g.fillStyle = repeated ? ink : c;
      g.lineWidth = Math.max(1, 0.025 * k);
      g.beginPath();
      g.arc(sx, cy, r, 0, Math.PI * 2);
      stroke();
      scaled(String(n - note.string), sx, cy, 0.15 * k, 700, 'center');
      g.fillText(String(n - note.string), 0, 0);
      unscale();
    }

    // Marks stack upwards above the note, articulation nearest to it as in notation
    let above = cy - hh * k - 0.18 * k;
    g.strokeStyle = g.fillStyle = ink;
    g.lineWidth = Math.max(1.2, 0.04 * k);
    g.textAlign = 'center';
    const squiggle = (w, amp, cycles) => { // notation's wavy line: along a vibrato, over a tremolo's slashes
      g.beginPath();
      for (let j = 0; j <= 20; j++) g[j ? 'lineTo' : 'moveTo'](cx - w + (2 * w * j) / 20, above + Math.sin((j / 20) * Math.PI * 2 * cycles) * amp);
      stroke();
    };
    const write = (word, size, style = '700') => {
      if (size * k < 2) return; // below a pixel or two it is only noise
      scaled(word, cx, above, size * k, style, 'center');
      g.fillText(word, 0, 0);
      unscale();
      above -= (size + 0.04) * k;
    };
    let onTop = cy - hh * k; // the top of the gem, and then of what sits on it
    const tapped = note.tap && !note.tapLeft; // with the picking hand: its arrow stands for the legato too
    // A tied note is the one before, still ringing. Whatever the chart marks on it, it is not struck again, so no
    // hammer-on or pull-off triangle and no tap arrow — they would float over a ribbon with no gem under them. What it
    // is still doing, a vibrato or a bend, keeps its mark
    if ((note.hammerOn || note.pullOff) && !tapped && !note.tied) { // a white triangle on the note, pointing down to hammer on and up to pull off
      // On the note itself, not above it: pointing down onto it to hammer on, up off it to pull off
      const scale = note.grace ? 0.6 : 1, w = 0.34 * k * stretch * scale, h = 0.72 * gap * k * scale;
      const [tip, base] = note.hammerOn ? [cy + h / 2, cy - h / 2] : [cy - h / 2, cy + h / 2];
      g.beginPath();
      g.moveTo(cx - w, base);
      g.lineTo(cx + w, base);
      g.lineTo(cx, tip);
      g.closePath();
      g.fillStyle = repeated ? ink : '#ffffff';
      g.strokeStyle = alpha(t.ink, 0.9);
      g.lineWidth = Math.max(2, 0.04 * k);
      stroke();
      fill();
      g.strokeStyle = g.fillStyle = ink; // it sits on the gem, so nothing above it has to move up
      g.lineWidth = Math.max(1.2, 0.04 * k);
    }
    if (tapped && !note.tied) { // tapped with the picking hand: an arrowhead in the note's colour pointing down onto it
      const scale = note.grace ? 0.6 : 1, w = 0.28 * k * stretch * scale, h = 0.62 * gap * k * scale, tip = onTop + 0.15 * h, top = tip - h;
      g.beginPath();
      g.moveTo(cx, tip);
      g.lineTo(cx + w, top);
      g.lineTo(cx, top + 0.38 * h); // notched at the back
      g.lineTo(cx - w, top);
      g.closePath();
      g.strokeStyle = alpha(t.ink, 0.9);
      g.lineWidth = Math.max(3.5, 0.1 * k);
      stroke();
      g.fillStyle = repeated ? alpha(ink, 0.4) : alpha(shade(c, 0.55), 0.85);
      fill();
      g.strokeStyle = repeated ? ink : c;
      g.lineWidth = Math.max(1.8, 0.05 * k);
      stroke();
      onTop = top;
      above = Math.min(above, onTop - 0.14 * k);
      g.strokeStyle = g.fillStyle = ink;
      g.lineWidth = Math.max(1.2, 0.04 * k);
    }
    const peak = bendPeak(note);
    if (peak > 0) { // bend: chevrons in the note's colour right on top of it, up (and down again for a release)
      const pre = note.bendCurve?.[0]?.[1] > 0, release = (note.bendCurve?.length ?? 0) > 1 && note.bendCurve.at(-1)[1] < peak;
      const count = Math.min(3, Math.max(1, Math.round(peak * 2))), w = hw * k * stretch * 0.6, h = hw * k * 0.3, step = h * 1.25, edge = alpha(t.ink, 0.9);
      let top = onTop - 0.04 * k;
      const stack = (dir) => {
        for (let j = 0; j < count; j++) chevron(g, cx, top - j * step - (dir > 0 ? 0 : h), w, h, dir, repeated ? ink : c, edge);
        top -= count * step + 0.08 * k;
      };
      const way = bendWay(note.string); // the chevrons follow the string: up off the treble strings, down off the bass ones
      if (!pre || !release) stack(-way); // a pre-bend that is let down only needs the way back
      if (release) stack(way);
      const amount = `${pre ? 'pre ' : ''}${bendLabel(peak)}`;
      g.fillStyle = ink;
      scaled(amount, cx + w + 0.08 * k, (cy - hh * k + top) / 2, 0.22 * k, 700, 'left');
      g.fillText(amount, 0, 0);
      unscale();
      g.textAlign = 'center';
      above = Math.min(above, top - 0.1 * k);
    }
    if (note.staccato) { // staccato: a dot
      g.beginPath();
      g.arc(cx, above + 0.04 * k, Math.max(1.5, 0.045 * k), 0, Math.PI * 2);
      fill();
      above -= 0.16 * k;
    }
    // How a note is struck — the accent, the pinch, the slap, the hand that hit it — belongs to the moment of picking,
    // so a tied note carries none of it (as with its triangle above). What it goes on doing — a trill, the bar, a wah,
    // the harmonic it rings as — it keeps
    const struck = !note.tied;
    if (struck && note.accent && (note.accent === 'tenuto' || !chord?.accent)) write({ heavy: '^', tenuto: '–' }[note.accent] ?? '>', 0.3); // an accented chord's frame shows it
    const words = [
      struck && note.tapLeft ? 'm.g.' : '', // a tap with the fretting hand, which Guitar Pro tells apart (the picking hand's has its arrow)
      TEXT_MARKS[note.harmonicType] ?? (struck && note.harmonicPinch ? 'PH' : ''),
      struck && (note.slap ? 'slap' : note.pop ? 'pop' : ''), struck && note.golpe ? `golpe (${note.golpe})` : '', struck && note.rasgueado ? `rasg. ${note.rasgueado}` : '',
      typeof note.trill === 'number' ? `tr ${note.trill}` : '', note.ornament ?? '', note.fade ?? '', note.whammy ? 'w/bar' : '',
      note.wah === 'open' ? 'o' : note.wah === 'closed' ? '+' : '',
    ];
    for (const word of words) if (word) write(word, word.length > 2 ? 0.22 : 0.28);
    if (struck && note.rightFinger) write(note.rightFinger, 0.26, 'italic 700'); // picking-hand finger: p i m a c
    if (note.pick) { // pick stroke: ⊓ down, V up
      const w = 0.09 * k, h = 0.13 * k;
      g.beginPath();
      if (note.pick === 'down') [[-w, h / 2], [-w, -h / 2], [w, -h / 2], [w, h / 2]].forEach(([dx, dy], j) => g[j ? 'lineTo' : 'moveTo'](cx + dx, above + dy));
      else [[-w, -h / 2], [0, h / 2], [w, -h / 2]].forEach(([dx, dy], j) => g[j ? 'lineTo' : 'moveTo'](cx + dx, above + dy));
      stroke();
      above -= 0.22 * k;
    }
    if (note.fermata) { // fermata: an arch over a dot
      g.beginPath();
      g.arc(cx, above + 0.06 * k, 0.14 * k, Math.PI, 0);
      stroke();
      g.beginPath();
      g.arc(cx, above + 0.02 * k, Math.max(1.5, 0.03 * k), 0, Math.PI * 2);
      fill();
      above -= 0.24 * k;
    }
    if (note.tremolo) { // three short slashes under a wavy line, as notation marks a tremolo that isn't counted out
      for (let j = -1; j <= 1; j++) line2(g, cx - 0.12 * k, above + (j * 0.08 + 0.05) * k, cx + 0.12 * k, above + (j * 0.08 - 0.05) * k);
      above -= 0.3 * k;
      squiggle(0.14 * k, 0.04 * k, 1.5);
      above -= 0.14 * k;
    }
    g.globalAlpha = 1;
  }
  lap('notes');

  // A barre being played: its bar across the strings on the board
  const barred = new Set();
  for (const note of visible) {
    const dt = note.time - now, chord = chordOf(note);
    if (!chord?.barre || barred.has(chord) || dt > 0.06 || dt < -Math.max(note.sustain, 0.12)) continue;
    barred.add(chord);
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = Math.max(4, 0.12 * k0);
    const [y0, y1] = [ys(chord.barre.from), ys(chord.barre.to)].sort((p, q) => p - q);
    line3([chord.barre.fret - 0.5, y0 - gap * 0.45, 0], [chord.barre.fret - 0.5, y1 + gap * 0.45, 0]);
  }

  // Where to press, on top of everything on the board: targets fill in as notes approach, finger number and all,
  // and light up while they sound. A spot played again straight after stays lit from the strike before (see markRepeats), so
  // repeated notes and chords hold their targets until the fingering switches instead of flashing on every strike
  const lit = new Set(), outlined = new Set(); // one lit target per spot, however many notes hold it; the spots with a target
  for (const note of visible) {
    const dt = note.time - now, chord = chordOf(note), bent = bending.get(note.string), heldFrom = note.heldFrom ?? null;
    const pressed = dt <= 0.06 || (heldFrom !== null && now >= heldFrom - 0.06);
    const slides = (note.slideTo ?? note.slideUnpitchTo ?? null) !== null;
    if (note.mute || dt > PRESS_AHEAD || dt < -Math.max(note.sustain, slides ? 0.25 : 0.12) || ((chord?.highDensity || heldFrom !== null) && !pressed)) continue;
    if (bent && bent.note !== note && !pressed) continue; // the next note on a string being bent shows once it is let down
    if (pressed && lit.has(`${note.string}:${note.fret}`)) continue;
    if (pressed) lit.add(`${note.string}:${note.fret}`);
    outlined.add(`${note.string}:${note.fret}`);
    const { a, open, x: from } = spot(note), x = slideX(note, from, -dt), y = boardY(note), c = color(note.string);
    const hw = (open ? (a.width - 0.2) / 2 : 0.32) + 2 / k0, hh = (open ? 0.1 : 0.36) * gap + 2 / k0; // 2px bigger than the gem shape
    gem(x, y, 0, hw, hh);
    if (pressed) {
      glow(!ringing(note, dt), c, 14);
      g.fillStyle = c;
      fill();
      glow(false);
      g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      g.lineWidth = 1.5;
      stroke();
    } else {
      const near = (1 - dt / PRESS_AHEAD) ** 2;
      g.globalAlpha = 0.35 * near;
      g.fillStyle = c;
      fill();
      g.globalAlpha = 0.25 + 0.75 * near;
      g.strokeStyle = c;
      g.lineWidth = 2.2;
      stroke();
    }
    // ПАТЧ Пюпитра (1): на метке «куда нажимать» — то же, что на ноте (t.gemLabel 'fret' — лад; иначе палец, как в апстриме):
    // нота «7», долетевшая до грифа, не превращается в «1» (палец позиции)
    const finger = note.finger ?? (chord?.fingers?.[note.string] >= 0 ? chord.fingers[note.string] : null);
    const onTarget = t.gemLabel === 'fret' ? String(note.fret) : finger !== null ? (finger === 0 ? 'T' : String(finger)) : null;
    if (!open && onTarget !== null) label(onTarget, x, y, 0, gap * 0.55, pressed ? marks : t.text, 800, 'center', !pressed || white);
    if (!open && bendPeak(note) > 0) { // a bend: a chevron beyond its target the way the string is pushed, turned round for a pre-bend let down
      const way = bendWay(note.string), letDown = note.bendCurve?.[0]?.[1] > 0 && note.bendCurve.at(-1)[1] < bendPeak(note);
      const [px, py] = P(x, y + way * hh, 0);
      chevron(g, px, py - way * (letDown ? 0.14 : 0.05) * k0, 0.17 * k0 * stretch, 0.085 * k0, (letDown ? 1 : -1) * way, '#ffffff', alpha(t.ink, 0.9));
    }
    g.globalAlpha = 1;
  }
  // An arpeggio's shape, from a moment before it's taken until it's let go: every spot it frets outlined with its finger, so
  // the whole shape is held, not only the note being played (those light up above)
  for (const shape of arr.handShapes ?? []) {
    if (!shape.arpeggio || shape.startTime - now > PRESS_AHEAD || shape.endTime <= now) continue;
    g.globalAlpha = 0.3 + 0.5 * Math.min(1, 1 - (shape.startTime - now) / PRESS_AHEAD) ** 2;
    shape.frets.forEach((fret, s) => {
      if (fret <= 0 || s >= n || outlined.has(`${s}:${fret}`)) return;
      const x = fret - 0.5, y = ys(s), finger = shape.fingers[s];
      gem(x, y, 0, 0.32 + 2 / k0, 0.36 * gap + 2 / k0);
      g.strokeStyle = color(s);
      g.lineWidth = 2.2;
      stroke();
      if (finger >= 0) label(finger === 0 ? 'T' : String(finger), x, y, 0, gap * 0.55, t.text, 800);
    });
    g.globalAlpha = 1;
  }
  lap('targets');


  // The chord name, big, always to the right of the hand position: the chord sounding now, for as long as it sounds,
  // or else the next one, fading in over the second before it
  const spans = chordSpans(arr), current = spans.findLast((sp) => sp.time <= now && now < sp.end + 0.3);
  const upcoming = current ? null : spans.find((sp) => sp.time > now && sp.time - now < 1.2);
  const named = current ?? upcoming;
  if (named) {
    const [rx, ly] = P(cam.right + 0.4, boardHi + 0.5, 0), width = (measure(g, (fonts[700] ??= `700 ${MARK_PX}px ${t.num}`), named.name).width * 52) / MARK_PX;
    g.globalAlpha = current ? 1 : Math.max(0.35, 1 - (named.time - now) / 1.2);
    g.fillStyle = t.text;
    scaled(named.name, Math.min(rx, W - 24 - width), ly, 52, 700, 'left'); // kept on screen at the top of the neck
    g.fillText(named.name, 0, 0);
    unscale();
    g.globalAlpha = 1;
  }
  lap('labels');
}

// The tablature: a card with the strings running across it and each note a bar along its string as long as it's held,
// its fret number at the start and its marks over it as tab writes them. Scrolling, notes come in from the right to a play line
// near the left and fade out well before the string names; in pages, a page of whole bars holds still while the play line
// moves across it. Note speed spaces the notes out, fretboard height the strings
const CARD_TOP = 298; // where the tablature's and the notation's cards begin, clear of the lyrics over them: a switch between the views keeps its place
const TAB_SPEED = 240, TAB_GAP = 64, TAB_LABELS = 100, TAB_EDGE = 24, TAB_FADE = 150; // px a note travels a second; px between strings; px kept for the string names; the card's margin; px over which notes fade out

// Pages of whole bars, as many as fit `length` seconds (one at least), laid out once per arrangement and page length
function tabPages(arr, length) {
  if (arr.tabPages?.length === length) return arr.tabPages.pages;
  const last = arr.notes.at(-1), end = Math.max(last ? last.time + last.sustain : 0, arr.beats.at(-1)?.time ?? 0) + 0.5;
  let edges = arr.beats.filter((b) => b.measure >= 0).map((b) => b.time);
  if (edges.length < 2) edges = Array.from({ length: Math.ceil(end / length) + 1 }, (_, i) => i * length); // no bars: even pages
  edges = [Math.min(0, edges[0]), ...edges.filter((e) => e > 0), Math.max(end, edges.at(-1) + 0.01)];
  const pages = [];
  let start = edges[0];
  for (let i = 1; i < edges.length; i++)
    if (edges[i] - start > length && edges[i - 1] > start) pages.push({ start, end: (start = edges[i - 1]) });
  pages.push({ start, end: edges.at(-1) });
  for (let i = 0; i < pages.length - 1; i++) pages[i].end = pages[i + 1].start;
  arr.tabPages = { length, pages };
  return pages;
}

const color = (t, s) => t.str[s % t.str.length];
// The notation page: the tab as a page of systems, each a run of whole bars stretched across the card, stacked down it.
// Bare fret numbers cut into the string lines, the rhythm on stems under each system, rests on the staff, ties as
// arcs, bar numbers with a dot a beat along the top, the tempo, sections and text over the bars, the meter where it
// stands and changes, the strings named on the first system. The beat being played is boxed in the accent with a
// hairline at the exact moment, a sounding note is in its string's colour, and the page keeps the current system second
// from the top. The systems are the tab's pages (tabPages), so a bar sits where the paged tab put it
const SHEET_SPEED = 110, SHEET_GAP = 15.75; // px a second before a system is stretched to the width; px between strings, 105% of a plain tab's at the height setting's 100%
export function drawSheet(canvas, arr, now, t, cam = {}) {
  const { g, W } = clearCanvas(canvas, t.renderScale); // ПАТЧ (4)
  if (!arr) return;
  const n = arr.strings, sg = SHEET_GAP * (t.boardHeight ?? 1), staffH = sg * (n - 1), marked = (t.tabMarks ?? 'all') === 'all';
  const light = t.paper === 'light', ink = light ? '#15181f' : t.text, faint = light ? '#5c6472' : t.muted; // on paper, the writing is ink and the card white; the grey holds 4.5:1 on it
  const left = TAB_EDGE + 46, right = W - TAB_EDGE - 16, usable = right - left;
  // Notes: a staff over each system, the notes written as music an octave above where a guitar sounds. Room over the
  // staff for the ledger lines a high note needs, and under it for a low one's, down to the tab; the rhythm then goes on
  // the staff's stems rather than under the tab
  // The staff space is six tenths of the tab's string spacing, a shade under engravers' two thirds; the room over the staff
  // is what the song's highest note needs in ledger lines, the room under it what the lowest open string needs, both worked
  // out once a song. The glyphs — clef, accidentals, rests, flags — are Noto Music's, drawn once the face is in and not
  // before (nothing, rather than a text face's likeness); heads, stems, beams and ledger lines are drawn
  const notes = !!t.sheetNotes, sp = sg * 0.6, glyphs = notes && typeof document !== 'undefined' && !!document.fonts?.check(`${4 * sp}px "Noto Music"`, '\u{1D120}');
  const stepOf = (m) => (Math.floor(m / 12) - 1) * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][m % 12]; // a written midi note's line or space: E4, the lowest line, is 30
  if (notes && !arr.sheetRange) { // ledger lines over the staff for the highest note, under it for the lowest string
    let hi = 38;
    for (const note of arr.notes) hi = Math.max(hi, stepOf((arr.open?.[note.string] ?? 40) + note.fret + 12));
    arr.sheetRange = { over: Math.max(2, Math.ceil((hi - 38) / 2) + 1), under: Math.max(6, Math.floor((30 - stepOf((arr.open?.[0] ?? 40) + 12)) / 2) + 2.5) };
  }
  const over = notes ? arr.sheetRange.over : 0, under = notes ? arr.sheetRange.under : 0, noteRoom = notes ? sp * (over + 4 + under) : 0;
  const lyricRow = arr.lyrics?.length ? sg * 1.3 : 0, showMarks = t.tabMarks !== 'notes'; // a row for the words under the rhythm; the marks around a note, unless the Marks setting says just the notes
  const rowTop = 44 + noteRoom, stemLen = sg * 1.3, beamH = Math.max(2, sg * 0.16), pitch = rowTop + staffH + (notes ? sg : stemLen) + lyricRow + sg * 2.8; // a system: the chord names and bar numbers over it, the rhythm and the words under it, room to the next
  const fifths = notes ? (arr.keys?.findLast((k) => k.time <= now)?.fifths ?? 0) : 0, flats = fifths < 0;
  const music = `${4 * sp}px "Noto Music"`, ACC = { 1: ['\u266f', 0.9], '-1': ['\u266d', 0.8], 0: ['\u266e', 0.7] }; // the face's accidentals and their ink widths in spaces
  const prefix = notes ? sp * (0.6 + 2.84 + 0.5 + Math.abs(fifths) * 1.15 + 1) : 0; // the clef and the key signature, before the first beat
  const letters = flats ? [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6] : [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6], accs = flats ? [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0] : [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]; // a pitch class's letter and accidental, spelt the key's way
  const keyAcc = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < Math.abs(fifths); i++) keyAcc[(flats ? [6, 2, 5, 1, 4, 0, 3] : [3, 0, 4, 1, 5, 2, 6])[i]] = flats ? -1 : 1; // B E A D G C F, or F C G D A E B
  const ledgers = new Path2D(), engraved = []; // the ledger lines, thicker than a stem; the glyphs, set in the music face at the end
  if (notes && !arr.sheetShortest) { // the shortest gap between beats, so heads never crowd closer than 1.75 spaces
    let shortest = Infinity;
    const values = arr.rhythm ?? [];
    for (let k = 1; k < values.length; k++) if (values[k].time - values[k - 1].time > 1e-3) shortest = Math.min(shortest, values[k].time - values[k - 1].time);
    arr.sheetShortest = shortest;
  }
  const pxPerSec = notes && arr.sheetShortest < Infinity ? Math.max(SHEET_SPEED, (1.75 * sp) / arr.sheetShortest) : SHEET_SPEED;
  const pages = tabPages(arr, (usable - prefix) / pxPerSec), at = Math.max(0, pages.findLastIndex((p) => p.start <= now));
  // Following, the page turns a system at a time as the beat crosses into the next, the current one second from the top
  // (paused, no frame comes to finish a glide, so it doesn't glide); the wheel scrolls it meanwhile, and alone when it is
  // left to the hand (the scroll setting). Either way it stays on the page
  const cardTop = CARD_TOP, cardBottom = VH - 66; // as the tablature's; over the song's facts
  const lead = cardBottom - cardTop - 22 >= 2 * pitch ? 1 : 0; // a system before the current one, when two fit the card; with the staff on, the one alone
  if (cam.sheetY === undefined || (t.sheetScroll !== 'manual' && cam.sheetAt !== at)) cam.sheetY = Math.max(0, at - lead) * pitch;
  cam.sheetAt = at;
  cam.sheetY = Math.min(Math.max(0, cam.sheetY), Math.max(0, pages.length * pitch + 22 - (cardBottom - cardTop)));
  const pageTop = cardTop + 22 - cam.sheetY, values = arr.rhythm ?? [], middleRow = (n - 1) / 2;
  g.save();
  g.beginPath();
  g.rect(TAB_EDGE, cardTop, W - TAB_EDGE * 2, cardBottom - cardTop);
  g.clip();
  const row = (y0, s) => y0 + (t.stringOrder === 'high' ? n - 1 - s : s) * sg;
  const num = `700 ${fontSize(sg * 0.95)}px ${t.num}`, small = `600 ${fontSize(10.5)}px ${t.ui}`, finger = `700 ${fontSize(sg * 0.55)}px ${t.num}`, words = `italic 600 ${fontSize(11.5)}px ${t.ui}`;
  const lines = new Path2D(), bars = new Path2D(), heavy = new Path2D(), cuts = new Path2D(), stems = new Path2D(), fills = new Path2D(), dots = new Path2D();
  const thin = new Path2D(), dashes = new Path2D(); // the marks: slides, slurs, ties, vibrato, bends; and the dashed runs of a palm mute or a let ring
  const tiny = `600 ${fontSize(9.5)}px ${t.ui}`, chordFont = `600 ${fontSize(12)}px ${t.num}`, chordOf = (note) => (note.chord === null || note.chord === undefined ? null : arr.chords?.[note.chord]);
  const beams = (r) => (r.value >= 8 ? Math.round(Math.log2(r.value)) - 2 : 0);
  const texts = [], fingers = [], lit = [], labels = [], numbers = [], current = { box: null, x: null };
  const repeatAt = new Set((arr.markers ?? []).filter((m) => m.text.startsWith('repeat')).map((m) => Math.round(m.time * 50)));
  const meterAt = new Map((arr.meters ?? []).map((m) => [Math.round(m.time * 50), m.text]));
  g.textAlign = 'center';
  for (let i = 0; i < pages.length; i++) {
    const y0 = pageTop + i * pitch;
    if (y0 + pitch < cardTop) continue;
    if (y0 > cardBottom) break;
    const page = pages[i], scale = (usable - prefix) / (page.end - page.start), X = (time) => left + prefix + (time - page.start) * scale;
    const staffTop = y0 + rowTop, staffBottom = staffTop + staffH, beamY = staffBottom + 5 + stemLen;
    const nBot = staffTop - sp * under, nTop = nBot - 4 * sp, yOf = (step) => nBot - ((step - 30) * sp) / 2; // the staff over the tab: E4, its lowest line, is step 30
    const sysTop = notes ? nTop - sp * over : staffTop; // where the system begins: the bar numbers and what is written over the bars go above it
    for (let s = 0; s < n; s++) {
      lines.moveTo(left, row(staffTop, s));
      lines.lineTo(right, row(staffTop, s));
    }
    if (notes) {
      for (let l = 0; l < 5; l++) {
        lines.moveTo(left, nTop + l * sp);
        lines.lineTo(right, nTop + l * sp);
      }
      bars.moveTo(left, nTop); // one line down the system's left, staff to tab
      bars.lineTo(left, staffBottom);
      const clefX = left + sp * 0.6; // the G clef with its 8, its baseline on the lowest line, then the key's sharps or flats at their steps
      engraved.push(['\u{1D120}', clefX, nBot]);
      const order = flats ? [34, 37, 33, 36, 32, 35, 31] : [38, 35, 39, 36, 33, 37, 34]; // the flats' steps, B E A D G C F, and the sharps', F C G D A E B
      for (let k = 0; k < Math.abs(fifths); k++) engraved.push([ACC[flats ? -1 : 1][0], clefX + sp * (2.84 + 0.5 + k * (flats ? 1.05 : 1.15)), yOf(order[k]) + sp * 0.52]);
    }
    if (i === 0 && arr.open) for (let s = 0; s < n; s++) labels.push([noteName(arr.open[s]), left - 16, row(staffTop, s) + sg * 0.32, color(t, s)]); // the strings, named on the first system alone
    // bars and beats along the top: the bar's number, a dot a beat; a repeat's bar heavy with its two dots; the meter at the first bar and where it changes
    for (let b = firstAt(arr.beats, page.start - 1e-3); b < arr.beats.length && arr.beats[b].time < page.end - 1e-3; b++) {
      const beat = arr.beats[b], x = X(beat.time), key = Math.round(beat.time * 50);
      if (beat.measure < 0) {
        dots.moveTo(x + 1.6, sysTop - 11);
        dots.arc(x, sysTop - 11, 1.6, 0, Math.PI * 2);
        continue;
      }
      const path = repeatAt.has(key) ? heavy : bars;
      path.moveTo(x, staffTop);
      path.lineTo(x, staffBottom);
      if (notes) {
        path.moveTo(x, nTop);
        path.lineTo(x, nBot);
      }
      if (repeatAt.has(key)) for (const s of [middleRow - 0.5, middleRow + 0.5]) {
        dots.moveTo(x + 8.6, row(staffTop, 0) + s * sg);
        dots.arc(x + 7, row(staffTop, 0) + s * sg, 1.6, 0, Math.PI * 2);
      }
      texts.push([small, String(beat.measure), x + 1, sysTop - 8, faint, 'left']);
      const meter = meterAt.get(key) ?? (b === 0 ? arr.meters?.[0]?.text : null);
      if (meter) {
        const [top, bottom] = meter.split('/'), mx = x + 12 + (repeatAt.has(key) ? 6 : 0), big = `600 ${fontSize(staffH * 0.38)}px ${t.num}`;
        texts.push([big, top, mx, staffTop + staffH * 0.45, ink, 'center'], [big, bottom, mx, staffTop + staffH * 0.97, ink, 'center']);
      }
    }
    // over the bars: the section, then the tempo, repeats and text that the file writes there
    let free = -Infinity, chordFree = -Infinity; // where the last text on the marker row ends, and on the chord row
    for (const sec of arr.sections ?? []) if (sec.time >= page.start && sec.time < page.end) {
      const x = X(sec.time) + 1;
      texts.push([words, sec.name, x, sysTop - 34, ink, 'left']); // on the chord row, clear of the palm mutes and let rings
      chordFree = x + measure(g, words, sec.name).width + 16;
    }
    for (const m of arr.markers ?? []) if (m.time >= page.start && m.time < page.end && !m.text.startsWith('repeat') && !/^\d+\/\d+$/.test(m.text)) {
      const x = Math.max(X(m.time) + 1, free);
      texts.push([small, m.text, x, sysTop - 21, m.text.startsWith('♩') ? t.accent : ink, 'left']);
      free = x + measure(g, small, m.text).width + 10;
    }
    // the notes: a number cut into its string, × for a mute, the harmonic's and ghost's brackets, the finger small beside it
    // (Marks); a sounding one in its string's colour; a tie on to the note held into, within the system
    const lastRight = new Map(), lastOn = new Map(), tied = new Set(), spans = { palm: [], ring: [] }; // where the last number on each string ends, and where it is; the notes held into; the palm mutes and let rings gathered into runs
    for (let k = firstAt(arr.notes, page.start - 1e-3); k < arr.notes.length && arr.notes[k].time < page.end - 1e-3; k++) {
      const note = arr.notes[k], x = X(note.time), y = row(staffTop, note.string), grace = note.grace ? 0.72 : 1;
      const bare = note.mute ? '×' : note.harmonic || note.harmonicPinch ? `<${note.fret}>` : note.ghost ? `(${note.fret})` : String(note.fret), str = tied.has(k) ? `(${bare})` : bare; // held over from the note before: in brackets
      const w0 = measure(g, num, str).width * grace, avail = x - (lastRight.get(note.string) ?? -Infinity) - 2; // to its centre from the number before
      const squeeze = Math.min(1, Math.max(0.55, (2 * avail) / w0)); // notes closer than a number is wide: narrower numbers
      const font = grace * squeeze < 1 ? `700 ${fontSize(sg * 0.95 * grace * squeeze)}px ${t.num}` : num, w = measure(g, font, str).width;
      lastRight.set(note.string, x + w / 2);
      cuts.rect(x - w / 2 - 2.5, y - sg * 0.5, w + 5, sg);
      const sounding = note.time <= now && now < note.time + Math.max(note.sustain, 0.15);
      (sounding ? lit : numbers).push([font, str, x, y + measure(g, font, '5').middle, sounding ? color(t, note.string) : ink]);
      if (marked && squeeze === 1 && avail > w0 / 2 + 12 && !note.mute && note.fret > 0 && note.finger !== null && note.finger !== undefined) fingers.push([note.finger === 0 ? 'T' : String(note.finger), x + w / 2 + 2, y + sg * 0.45]);
      if (typeof note.tieTo === 'number') { // on to the note it is held into: an arc under them, that note's number in brackets
        tied.add(note.tieTo);
        if (arr.notes[note.tieTo].time < page.end) { // ponytail: a tie on to the next system is left to the ear
          const tx = X(arr.notes[note.tieTo].time);
          thin.moveTo(x + w / 2, y + sg * 0.45);
          thin.quadraticCurveTo((x + tx) / 2, y + sg * 1.2, tx - w / 2, y + sg * 0.45);
        }
      }
      if (showMarks) {
        // a slide: a slash after the number, rising or falling the way it goes; before it for a slide in
        const to = note.slideTo ?? note.slideUnpitchTo ?? null, dir = to !== null ? Math.sign(to - note.fret) || 1 : note.slideOut === 'up' ? 1 : note.slideOut ? -1 : 0;
        if (dir) {
          thin.moveTo(x + w / 2 + 2, y + dir * sg * 0.32);
          thin.lineTo(x + w / 2 + sg * 0.75, y - dir * sg * 0.32);
        }
        if (note.slideIn) {
          const d = note.slideIn === 'below' ? 1 : -1;
          thin.moveTo(x - w / 2 - sg * 0.75, y + d * sg * 0.32);
          thin.lineTo(x - w / 2 - 2, y - d * sg * 0.32);
        }
        // a hammer-on or pull-off: a slur from the note before on the string, its letter over it
        const prev = lastOn.get(note.string);
        if ((note.hammerOn || note.pullOff) && prev && x - prev.x < sg * 8) {
          thin.moveTo(prev.x, y - sg * 0.55);
          thin.quadraticCurveTo((prev.x + x) / 2, y - sg * 1.5, x, y - sg * 0.55);
          texts.push([tiny, note.hammerOn ? 'H' : 'P', (prev.x + x) / 2, y - sg * 1.05, faint, 'center']);
        }
        if (note.vibrato) for (let vx = x - w / 2; vx <= x + w / 2 + 1; vx += 2) thin[vx === x - w / 2 ? 'moveTo' : 'lineTo'](vx, y - sg * 0.62 + Math.sin((vx - x) / 1.6) * 1.4); // the wave over it
        const peak = bendPeak(note);
        if (peak > 0) { // a bend: the arrow up from the number, and how far
          const ax = x + w / 2 + sg * 0.6, ay = y - sg * 1.25;
          thin.moveTo(x + w / 2 + 1, y - sg * 0.15);
          thin.quadraticCurveTo(ax, y - sg * 0.5, ax, ay);
          thin.moveTo(ax - 3, ay + 4);
          thin.lineTo(ax, ay);
          thin.lineTo(ax + 3, ay + 4);
          texts.push([tiny, bendLabel(peak), ax, ay - 3, ink, 'center']);
        }
        const chord = chordOf(note);
        for (const [kind, on] of [['palm', note.palmMute || chord?.palmMute], ['ring', note.letRing]]) if (on) { // runs of them, written over the bars once the system is gathered
          const last = spans[kind].at(-1);
          if (last && note.time - last.end < 0.8) Object.assign(last, { end: note.time, x1: x + w / 2 });
          else spans[kind].push({ x0: x - w / 2, x1: x + w / 2, end: note.time });
        }
        if (chord?.name && chord.notes[0] === k) { // the chord's name where it changes
          const before = arr.chords[note.chord - 1];
          if (!before || note.time - before.time > 1 || before.name !== chord.name) texts.push([chordFont, chord.name, Math.max(x - w / 2, chordFree), sysTop - 34, ink, 'left']); // past a section's name at the same bar
        }
      }
      lastOn.set(note.string, { x, y });
    }
    for (const [kind, label] of [['palm', 'P.M.'], ['ring', 'let ring']]) for (const span of spans[kind]) { // the label, a dashed line to the run's end, a tick to close it
      const lw = measure(g, tiny, label).width;
      texts.push([tiny, label, span.x0, sysTop - 21, faint, 'left']);
      if (span.x1 > span.x0 + lw + 8) {
        dashes.moveTo(span.x0 + lw + 4, sysTop - 24);
        dashes.lineTo(span.x1, sysTop - 24);
        thin.moveTo(span.x1, sysTop - 27);
        thin.lineTo(span.x1, sysTop - 21);
      }
    }
    if (arr.lyrics?.length) { // the words under the rhythm, a syllable at its note, never on top of the one before
      let wordFree = -Infinity;
      for (let k = firstAt(arr.lyrics, page.start - 1e-3); k < arr.lyrics.length && arr.lyrics[k].time < page.end - 1e-3; k++) {
        const x = Math.max(X(arr.lyrics[k].time), wordFree);
        texts.push([small, arr.lyrics[k].text, x, staffBottom + (notes ? sg : stemLen) + sg * 1.55, faint, 'left']);
        wordFree = x + measure(g, small, arr.lyrics[k].text).width + 5;
      }
    }
    // with Notes on, every note's head at its written pitch on the staff over the tab, an accidental where it leaves the
    // key (holding to the bar's end, per letter — ponytail: engravers keep it per letter and octave), ledger lines past
    // the staff, a sounding head in its string's colour; the stems, beams, flags, dots and rests then sit on the staff
    const heads = new Map();
    if (notes) {
      const state = [...keyAcc];
      let bb0 = Math.max(0, firstAt(arr.beats, page.start) - 1);
      for (let k = firstAt(arr.notes, page.start - 1e-3); k < arr.notes.length && arr.notes[k].time < page.end - 1e-3; k++) {
        const note = arr.notes[k], x = X(note.time), m = (arr.open?.[note.string] ?? 40) + note.fret + 12, pc = m % 12;
        const step = (Math.floor(m / 12) - 1) * 7 + letters[pc], y = yOf(step), r = sp * (note.grace ? 0.35 : 0.5); // a head a space wide, a shade under Bravura's 1.18: the owner's eye
        while (arr.beats[bb0 + 1]?.time <= note.time + 1e-4) if (arr.beats[++bb0].measure >= 0) state.splice(0, 7, ...keyAcc); // a new bar: the key's own again
        const sounding = note.time <= now && now < note.time + Math.max(note.sustain, 0.15);
        heads.set(k, { x, y, r, step });
        if (sounding) lit.push(['head', x, y, r, color(t, note.string)]);
        else {
          fills.moveTo(x + r, y);
          fills.ellipse(x, y, r, r * 0.81, -0.35, 0, Math.PI * 2);
        }
        for (let ledger = 28; ledger >= step; ledger -= 2) { ledgers.moveTo(x - sp * 0.9, yOf(ledger)); ledgers.lineTo(x + sp * 0.9, yOf(ledger)); }
        for (let ledger = 40; ledger <= step; ledger += 2) { ledgers.moveTo(x - sp * 0.9, yOf(ledger)); ledgers.lineTo(x + sp * 0.9, yOf(ledger)); }
        if (state[letters[pc]] !== accs[pc]) { // a quarter space clear of the head's edge
          state[letters[pc]] = accs[pc];
          const [glyph, w] = ACC[accs[pc]];
          engraved.push([glyph, x - sp * (0.5 + 0.25 + w + 0.2), y + sp * 0.52]);
        }
      }
    }
    // the rhythm: under the system, a stem down from the tab for each beat; with Notes on, a stem from the beat's heads
    // on the staff, up from below its middle line and down from above it. Beamed with its beat's, flagged alone, dotted,
    // and a rest where nothing is played. ponytail: the beat runs are grouped as the tab's lane groups them; one helper
    // would serve both
    const run = [];
    let levels = 0, unit = -1, bb = Math.max(0, firstAt(arr.beats, page.start) - 1);
    const midY = nTop + 2 * sp;
    const flush = () => {
      if (!run.length) return;
      // Under the tab the beams stack up from the stems' feet. On the staff a run's direction is its heads' majority, its
      // stems go from the outermost head's centre to a flat beam half a space thick — three and a half spaces from the
      // heads' mean, two and a half at least from the nearest — and the levels stack inward a quarter space apart; a
      // lone stem takes its flags from the face, hung from its end
      const up = notes ? run.filter((e) => e.up).length * 2 >= run.length : false, dir = notes ? (up ? 1 : -1) : -1;
      const thick = notes ? sp * 0.5 : beamH, gap = notes ? sp * 0.25 : beamH * 0.6;
      let tip = beamY;
      if (notes) {
        for (const e of run) {
          e.sx = e.x + (up ? sp * 0.44 : -sp * 0.44);
          e.sy = up ? e.lo : e.hi;
          e.tip = up ? Math.min(e.hi - sp * 3.5, midY) : Math.max(e.lo + sp * 3.5, midY);
        }
        const ys = run.map((e) => e.sy), mean = ys.reduce((a, b) => a + b, 0) / ys.length;
        tip = run.length === 1 ? run[0].tip + (beams(run[0].r) > 2 ? dir * -sp * 0.58 : 0) : up ? Math.min(mean - sp * 3.5, Math.min(...run.map((e) => e.hi)) - sp * 2.5) : Math.max(mean + sp * 3.5, Math.max(...run.map((e) => e.lo)) + sp * 2.5);
      }
      for (const e of run) { // every stem of the run, to the beam
        stems.moveTo(e.sx, e.sy);
        stems.lineTo(e.sx, tip);
      }
      for (let l = 0; run.length > 1 && l < levels; l++) {
        const y = tip + dir * l * (thick + gap) - (dir < 0 ? thick : 0);
        let start = -1;
        for (let k = 0; k <= run.length; k++) {
          const has = k < run.length && beams(run[k].r) > l;
          if (has && start < 0) start = k;
          if (has || start < 0) continue;
          const x0 = run[start].sx - (notes ? sp * 0.06 : 0), x1 = run[k - 1].sx + (notes ? sp * 0.06 : 0), alone = start === k - 1, let_ = notes ? sp * 1.1 : sg * 0.8;
          fills.rect(alone && start ? x1 - let_ : x0, y, alone ? let_ : x1 - x0, thick);
          start = -1;
        }
      }
      if (run.length === 1 && beams(run[0].r)) {
        const e = run[0];
        if (!notes) for (let l = 0; l < beams(e.r); l++) fills.rect(e.x, tip - l * (thick + gap) - thick, sg * 0.8, thick); // a foot a level, to the right, as tab writes a lone flag
        else engraved.push(['\u{1D165}' + ['\u{1D16E}', '\u{1D16F}', '\u{1D170}'][Math.min(3, beams(e.r)) - 1], e.sx - sp * 0.06, e.sy + sp * 0.54, up ? 1 : -1, e.sy]); // the face's stem and flag, on the drawn stem; a down stem is the pair turned over
      }
      run.length = levels = 0;
    };
    for (let k = Math.max(0, firstAt(values, page.start) - 1); k < values.length; k++) {
      const r = values[k];
      if (r.time >= page.end - 1e-3) break;
      if (r.time < page.start - 1e-3) continue;
      const x = X(r.time), u = (sg * 1.1) / 20;
      while (arr.beats[bb + 1]?.time <= r.time + 1e-4) bb++;
      if (bb !== unit || r.rest) flush();
      unit = bb;
      if (r.rest && notes) { // a whole rest hangs under the fourth line and a half sits on the middle line, drawn; the rest from the face, centred on the staff
        if (r.value <= 2) fills.rect(x - sp * 0.6, r.value === 1 ? nTop + sp : nTop + sp * 1.5, sp * 1.2, sp * 0.5);
        else {
          const which = Math.min(3, Math.round(Math.log2(r.value)) - 2), w = [1.03, 1.05, 1.32, 1.6][which];
          engraved.push([['\u{1D13D}', '\u{1D13E}', '\u{1D13F}', '\u{1D140}'][which], x - sp * 0.2 - (w * sp) / 2, nBot]);
        }
        continue;
      }
      if (r.rest) { // on the tab's middle
        const my = staffTop + middleRow * sg;
        if (r.value <= 2) fills.rect(x - 6 * u, my - (r.value === 1 ? 5 : 0) * u, 12 * u, 5 * u);
        else {
          stems.moveTo(x + (r.value === 4 ? -3 : 4) * u, my + (r.value === 4 ? -10 : -7) * u);
          if (r.value > 4) stems.lineTo(x - 3 * u, my + 9 * u);
          else for (const [dx, dy] of [[3, -3], [-3, 3], [4, 9]]) stems.lineTo(x + dx * u, my + dy * u);
          for (let l = 0; l < beams(r); l++) {
            fills.moveTo(x + (4 - l * 1.6) * u, my + (-5 + l * 5) * u);
            fills.arc(x + (2 - l * 1.6) * u, my + (-5 + l * 5) * u, 2 * u, 0, Math.PI * 2);
          }
        }
        continue;
      }
      let entry = { r, x, stems, up: false, lo: staffBottom + 5, hi: staffBottom + 5, sx: x, sy: staffBottom + 5, tip: beamY };
      if (notes) { // the beat's heads: the stem from the outermost, up from below the middle line, hollow for a half or longer
        const struck = [];
        for (let q = firstAt(arr.notes, r.time - 1e-3); q < arr.notes.length && arr.notes[q].time <= r.time + 1e-3; q++) if (heads.has(q) && !arr.notes[q].grace) struck.push(heads.get(q));
        if (!struck.length) continue;
        const ys = struck.map((q) => q.y), lo = Math.max(...ys), hi = Math.min(...ys), up = Math.abs(lo - midY) >= Math.abs(hi - midY); // the head farthest from the middle line decides
        entry = { r, x, stems, up, lo, hi, sx: x + (up ? sp * 0.44 : -sp * 0.44), sy: up ? lo : hi, tip: up ? Math.min(hi - sp * 3.5, midY) : Math.max(lo + sp * 3.5, midY) };
        if (r.value <= 2) for (const q of struck) { cuts.moveTo(q.x + sp * 0.32, q.y); cuts.ellipse(q.x, q.y, sp * 0.32, sp * 0.17, -0.6, 0, Math.PI * 2); } // hollow: cut back out
        for (const q of struck) for (let d = 0; d < r.dots; d++) { // beside each head, in its space or the one over its line
          const dy = q.step % 2 === 0 ? -sp * 0.5 : 0;
          fills.moveTo(q.x + sp * (1.2 + d * 0.5) + sp * 0.2, q.y + dy);
          fills.arc(q.x + sp * (1.2 + d * 0.5), q.y + dy, sp * 0.2, 0, Math.PI * 2);
        }
      } else {
        for (let d = 0; d < r.dots; d++) { // by the foot
          fills.moveTo(x + sg * 0.5 + d * sg * 0.4 + sg * 0.13, beamY - sg * 0.4);
          fills.arc(x + sg * 0.5 + d * sg * 0.4, beamY - sg * 0.4, sg * 0.13, 0, Math.PI * 2);
        }
      }
      if (r.value === 1) { flush(); continue; } // a whole note has no stem
      if (!beams(r)) {
        flush();
        stems.moveTo(entry.sx, entry.sy);
        stems.lineTo(entry.sx, entry.tip);
      } else {
        run.push(entry);
        levels = Math.max(levels, beams(r));
      }
    }
    flush();
    if (i === at) { // the beat being played, boxed across the staff and its stem, and the moment itself
      const k = Math.max(0, firstAt(values, now + 1e-4) - 1), r = values[k];
      if (r && r.time >= page.start - 1e-3 && r.time < page.end) {
        const next = values[k + 1] && values[k + 1].time < page.end ? values[k + 1].time : page.end, x0 = X(r.time) - sg * (notes ? 1 : 0.75), x1 = X(next) - sg * (notes ? 0.3 : 0.35);
        const top = notes ? sysTop - sg * 0.5 : staffTop - sg * 0.7;
        if (t.beatBox !== false) current.box = [x0, top, Math.max(x1 - x0, sg * 1.5), staffBottom + sg * 0.5 - top + (notes ? 0 : stemLen * 0.45 + sg * 0.2)]; // the beat, filled (Settings)
      }
      current.x = [X(Math.min(now, page.end)), (notes ? sysTop : staffTop) - sg * 0.5, staffBottom + sg * 0.5];
    }
  }
  // the lines and bars, then the rhythm; the numbers cut into the lines, and the numbers themselves; the box; the card under it all
  g.lineCap = 'butt';
  g.strokeStyle = alpha(ink, 0.42);
  g.lineWidth = notes ? Math.max(1, sp * 0.13) : 1;
  g.stroke(lines);
  g.strokeStyle = alpha(ink, 0.7);
  g.lineWidth = notes ? Math.max(1.2, sp * 0.16) : 1.2;
  g.stroke(bars);
  g.lineWidth = notes ? sp * 0.5 : 3;
  g.stroke(heavy);
  g.fillStyle = faint;
  g.fill(dots);
  g.strokeStyle = g.fillStyle = ink;
  g.lineWidth = notes ? Math.max(1, sp * 0.12) : Math.max(1.2, sg * 0.09);
  g.stroke(stems);
  g.lineWidth = Math.max(1, sp * 0.16);
  g.stroke(ledgers);
  g.lineCap = 'round';
  g.fill(fills);
  g.strokeStyle = ink;
  g.lineWidth = 1.1;
  g.stroke(thin);
  g.setLineDash([4, 3]);
  g.stroke(dashes);
  g.setLineDash([]);
  if (glyphs) { // the face's glyphs, each at its baseline; a down stem's flag is the pair turned over on its head
    g.font = music;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    for (const [glyph, x, y, dir, at] of engraved) {
      if (dir === -1) {
        g.save();
        g.translate(x, at);
        g.scale(1, -1);
        g.fillText(glyph, 0, sp * 0.54);
        g.restore();
      } else g.fillText(glyph, x, y);
    }
  }
  g.globalCompositeOperation = 'destination-out';
  g.fill(cuts);
  g.globalCompositeOperation = 'source-over';
  for (const [font, str, x, y, fill, align] of texts) { // a font at a time would be cheaper; the page's few labels are not worth the sort
    g.font = font;
    g.fillStyle = fill;
    g.textAlign = align;
    g.fillText(str, x, y);
  }
  g.textAlign = 'center';
  g.font = num;
  g.fillStyle = ink;
  for (const [font, str, x, y] of numbers) {
    if (font !== num) g.font = font;
    g.fillText(str, x, y);
    if (font !== num) g.font = num;
  }
  g.font = finger;
  g.textAlign = 'left';
  g.globalAlpha = 0.7;
  for (const [str, x, y] of fingers) g.fillText(str, x, y);
  g.globalAlpha = 1;
  g.textAlign = 'center';
  for (const [font, str, x, y, c] of lit) { // sounding: its string's colour, lit — a number, or a head on the staff
    // ПАТЧ Пюпитра (9): без размытия тени (инв. 19) — ореол полупрозрачной обводкой под знаком
    g.fillStyle = c;
    g.strokeStyle = alpha(c, 0.35);
    g.lineWidth = 6;
    if (font === 'head') {
      g.beginPath();
      g.ellipse(str, x, y, y * 0.81, -0.35, 0, Math.PI * 2);
      g.stroke();
      g.fill();
    } else {
      g.font = font;
      g.strokeText(str, x, y);
      g.fillText(str, x, y);
    }
  }
  g.font = small;
  for (const [str, x, y, c] of labels) {
    g.fillStyle = c;
    g.fillText(str, x, y);
  }
  if (current.box) { // the beat column: a fill, edged faintly, so it never cuts through the ink
    g.strokeStyle = alpha(t.accent, 0.35);
    g.fillStyle = alpha(t.accent, 0.1);
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(...current.box, 4);
    g.fill();
    g.stroke();
  }
  if (current.x) { // the moment itself: a rounded marker down the system, as Songsterr draws it
    const [x, y0, y1] = current.x, w = sg * 0.9;
    g.strokeStyle = t.accent;
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(x - w / 2, y0, w, y1 - y0, w / 2);
    g.stroke();
  }
  g.restore();
  g.globalCompositeOperation = 'destination-over';
  g.beginPath();
  g.roundRect(TAB_EDGE, cardTop, W - TAB_EDGE * 2, cardBottom - cardTop, 16);
  g.fillStyle = light ? '#ffffff' : alpha(t.ink, 0.72);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = light ? '#d3d7df' : t.chipBorder;
  g.lineWidth = 1;
  g.stroke();
  lap('sheet');
}

export function drawTab(canvas, arr, now, t) {
  const { g, W } = clearCanvas(canvas, t.renderScale); // ПАТЧ (4)
  if (!arr) return;
  const n = arr.strings, gap = Math.min(TAB_GAP, 320 / Math.max(1, n - 1)) * (t.boardHeight ?? 1);
  const cardTop = CARD_TOP, top = cardTop + gap * 2.2, bottom = top + gap * (n - 1), cardBottom = bottom + gap * 1.45;
  const beamY = top - gap * 1.55, stem = Math.min(20, gap * 0.32); // the rhythm's beam line, and how far its stems hang to the note heads
  const row = (s) => top + (t.stringOrder === 'high' ? n - 1 - s : s) * gap; // as the highway: low E on top, or high e as in tab
  const speed = TAB_SPEED * (t.noteSpeed ?? 1), paged = t.tabLayout === 'pages';
  const marked = (t.tabMarks ?? 'all') === 'all', bare = t.tabMarks === 'notes'; // fingering, and then everything written around a note: the marks setting
  const left = TAB_LABELS + 30, right = W - TAB_EDGE - 30;
  // In pages, a strip on the right shows how the next page starts, faded and at the page's own spacing, so the notes after
  // the turn are there to read before it
  const peek = paged ? Math.min(170, (right - left) * 0.14) : 0, pageRight = right - (paged ? peek + 24 : 0);
  let X, playX, from, to, upcoming = null;
  if (paged) {
    const pages = tabPages(arr, (pageRight - left) / speed), at = Math.max(0, pages.findLastIndex((p) => p.start <= now)), page = pages[at];
    const scale = (pageRight - left) / (page.end - page.start); // px a second on this page
    X = (time) => left + (time - page.start) * scale;
    [from, to] = [page.start, page.end - 0.001];
    playX = X(Math.min(Math.max(now, page.start), page.end));
    if (pages[at + 1]) upcoming = { start: pages[at + 1].start, scale };
  } else {
    playX = Math.max(TAB_LABELS + TAB_FADE + 60, W * 0.2);
    X = (time) => playX + (time - now) * speed;
    [from, to] = [now - (playX - TAB_LABELS) / speed, now + (W - playX) / speed];
  }
  const color = (s) => t.str[s % t.str.length];
  const chordOf = (note) => (note.chord === null || note.chord === undefined ? null : arr.chords[note.chord]);
  const line = (x1, y1, x2, y2) => {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  const arrowhead = (x, y, dx, dy) => { // at (x, y), pointing along (dx, dy)
    const len = Math.hypot(dx, dy), [ux, uy] = [dx / len, dy / len];
    line(x, y, x - 6 * ux - 4 * uy, y - 6 * uy + 4 * ux);
    line(x, y, x - 6 * ux + 4 * uy, y - 6 * uy - 4 * ux);
  };
  const past = (x) => (x >= playX - 1 ? 1 : 0.4);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.textBaseline = 'alphabetic';
  // Everything drawn along the time between from and to: bars, strings, hand positions and dynamics, notes and their marks.
  // Drawn once for the view, and in pages once more for the next page's strip. clip: [left, right] to keep to, or none
  const glowing = [];
  const drawSpan = (clip) => {
    if (clip) { // notes held over from the page before, or on into the next, end at its edges
      g.save();
      g.beginPath();
      g.rect(clip[0], 0, clip[1] - clip[0], VH);
      g.clip();
    }

    // Bar lines with their numbers and the bar markings beside them (tempo, time, key, repeats, jumps, text), fainter beats,
    // and the strings: quiet, so the notes carry the colour
    const small = `600 ${fontSize(Math.min(15, gap * 0.26))}px ${t.num}`, words = `700 ${fontSize(Math.min(13, gap * 0.22))}px ${t.num}`;
    const barAt = new Map();
    g.font = small;
    g.textAlign = 'left';
    const bars = new Path2D(), beats = new Path2D();
    g.fillStyle = t.muted;
    for (let b = firstAt(arr.beats, from - 1); b < arr.beats.length; b++) {
      const beat = arr.beats[b];
      if (beat.time > to) break;
      const x = X(beat.time), bar = beat.measure >= 0, lines = bar ? bars : beats;
      lines.moveTo(x, top - gap * 0.35);
      lines.lineTo(x, bottom + gap * 0.35);
      if (!bar) continue;
      g.fillText(String(beat.measure), x + 6, cardTop + gap * 0.3);
      barAt.set(Math.round(beat.time * 50), measure(g, small, String(beat.measure)).width + 16);
    }
    g.lineWidth = 1;
    g.strokeStyle = alpha(t.text, 0.05);
    g.stroke(beats);
    g.lineWidth = 1.5;
    g.strokeStyle = alpha(t.text, 0.16);
    g.stroke(bars);
    g.fillStyle = t.accent;
    const markings = new Map();
    for (const m of arr.markers ?? []) if (m.time >= from && m.time <= to) markings.set(Math.round(m.time * 50), [...(markings.get(Math.round(m.time * 50)) ?? []), m.text]);
    for (const [key, texts] of markings) g.fillText([...new Set(texts)].join('  ·  '), X(key / 50) + 6 + (barAt.get(key) ?? 0), cardTop + gap * 0.3);
    g.strokeStyle = alpha(t.text, 0.14);
    g.beginPath();
    for (let s = 0; s < n; s++) {
      g.moveTo(TAB_LABELS, row(s));
      g.lineTo(W - TAB_EDGE, row(s));
    }
    g.stroke();

    // Under the strings: where the hand moves to (unless the guides are off), dynamics, and crescendo and diminuendo wedges
    const handY = bottom + gap * 0.92, dynamicsY = bottom + gap * 1.24; // clear of the bottom string's notes and their ties
    if (t.guides !== false && !bare) {
      g.font = small;
      g.fillStyle = g.strokeStyle = t.anchorLane;
      g.lineWidth = 2;
      let free = -Infinity; // where the last label ends: a move too soon after it, under that label, isn't shown
      const anchors = arr.anchors ?? [];
      for (let i = Math.max(1, firstAt(anchors, from)); i < anchors.length && anchors[i].time <= to; i++) {
        const a = anchors[i], x = X(a.time);
        if (x < free) continue;
        const text = `fret ${a.fret}`;
        g.globalAlpha = past(x);
        line(x, bottom + gap * 0.6, x, handY - 2);
        g.fillText(text, x + 5, handY);
        free = x + 5 + measure(g, small, text).width + 8;
      }
      g.globalAlpha = 1;
    }
    g.strokeStyle = t.text;
    g.lineWidth = 1.5;
    for (const pin of bare ? [] : arr.hairpins ?? []) {
      if (pin.endTime < from || pin.time > to) continue;
      const x0 = X(pin.time), x1 = Math.max(x0 + 30, X(pin.endTime)), [tip, mouth] = pin.kind === 'cresc' ? [x0, x1] : [x1, x0];
      g.globalAlpha = past(x1);
      g.beginPath();
      g.moveTo(mouth, dynamicsY - 11);
      g.lineTo(tip, dynamicsY - 5);
      g.lineTo(mouth, dynamicsY + 1);
      g.stroke();
    }
    g.globalAlpha = 1;

    const size = fontSize(Math.min(26, gap * 0.42)), h = size * 1.3, pad = size * 0.32, round = t.gem === 'pill' ? h / 2 : 5;
    const fonts = { note: `700 ${size}px ${t.num}`, grace: `700 ${fontSize(size * 0.72)}px ${t.num}`, finger: `700 ${fontSize(size * 0.5)}px ${t.num}` };
    const white = t.markings === 'white';

    // Over the strings, the rhythm as tab writes it: a stem down to each beat's head, beamed with the beats it shares a
    // beat with, flagged where it stands alone, dotted, and a rest where nothing is played. It all goes into two paths,
    // one filled and one stroked, so a lane of any length costs two draws. Quiet, like the bar lines: the notes carry
    // the colour
    const rhythm = arr.rhythm, at = (r) => X(r.time) + h / 2; // over the middle of the note's bar, where its fret number is
    if (rhythm?.length) {
      const fills = new Path2D(), strokes = new Path2D(), headR = Math.max(2.5, gap * 0.055);
      const beamH = Math.max(2, gap * 0.045), stub = Math.max(5, gap * 0.13), u = stem / 20; // the rests are drawn 20 px tall and scaled
      const beams = (r) => (r.value >= 8 ? Math.round(Math.log2(r.value)) - 2 : 0); // an eighth carries one beam, a sixteenth two
      const dot = (x, y, d) => {
        fills.moveTo(x + d, y);
        fills.arc(x, y, d, 0, Math.PI * 2);
      };
      const rest = (x, r) => { // a bar for a whole or a half, the zigzag for a quarter, a slanted stem with a blob a beam below that
        if (r.value <= 2) return fills.rect(x - 7 * u, beamY + stem * (r.value === 1 ? 0.3 : 0.62), 14 * u, 5 * u);
        strokes.moveTo(x + (r.value === 4 ? -3 : 4) * u, beamY + (r.value === 4 ? 2 : 3) * u);
        if (r.value > 4) strokes.lineTo(x - 3 * u, beamY + 19 * u);
        else for (const [dx, dy] of [[3, 9], [-3, 15], [4, 21]]) strokes.lineTo(x + dx * u, beamY + dy * u);
        for (let i = 0; i < beams(r); i++) dot(x + (2 - i * 1.6) * u, beamY + (5 + i * 5) * u, 2 * u);
      };
      const head = (x, r) => {
        const y = beamY + stem;
        if (r.value >= 4) dot(x, y, headR);
        else {
          strokes.moveTo(x + headR, y);
          strokes.arc(x, y, headR, 0, Math.PI * 2); // a half or longer is written hollow
        }
        if (r.value > 1) {
          strokes.moveTo(x, beamY);
          strokes.lineTo(x, y - headR * 0.7); // a whole note carries no stem
        }
      };
      const run = [], tuplets = [];
      let levels = 0, tuplet = 0;
      const flush = () => {
        for (let l = 0; l < levels; l++) { // a beam over the beats that share its level, a stub where one stands alone
          let start = -1;
          for (let i = 0; i <= run.length; i++) {
            const has = i < run.length && beams(run[i]) > l;
            if (has && start < 0) start = i;
            if (has || start < 0) continue;
            const x0 = at(run[start]);
            fills.rect(start === i - 1 && start ? x0 - stub : x0, beamY + l * beamH * 2, Math.max(at(run[i - 1]) - x0, stub), beamH); // one alone after others: its stub points back
            start = -1;
          }
        }
        if (tuplet && run.length > 1) tuplets.push([(at(run[0]) + at(run.at(-1))) / 2, String(tuplet)]);
        run.length = levels = tuplet = 0;
      };
      let unit = -1, b = Math.max(0, firstAt(arr.beats, from) - 1); // the beat a run is in: walked along, as the rhythm is in time too
      for (let i = Math.max(0, firstAt(rhythm, from) - 1); i < rhythm.length; i++) {
        const r = rhythm[i], x = at(r);
        if (r.time > to) break;
        while (arr.beats[b + 1]?.time <= r.time + 1e-4) b++; // beamed no further than the beat they are in
        if (b !== unit || r.rest) flush();
        unit = b;
        if (r.rest) rest(x, r);
        else {
          head(x, r);
          if (!beams(r)) flush();
          else {
            run.push(r);
            levels = Math.max(levels, beams(r));
            tuplet ||= r.tuplet;
          }
        }
        for (let d = 0; d < r.dots; d++) dot(x + headR * (2.2 + d * 1.5), beamY + stem + headR * 0.8, Math.max(1.3, headR * 0.45));
      }
      flush();
      g.fillStyle = g.strokeStyle = t.muted;
      g.lineWidth = Math.max(1.2, gap * 0.022);
      g.stroke(strokes);
      g.fill(fills);
      if (tuplets.length) { // three in the time of two: the number over the beam
        g.font = words;
        g.textAlign = 'center';
        for (const [x, count] of tuplets) g.fillText(count, x, beamY - beamH * 2);
        g.textAlign = 'left';
      }
    }


    // An arpeggio's shape, held while its notes are played one at a time: a dashed outline round the strings it holds, named
    for (const shape of bare ? [] : arr.handShapes ?? []) {
      if (!shape.arpeggio || shape.endTime < from || shape.startTime > to) continue;
      const rows = shape.frets.flatMap((f, s) => (f >= 0 && s < n ? [row(s)] : []));
      if (!rows.length) continue;
      const x0 = X(shape.startTime) - 12, x1 = X(shape.endTime);
      g.globalAlpha = past(x1);
      g.strokeStyle = alpha(t.text, 0.4);
      g.lineWidth = 1.5;
      g.setLineDash([6, 5]);
      g.beginPath();
      g.roundRect(x0, Math.min(...rows) - h / 2 - 6, x1 - x0, Math.max(...rows) - Math.min(...rows) + h + 12, 8);
      g.stroke();
      g.setLineDash([]);
      if (shape.name) {
        g.font = `700 ${fontSize(Math.min(24, gap * 0.4))}px ${t.num}`;
        g.fillStyle = t.text;
        g.fillText(shape.name, x0, top - gap * 0.72);
      }
    }
    g.globalAlpha = 1;

    // Room kept between a bar and the next note on its string: for its slide's slash, and the next one's bracket, slide in or string number
    const slides = (note) => (note.slideTo ?? note.slideUnpitchTo ?? null) !== null || !!note.slideOut;
    const bracketed = (note) => { const chord = chordOf(note); return !!chord && !note.repeat && !chord.highDensity && chord.notes.length > 1; };
    const room = (note, next) => (bare ? 4 : 4 + (slides(note) ? 16 : 0) + (bracketed(next) ? 10 : 0) + (next.slideIn ? 18 : 0) + (next.showString ? 20 : 0)); // nothing between them to keep room for, once the marks are off
    // Marks stack up over a note: markX is its middle, markY the top of the stack so far
    let markX = 0, markY = 0;
    const stack = (height, draw) => {
      draw(markY - height / 2);
      markY -= height + 3;
    };
    const wordFonts = { '': words, 'italic ': `italic ${words}` };
    const word = (str, style = '') => stack(10, (my) => {
      g.font = wordFonts[style];
      g.fillText(str, markX, my + 5);
    });
    const { next: nexts, prev: prevs, held } = stringLinks(arr), previous = new Map(), framed = new Set(), numbers = [], marks = [];
    for (let i = firstAt(arr.notes, from - held - 0.5); i < arr.notes.length; i++) {
      const note = arr.notes[i];
      if (note.time > to) break;
      if (X(note.time + note.sustain) < TAB_LABELS - 40 - h * 4) continue; // long gone past the play line: faded out, not worth measuring
      if (clip && note.time < from && X(note.time + note.sustain) - 2 <= X(from) && typeof note.tieTo !== 'number') continue; // over by this page's start: its tail would show at the edge
      const chord = chordOf(note), grace = note.grace ? 0.72 : 1, nh = h * grace, y = row(note.string), c = color(note.string), x0 = X(note.time);
      const muted = note.mute || chord?.fretHandMute, palm = note.palmMute || chord?.palmMute, repeated = note.repeat || chord?.highDensity;
      const text = muted ? '×' : note.harmonic || note.harmonicPinch ? `<${note.fret}>` : note.ghost ? `(${note.fret})` : String(note.fret);
      const fingerOf = note.finger ?? (chord?.fingers?.[note.string] >= 0 ? chord.fingers[note.string] : null);
      const finger = !marked || muted || note.fret === 0 || fingerOf === null ? '' : fingerOf === 0 ? 'T' : String(fingerOf);
      const font = note.grace ? fonts.grace : fonts.note;
      const textWidth = measure(g, font, text).width, fingerWidth = finger ? measure(g, fonts.finger, finger).width + 3 : 0;
      const next = arr.notes[nexts[i]], until = next ? X(next.time) - room(note, next) : Infinity; // bars end short of the next note on the string
      const w = Math.min(Math.max(nh, textWidth + fingerWidth + pad * 2 * grace), Math.max(10, until - x0));
      const x1 = Math.max(x0 + w, Math.min(X(note.time + note.sustain) - 2, until)), cx = x0 + w / 2;
      const squeeze = Math.min(1, (w - 4) / (textWidth + fingerWidth)); // notes closer than a number is wide: narrower numbers
      const last = previous.get(note.string) ?? (prevs[i] >= 0 ? { x0: X(arr.notes[prevs[i]].time), w: h } : null); // one dropped as gone: its number's place is near enough
      previous.set(note.string, { x0, w });
      if (x1 < TAB_LABELS - 40 && typeof note.tieTo !== 'number') continue;
      const sounding = note.time <= now && now < note.time + Math.max(note.sustain, 0.15);
      const shown = (sounding || x0 >= playX - 1 ? 1 : 0.4) * (note.ghost ? 0.55 : 1);
      g.globalAlpha = shown;

      if (chord && !framed.has(chord) && !bare) { // a chord's frame: a bracket down the side of its notes, white on an accented one
        framed.add(chord);
        const rows = chord.notes.map((j) => row(arr.notes[j].string)), y0 = Math.min(...rows) - h / 2, y1 = Math.max(...rows) + h / 2, bx = x0 - 7;
        if (rows.length > 1 && !repeated) {
          g.strokeStyle = chord.accent ? '#ffffff' : alpha(t.text, 0.7);
          g.lineWidth = chord.accent === 'heavy' ? 4 : chord.accent ? 3 : 2;
          g.beginPath();
          g.moveTo(bx + 4, y0);
          g.lineTo(bx, y0);
          g.lineTo(bx, y1);
          g.lineTo(bx + 4, y1);
          g.stroke();
        }
        g.font = words;
        g.fillStyle = g.strokeStyle = repeated ? t.muted : t.text;
        g.lineWidth = 1.8;
        g.textAlign = 'left';
        if (chord.barre && !repeated) g.fillText(`${chord.barre.half ? '½' : ''}B${chord.barre.fret}`, bx, y0 - 5); // one finger across the strings at this fret
        if (chord.strum || chord.roll) { // strum or roll beside it: down runs from the low strings to the high ones
          const strings = chord.notes.map((j) => arr.notes[j].string), low = row(Math.min(...strings)), high = row(Math.max(...strings));
          const [ya, yb] = (chord.strum ?? chord.roll) === 'down' ? [low, high] : [high, low], ax = bx - 9;
          g.beginPath();
          for (let j = 0; j <= 16; j++) g.lineTo(ax + (chord.roll ? Math.sin((j / 16) * Math.PI * 6) * 2.5 : 0), ya + ((yb - ya) * j) / 16);
          g.stroke();
          arrowhead(ax, yb, 0, yb - ya || 1);
        }
        const before = arr.chords[note.chord - 1];
        if (chord.name && !repeated && (!before || note.time - before.time > 1 || before.name !== chord.name)) { // named once per change
          g.font = `700 ${fontSize(Math.min(24, gap * 0.4))}px ${t.num}`;
          g.fillStyle = t.text;
          g.fillText(chord.name, x0, top - gap * 0.72);
        }
      }

      // The note: a bar as long as it's held, in its string's colour (grey when muted, outlined when a chord is played again,
      // faint and dashed where it's let ring), its fret number and finger at the start
      g.beginPath();
      g.roundRect(x0, y - nh / 2, x1 - x0, nh, round * grace);
      if (sounding && !repeated) { // ПАТЧ Пюпитра (9): ореол без размытия тени — широкая полупрозрачная обводка под нотой
        g.save();
        g.strokeStyle = alpha(c, 0.3);
        g.lineWidth = 9;
        g.stroke();
        g.restore();
      }
      if (repeated) {
        g.strokeStyle = c;
        g.lineWidth = 2;
        g.stroke();
      } else if (note.letRing && x1 > x0 + w + 2) {
        g.fillStyle = alpha(c, 0.3);
        g.fill();
        g.strokeStyle = c;
        g.lineWidth = 2;
        g.setLineDash([6, 5]);
        line(x0 + w + 4, y, x1 - 4, y);
        g.setLineDash([]);
        g.beginPath();
        g.roundRect(x0, y - nh / 2, w, nh, round * grace);
        g.fillStyle = c;
        g.fill();
      } else {
        g.fillStyle = muted ? alpha(t.text, 0.22) : c;
        g.fill();
      }
      if (sounding) glowing.push({ y, c });
      const fill = repeated ? c : muted ? t.text : white ? '#ffffff' : t.ink;
      numbers.push({ text, font, finger, fill, shown, squeeze, x: cx, y: y + measure(g, font, text).middle, left: -(textWidth + fingerWidth) / 2, textWidth });

      // Around the note: slides in and out, a tie on to the note it's held into, the string's number when it's asked for
      if (!bare) marks.push(() => {
        g.globalAlpha = shown;
        const ink = repeated ? t.muted : t.text;
        g.strokeStyle = g.fillStyle = ink;
        g.lineWidth = 1.6;
        const slide = note.slideTo ?? note.slideUnpitchTo ?? null, up = slide === null ? (note.slideOut === 'up' ? 1 : note.slideOut ? -1 : 0) : Math.sign(slide - note.fret) || 1;
        if (up) {
          const unclear = note.slideTo === null && note.slideUnpitchTo !== null && note.slideUnpitchTo !== undefined; // off to no clear fret
          if (unclear) g.setLineDash([3, 3]);
          line(x1 + 4, y + up * nh * 0.3, x1 + 14, y - up * nh * 0.3);
          if (unclear) g.setLineDash([]);
        }
        if (note.slideIn) line(x0 - 16, y + (note.slideIn === 'below' ? 1 : -1) * nh * 0.3, x0 - 6, y - (note.slideIn === 'below' ? 1 : -1) * nh * 0.3);
        if (typeof note.tieTo === 'number') {
          const tx = X(arr.notes[note.tieTo].time) + nh / 2;
          g.setLineDash([4, 3]);
          g.beginPath();
          g.moveTo(cx, y + nh / 2 + 3);
          g.quadraticCurveTo((cx + tx) / 2, y + nh / 2 + 14, tx, y + nh / 2 + 3);
          g.stroke();
          g.setLineDash([]);
        }
        if (note.showString) {
          const sx = x0 - (chord ? 26 : 13);
          g.beginPath();
          g.arc(sx, y, 8, 0, Math.PI * 2);
          g.stroke();
          g.font = fonts.finger;
          g.textAlign = 'center';
          g.fillText(String(n - note.string), sx, y + measure(g, fonts.finger, '1').middle);
        }
        if (note.dynamicLabel) {
          g.font = `italic ${words}`;
          g.textAlign = 'left';
          g.fillStyle = t.text;
          g.fillText(note.dynamicLabel, x0, dynamicsY);
          g.fillStyle = ink;
        }

        // Over the note, nearest first as notation stacks them: vibrato along the bar, the slur from a hammer-on or pull-off, then
        // articulation, techniques and the picking hand. A bend's arrow rises from the end of its number
        let above = y - nh / 2 - 6;
        if (note.vibrato) {
          g.beginPath();
          for (let x = x0 + 2; x <= Math.max(x1, x0 + 24) - 2; x += 2) g.lineTo(x, above + Math.sin((x - x0) / 3) * (note.vibratoWide ? 3 : 1.8));
          g.stroke();
          above -= note.vibratoWide ? 10 : 8;
        }
        g.textAlign = 'center';
        g.font = words;
        if ((note.hammerOn || note.pullOff) && last) {
          const ax = last.x0 + last.w / 2, midX = (ax + cx) / 2;
          g.beginPath();
          g.moveTo(ax, above);
          g.quadraticCurveTo(midX, above - 12, cx, above);
          g.stroke();
          g.fillText(note.hammerOn ? 'H' : 'P', midX, above - 9);
          above -= 10;
        }
        const peak = bendPeak(note);
        if (peak > 0) {
          const pre = note.bendCurve?.[0]?.[1] > 0, release = (note.bendCurve?.length ?? 0) > 1 && note.bendCurve.at(-1)[1] < peak;
          const bx = x0 + w - 2, base = y - nh / 2, tip = base - 16;
          g.beginPath();
          if (pre) {
            g.moveTo(bx, base);
            g.lineTo(bx, tip);
          } else {
            g.moveTo(bx - 4, base + 2);
            g.quadraticCurveTo(bx + 4, base, bx + 6, tip);
          }
          g.stroke();
          arrowhead(pre ? bx : bx + 6, tip, pre ? 0 : 0.3, -1);
          if (release) {
            g.beginPath();
            g.moveTo(bx + 12, tip);
            g.quadraticCurveTo(bx + 16, base - 6, bx + 16, base);
            g.stroke();
            arrowhead(bx + 16, base, 0, 1);
          }
          g.textAlign = 'left';
          g.fillText(`${pre ? 'pre ' : ''}${bendLabel(peak)}`, bx + (release ? 20 : 10), tip + 4);
          g.textAlign = 'center';
        }
        [markX, markY] = [cx, above];
        if (note.tap && !note.tapLeft) word('T');
        if (note.staccato) stack(4, (my) => {
          g.beginPath();
          g.arc(cx, my, 2, 0, Math.PI * 2);
          g.fill();
        });
        if (note.accent && (note.accent === 'tenuto' || !chord?.accent)) word({ heavy: '^', tenuto: '–' }[note.accent] ?? '>');
        if (palm) word('PM');
        for (const mark of [
          note.tapLeft ? 'm.g.' : '', TEXT_MARKS[note.harmonicType] ?? (note.harmonicPinch ? 'PH' : ''),
          note.slap ? 'slap' : note.pop ? 'pop' : '', note.golpe ? `golpe (${note.golpe})` : '', note.rasgueado ? `rasg. ${note.rasgueado}` : '',
          typeof note.trill === 'number' ? `tr ${note.trill}` : '', note.ornament ?? '', note.fade ?? '', note.whammy ? 'w/bar' : '',
          note.wah === 'open' ? 'o' : note.wah === 'closed' ? '+' : '',
        ]) if (mark) word(mark);
        if (note.rightFinger) word(note.rightFinger, 'italic ');
        if (note.pick) stack(9, (my) => { // ⊓ down, V up
          g.beginPath();
          if (note.pick === 'down') [[-4, 4.5], [-4, -4.5], [4, -4.5], [4, 4.5]].forEach(([dx, dy], j) => g[j ? 'lineTo' : 'moveTo'](cx + dx, my + dy));
          else [[-4, -4.5], [0, 4.5], [4, -4.5]].forEach(([dx, dy], j) => g[j ? 'lineTo' : 'moveTo'](cx + dx, my + dy));
          g.stroke();
        });
        if (note.fermata) stack(9, (my) => {
          g.beginPath();
          g.arc(cx, my + 4, 7, Math.PI, 0);
          g.stroke();
          g.beginPath();
          g.arc(cx, my + 3, 1.5, 0, Math.PI * 2);
          g.fill();
        });
        if (note.tremolo) stack(18, (my) => { // the slashes, and the wavy line over them
          for (let j = -1; j <= 1; j++) line(cx - 6, my + j * 4 + 5.5, cx + 6, my + j * 4 + 0.5);
          g.beginPath();
          for (let j = 0; j <= 12; j++) g[j ? 'lineTo' : 'moveTo'](cx - 8 + (16 * j) / 12, my - 7 + Math.sin((j / 12) * Math.PI * 2) * 2);
          g.stroke();
        });
      });
    }
    // Over the bars: the fret numbers, then the fingers to fret them with, small beside them, then the marks, each a font at a time
    // (switching fonts for every note is dear). A number squeezed between notes closer than it is wide is drawn narrower
    const number = (job, str, dx, alphaShare) => {
      g.globalAlpha = job.shown * alphaShare;
      g.fillStyle = job.fill;
      if (job.squeeze === 1) return g.fillText(str, job.x + job.left + dx, job.y);
      g.save();
      g.translate(job.x, job.y);
      g.scale(job.squeeze, 1);
      g.fillText(str, job.left + dx, 0);
      g.restore();
    };
    g.textAlign = 'left';
    for (const font of [fonts.note, fonts.grace]) {
      g.font = font;
      for (const job of numbers) if (job.font === font) number(job, job.text, 0, 1);
    }
    g.font = fonts.finger;
    for (const job of numbers) if (job.finger) number(job, job.finger, job.textWidth + 3, 0.7);
    for (const draw of marks) draw();
    g.globalAlpha = 1;
    if (clip) g.restore();
  };
  if (!paged) drawSpan(null);
  else {
    drawSpan([left - 40, pageRight + 4]);
    if (upcoming) { // the next page's start, past a dashed line, faded
      const strip = pageRight + 24, pagePlayX = playX;
      X = (time) => strip + (time - upcoming.start) * upcoming.scale;
      [from, to, playX] = [upcoming.start, upcoming.start + peek / upcoming.scale, -Infinity];
      drawSpan([strip - 8, right + 4]);
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0, 0, 0, 0.55)';
      g.fillRect(strip - 8, 0, right + 12 - (strip - 8), VH);
      g.restore();
      g.strokeStyle = alpha(t.text, 0.22);
      g.lineWidth = 1.5;
      g.setLineDash([3, 5]);
      line(pageRight + 12, top - gap * 0.6, pageRight + 12, bottom + gap * 0.6);
      g.setLineDash([]);
      playX = pagePlayX;
    }
  }

  // The play line, glowing, with a spark where it crosses a string that's sounding
  // ПАТЧ Пюпитра (9): свечение без размытия тени — та же линия шире и прозрачнее под ней, у искры — цветной ореол
  g.strokeStyle = t.accent;
  for (const [width, a] of [[14, 0.08], [8, 0.16]]) {
    g.lineWidth = width;
    g.globalAlpha = a;
    line(playX, top - gap * 0.7, playX, bottom + gap * 0.7);
  }
  g.globalAlpha = 1;
  g.lineWidth = 3;
  line(playX, top - gap * 0.7, playX, bottom + gap * 0.7);
  for (const { y, c } of glowing) {
    g.fillStyle = alpha(c, 0.4);
    g.beginPath();
    g.arc(playX, y, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(playX, y, 4, 0, Math.PI * 2);
    g.fill();
  }

  // Scrolling, everything fades out well before the string names, and in toward the right end; then the card goes in
  // behind it all
  g.globalCompositeOperation = 'destination-out';
  for (const [x, dir, width] of paged ? [] : [[TAB_LABELS + 10, 1, TAB_FADE], [W - TAB_EDGE, -1, 80]]) {
    const fade = g.createLinearGradient(x, 0, x + dir * width, 0);
    fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = fade;
    g.fillRect(dir > 0 ? 0 : x - width, 0, dir > 0 ? x + width : W - x + width, VH);
  }
  g.globalCompositeOperation = 'destination-over';
  g.beginPath();
  g.roundRect(TAB_EDGE, cardTop, W - TAB_EDGE * 2, cardBottom - cardTop, 16);
  g.fillStyle = alpha(t.ink, 0.72);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = t.chipBorder;
  g.lineWidth = 1;
  g.stroke();

  if (!arr.open) return; // a chart without its tuning gets no head: nothing to name the strings after
  // The staff's head: what it is, the meter in force, and each string named after its open note in a chip of its own
  // colour, which fills while that string is sounding
  const labelFont = `700 ${fontSize(Math.min(14, gap * 0.24))}px ${t.num}`, r = Math.min(13, gap * 0.22), x = (TAB_EDGE + TAB_LABELS) / 2;
  g.textAlign = 'center';
  g.fillStyle = t.muted;
  g.font = `700 ${fontSize(Math.min(12, gap * 0.2))}px ${t.ui}`;
  g.fillText('TAB', x, beamY + stem * 0.7);
  const meter = arr.meters?.findLast((m) => m.time <= now)?.text.split('/');
  if (meter) { // the time in force, stacked on the staff where a tab's head carries it
    const middle = (top + bottom) / 2, numerals = `700 ${fontSize(Math.min(30, gap * 0.52))}px ${t.num}`;
    g.font = numerals;
    g.fillText(meter[0], TAB_LABELS + 20, middle - gap * 0.04);
    g.fillText(meter[1], TAB_LABELS + 20, middle + gap * 0.56);
  }
  g.font = labelFont;
  for (let s = 0; s < n; s++) {
    const y = row(s), c = color(s), on = glowing.some((spark) => spark.y === y); // its chip fills while the string sounds
    g.fillStyle = on ? c : alpha(c, 0.16);
    g.beginPath();
    g.roundRect(x - r * 1.2, y - r * 0.95, r * 2.4, r * 1.9, r * 0.55);
    g.fill();
    g.fillStyle = on ? t.ink : c;
    g.fillText(noteName(arr.open[s]), x, y + measure(g, labelFont, 'E').middle);
  }
}
