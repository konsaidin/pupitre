import assert from 'node:assert/strict';
import { moveCamera, bendAt, drawHighway, drawTab, drawSheet, HEADSTOCKS, headstockParts } from './highway.js';
import { LOOKS, DEFAULT_STYLE, theme } from './themes.js';

const run = (anchors, until, snapshotsAt) => {
  const cam = {}, seen = {}, targets = new Set();
  for (let ms = 0; ms <= until * 1000; ms += 16) {
    moveCamera(cam, anchors, ms / 1000, ms);
    targets.add(cam.target);
    for (const t of snapshotsAt) if (ms >= t * 1000 && !seen[t]) seen[t] = { left: cam.center - cam.span / 2, right: cam.center + cam.span / 2, span: cam.span };
  }
  return { seen, moves: targets.size };
};
const shows = (v, lo, hi) => v.left <= lo && v.right >= hi;

// A chart as the player takes it (from alphaTab, or a page's format such as a .pak reader): a note's techniques off unless
// given, a chord listing its notes by index, and each hand position lasting until the next
const NOTE = { sustain: 0, chord: null, hammerOn: false, pullOff: false, slideTo: null, slideUnpitchTo: null, bend: 0, harmonic: false, harmonicPinch: false, palmMute: false, mute: false, tremolo: false, vibrato: false, accent: false, tap: false, linkNext: false, finger: null, slap: false, pop: false, pick: null };
function chart({ name = 'Lead', length, notes, chords = [], anchors }) {
  const all = [...notes.map((n) => ({ ...NOTE, ...n })), ...chords.flatMap((c, i) => c.notes.map((n) => ({ ...NOTE, time: c.time, ...n, chord: i })))].sort((a, b) => a.time - b.time || a.string - b.string);
  const built = chords.map((c) => ({ time: c.time, name: '', frets: [], fingers: [], notes: [], accent: false, palmMute: false, fretHandMute: false, highDensity: false }));
  all.forEach((n, i) => n.chord !== null && built[n.chord].notes.push(i));
  return {
    name, tuning: [0, 0, 0, 0, 0, 0], centOffset: 0, capo: 0, strings: 6, notes: all, chords: built, handShapes: [], sections: [], beats: [{ time: 0, measure: 1 }],
    anchors: anchors.map((a, i) => ({ time: a.time, endTime: anchors[i + 1]?.time ?? length, fret: a.fret, width: 4 })), phrases: [{ time: 0, endTime: length, name: '', maxDifficulty: 0 }],
  };
}

// A big move: frets 1-4, then frets 10-13 from 10 s
const jump = run([{ time: 0, endTime: 10, fret: 1, width: 4 }, { time: 10, endTime: 20, fret: 10, width: 4 }], 16, [5, 9.5, 14]);
assert.ok(shows(jump.seen[5], 0, 4) && jump.seen[5].span < 13, 'settled close on the first position');
assert.ok(shows(jump.seen[9.5], 0, 13), 'zoomed out to show both positions before the move');
assert.ok(shows(jump.seen[14], 9, 13) && jump.seen[14].span < 13, 'zoomed back in on the new position');

// A hand rocking one fret back and forth every second should not move the camera each time
const rocking = Array.from({ length: 20 }, (_, i) => ({ time: i, endTime: i + 1, fret: 5 + (i % 2), width: 4 }));
assert.ok(run(rocking, 20, []).moves <= 2, 'small shifts keep the camera still');

// Moves back and forth every 4.5 s: stay zoomed out in between instead of pumping in and out
const back = Array.from({ length: 6 }, (_, i) => ({ time: i * 4.5, endTime: (i + 1) * 4.5, fret: i % 2 ? 12 : 1, width: 4 }));
assert.ok(Object.values(run(back, 22, [6.75, 11.25, 15.75]).seen).every((v) => shows(v, 0, 15)), 'no zooming in between moves that follow each other');

// The glide starts gently: just after a big move comes into frame, the view has barely shifted
const shift = [{ time: 0, endTime: 10, fret: 1, width: 4 }, { time: 10, endTime: 20, fret: 10, width: 4 }], glide = {};
moveCamera(glide, shift, 6.9, 0);
const start = glide.center;
for (let ms = 16; ms <= 64; ms += 16) moveCamera(glide, shift, 6.9 + ms / 1000 + 0.1, ms);
assert.ok(Math.abs(glide.center - start) < 0.2, 'no lurch when the camera starts to move');

// Bends on the highway: up within 0.3 s and held, back down where a release starts; the chart's late points are reached on time
const near = (a, b) => Math.abs(a - b) < 0.01;
const even = { sustain: 0.6, bendCurve: [[0, 0], [1, 1]] }; // Guitar Pro's "b (0 4)": spread over the note, drawn up quickly
assert.ok(near(bendAt(even, 0), 0) && near(bendAt(even, 0.15), 0.5) && near(bendAt(even, 0.3), 1) && near(bendAt(even, 0.6), 1));
const release = { sustain: 0.9, bendCurve: [[0, 0], [1 / 3, 1], [2 / 3, 1], [1, 0]] };
assert.ok(near(bendAt(release, 0.3), 1) && near(bendAt(release, 0.55), 1) && bendAt(release, 0.65) < 1 && near(bendAt(release, 0.9), 0));
const late = { sustain: 1, bendCurve: [[0.5, 1]] }; // only when the peak is reached
assert.ok(near(bendAt(late, 0.2), 0) && near(bendAt(late, 0.35), 0.5) && near(bendAt(late, 0.5), 1));
assert.ok(near(bendAt({ sustain: 1, bendCurve: [[0, 1], [1, 1]] }, 0), 1) && near(bendAt({ sustain: 1, bend: 0.5 }, 0.3), 0.5)); // pre-bend; no curve

// A whole frame draws at every side angle in every look: a shape the swing turns inside out must not stop the frame. The
// canvas turns down negative radii as browsers do (a pill gem once did, and the notes after it vanished)
const noRadius = (name, ...radii) => { if (radii.some((r) => r < 0)) throw new RangeError(`${name}: negative radius`); };
const context = new Proxy({
  arc: (x, y, r) => noRadius('arc', r), ellipse: (x, y, rx, ry) => noRadius('ellipse', rx, ry), roundRect: (x, y, w, h, r) => noRadius('roundRect', r),
  measureText: () => ({ width: 10, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 0 }),
  createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
}, { get: (target, key) => (key in target ? target[key] : () => {}) });
globalThis.devicePixelRatio = 2;
globalThis.OffscreenCanvas = class { getContext() { return context; } }; // the floor's strip of colour bands
const rects = []; // the tab's rhythm: its beams and the rests written as a bar, both filled from one path
globalThis.Path2D = class { moveTo() {} lineTo() {} arc() {} ellipse() {} quadraticCurveTo() {} rect(x, y, w) { rects.push([Math.round(x), Math.round(w)]); } }; // the tab's beat lines and its rhythm, each gathered into one path
const canvas = { clientWidth: 1728, clientHeight: 944, width: 0, height: 0, getContext: () => context };
const arrangement = chart({ length: 20, notes: Array.from({ length: 24 }, (_, i) => ({ time: 1 + i * 0.25, string: i % 6, fret: i % 3 ? 1 + ((i * 5) % 22) : 0 })), anchors: [{ time: 0, fret: 1 }, { time: 4, fret: 12 }] });
for (const look of Object.keys(LOOKS))
  for (let sideAngle = -20; sideAngle <= 20; sideAngle += 5)
    for (const now of [0, 2, 4])
      assert.doesNotThrow(() => drawHighway(canvas, arrangement, now, { ...theme({ ...DEFAULT_STYLE, look }), headstock: 'headless', sideAngle }, {}), `${look} at ${sideAngle}°, ${now} s`);

// Headstocks: keys on the side of their row of posts (a 6 in line's far posts cross the middle, their keys stay on the bass
// side), 4 + 2 and 3 + 3 splits for any number of strings, and every one draws, in either string order
const sidesOf = (id, n) => headstockParts(HEADSTOCKS[id], Array.from({ length: n }, (_, s) => 0.8 * (1 - (2 * s) / (n - 1)))).keys.map((k) => k.side).join();
assert.equal(sidesOf('inline', 6), '1,1,1,1,1,1');
assert.equal(sidesOf('fourTwo', 6), '1,1,1,1,-1,-1');
assert.equal(sidesOf('fourTwo', 4), '1,1,1,-1');
assert.equal(sidesOf('openBook', 7), '1,1,1,1,-1,-1,-1');
assert.equal(sidesOf('pointed', 6), '1,1,1,-1,-1,-1');
// The headless plate's rounded outline never turns back on itself (a loop there stroked a spike beside the nut)
const plate = headstockParts(HEADSTOCKS.headless, [0.8, -0.8]).outline;
assert.ok(plate.slice(2).every(([u, v], i) => {
  const [[u0, v0], [u1, v1]] = [plate[i], plate[i + 1]];
  return (u1 - u0) * (u - u1) + (v1 - v0) * (v - v1) >= 0;
}), 'headless outline loops');
for (const headstock of Object.keys(HEADSTOCKS))
  for (const stringOrder of ['low', 'high'])
    assert.doesNotThrow(() => drawHighway(canvas, arrangement, 2, { ...theme(DEFAULT_STYLE), headstock, stringOrder }, {}), `${headstock}, ${stringOrder}`);

// A vibrato trail running into a chord ends at the bottom of the chord's note lying across it on the string below, not over it
const trailTop = (string) => { // the top of the wavy spine on screen, the chord's fret 7 note on this string
  let points = [], moves = 0, closed = false, top = Infinity; // a trail's outline: one open line of many points (lanes and beat lines are many short ones in a path)
  const recorder = new Proxy({
    beginPath: () => { points = []; moves = 0; closed = false; }, moveTo: (x, y) => { points.push(y); moves++; }, lineTo: (x, y) => points.push(y), closePath: () => { closed = true; },
    stroke: () => { if (!closed && moves === 1 && points.length > 12) top = Math.min(top, ...points); },
  }, { get: (target, key) => (key in target ? target[key] : context[key]) });
  const vibrato = chart({ length: 10, notes: [{ time: 1, string: 1, fret: 7, sustain: 0.5, vibrato: true }], chords: [{ time: 1.5, notes: [{ string: 1, fret: 5 }, { string, fret: 7 }] }], anchors: [{ time: 0, fret: 5 }] });
  drawHighway({ ...canvas, getContext: () => recorder }, vibrato, 0.9, { ...theme(DEFAULT_STYLE), headstock: 'headless' }, {});
  return top;
};
assert.ok(trailTop(2) > trailTop(0) + 10, 'the trail stops short of the note below it');

// A slide off fret 12 into a chord on the same string (The Hell Song at 0:51): once its trail comes into view it stays, all the
// way in. Cut against the chord's note however far across the neck it was, it vanished while both were in the distance
const sliding = chart({ name: 'Rhythm', length: 10, notes: [{ time: 5, string: 0, fret: 12, sustain: 0.22, slideUnpitchTo: 4 }], chords: [{ time: 5.26, notes: [{ string: 0, fret: 4 }, { string: 1, fret: 6 }] }], anchors: [{ time: 0, fret: 2 }, { time: 5.26, fret: 4 }] });
let spines = 0, points = 0, moves = 0, closed = false;
const spineCounter = new Proxy({
  beginPath: () => { points = 0; moves = 0; closed = false; }, moveTo: () => { points++; moves++; }, lineTo: () => points++, closePath: () => { closed = true; },
  stroke: () => { if (!closed && moves === 1 && points > 12) spines++; },
}, { get: (target, key) => (key in target ? target[key] : context[key]) });
const trailFrames = [], slideCam = {};
for (let now = 1.5; now < 4.9; now += 1 / 30) {
  spines = 0;
  drawHighway({ ...canvas, getContext: () => spineCounter }, sliding, now, { ...theme(DEFAULT_STYLE), headstock: 'headless' }, slideCam);
  trailFrames.push(spines > 0);
}
const firstShown = trailFrames.indexOf(true);
assert.ok(firstShown >= 0 && trailFrames.slice(firstShown).every(Boolean), `the slide's trail stays once it shows: ${trailFrames.map(Number).join('')}`);

// A bend moves the string the way a hand pushes it, and its chevrons follow: the treble strings up towards the bass ones,
// the bass strings down the other way. A chevron is the only three-point stroke that isn't flat (the strings are the rest)
const bendWays = (string) => {
  const ways = [];
  let pts = [];
  const chevrons = new Proxy({
    beginPath: () => { pts = []; }, moveTo: (x, y) => pts.push(y), lineTo: (x, y) => pts.push(y),
    stroke: () => { if (pts.length === 3 && pts[0] !== pts[1]) ways.push(Math.sign(pts[0] - pts[1])); }, // + points up, - points down
  }, { get: (target, key) => (key in target ? target[key] : context[key]) });
  const bent = chart({ length: 10, notes: [{ time: 1, string, fret: 7, sustain: 0.5, bendCurve: [[0, 0], [0.4, 1], [1, 1]] }], anchors: [{ time: 0, fret: 6 }] });
  drawHighway({ ...canvas, getContext: () => chevrons }, bent, 0.6, { ...theme(DEFAULT_STYLE), headstock: 'headless' }, {});
  return ways;
};
const [treble, bass] = [bendWays(5), bendWays(0)];
assert.ok(treble.length && treble.every((w) => w > 0), `a bend on the top string points up: ${treble}`);
assert.ok(bass.length && bass.every((w) => w < 0), `a bend on the bottom string points down: ${bass}`);

// A note's fret number on the floor, the whole way in: readable from the back of the highway and still there as the note
// lands (it used to shrink out of sight up the highway, and go out a note's length before the board)
const numbered = chart({ length: 10, notes: [{ time: 5, string: 0, fret: 3, ghost: true }], anchors: [{ time: 0, fret: 1 }] });
const numbers = [];
const numberer = new Proxy({ fillText: (str) => numbers.push(str) }, { get: (target, key) => (key in target ? target[key] : context[key]) });
for (const out of [3, 1.5, 0]) { // seconds before it is played: the back of the highway, the middle, and the moment it lands
  numbers.length = 0;
  drawHighway({ ...canvas, getContext: () => numberer }, numbered, 5 - out, { ...theme(DEFAULT_STYLE), headstock: 'headless', fretNumbers: true }, {});
  assert.ok(numbers.includes('(3)'), `the note is numbered ${out} s out`); // a ghost note's brackets tell it from the board's own 3
}

// The tablature draws the fret numbers of the notes coming up, and none from long ago
const texts = [];
const writer = new Proxy({ fillText: (str) => texts.push(str) }, { get: (target, key) => (key in target ? target[key] : context[key]) });
for (const stringOrder of ['low', 'high'])
  assert.doesNotThrow(() => drawTab({ ...canvas, getContext: () => writer }, { ...arrangement, open: [40, 45, 50, 55, 59, 64] }, 2, { ...theme(DEFAULT_STYLE), stringOrder }));
const frets = arrangement.notes.filter((note) => note.time >= 2 && note.time < 4).map((note) => String(note.fret));
assert.ok(frets.every((f) => texts.includes(f)), 'the notes in view are numbered');
assert.ok(texts.includes('E') && texts.includes('B'), 'the strings are named');
texts.length = 0;
drawTab({ ...canvas, getContext: () => writer }, arrangement, 20, theme(DEFAULT_STYLE));
assert.equal(texts.length, 0, 'nothing left once the song has gone by');

// A held note sliding into a chord, and sixteenths closer than a note is wide: on a string, each bar ends before the next
// note begins, with room for the chord's bracket and the slide's slash in between
const bars = new Map(); // row → [x, end]
const boxes = new Proxy({ roundRect: (x, y, w, h) => h < 60 && (bars.get(y) ?? bars.set(y, []).get(y)).push([x, x + w]) }, { get: (target, key) => (key in target ? target[key] : context[key]) });
const tight = chart({ length: 10, notes: [{ time: 1, string: 0, fret: 3, sustain: 0.3, slideTo: 5 }, ...[1.8, 1.9, 2, 2.1].map((time, i) => ({ time, string: 0, fret: 12 + i }))], chords: [{ time: 1.3, notes: [{ string: 0, fret: 5 }, { string: 1, fret: 7 }] }], anchors: [{ time: 0, fret: 3 }] });
drawTab({ ...canvas, getContext: () => boxes }, { ...tight, open: [40, 45, 50, 55, 59, 64] }, 0.5, theme(DEFAULT_STYLE));
const lane = [...bars.values()].find((b) => b.length === 6).sort((a, b) => a[0] - b[0]);
assert.ok(lane.slice(1).every(([x], i) => x >= lane[i][1] + 4), `bars on a string overlap: ${JSON.stringify(lane)}`);
assert.ok(lane[1][0] - lane[0][1] >= 24, 'room for the slide slash and the chord bracket');

// In pages, the notes hold still while the play line moves across the page; scrolling, they move
const placed = [];
const placer = new Proxy({ fillText: (str, x) => placed.push(x) }, { get: (target, key) => (key in target ? target[key] : context[key]) });
const numbersAt = (now, tabLayout) => {
  placed.length = 0;
  drawTab({ ...canvas, getContext: () => placer }, arrangement, now, { ...theme(DEFAULT_STYLE), tabLayout });
  return placed.join();
};
assert.equal(numbersAt(2, 'pages'), numbersAt(2.2, 'pages'), 'a page holds still');
assert.notEqual(numbersAt(2, 'scroll'), numbersAt(2.2, 'scroll'), 'scrolling moves');

// The rhythm over the staff: eighths beam with the ones they share a beat with and break at the next beat, a quarter
// carries no beam at all, and a rest is written rather than left as a gap
const timed = {
  ...arrangement, open: [40, 45, 50, 55, 59, 64], notes: [], chords: [],
  beats: [0, 1, 2, 3].map((time) => ({ time, measure: time ? -1 : 1 })),
  rhythm: [[0, 8], [0.5, 8], [1, 8], [1.5, 8], [2, 4]].map(([time, value]) => ({ time, value, dots: 0, rest: false, tuplet: 0 })),
};
const lanes = (arr) => {
  rects.length = 0;
  drawTab({ ...canvas, getContext: () => context }, arr, 0, { ...theme(DEFAULT_STYLE), tabLayout: 'scroll' });
  return rects.map(([, w]) => w);
};
assert.deepEqual(lanes(timed), [120, 120], 'a beam over each beat’s pair of eighths, half a second apart at 240 px a second, and none over the quarter');
const [alone, second] = lanes({ ...timed, rhythm: timed.rhythm.map((r, i) => (i === 1 ? { ...r, rest: true } : r)) });
assert.ok(alone < 30 && second === 120, `a rest breaks the beam: the eighth before it is flagged and the second beat still beams, not ${alone} and ${second}`);
assert.ok(lanes({ ...timed, rhythm: [{ time: 0.5, value: 16, dots: 0, rest: false, tuplet: 0 }] }).every((w) => w < 30), 'a sixteenth on its own is flagged, not beamed across the bar');

// Every notation the highway shows draws in the tab view too, in both layouts
const marks = [
  { hammerOn: true }, { pullOff: true }, { bendCurve: [[0, 0], [0.5, 1], [1, 0]], sustain: 1 }, { bendCurve: [[0, 1], [1, 1]], sustain: 0.5 },
  { slideTo: 9, sustain: 0.5 }, { slideUnpitchTo: 2, slideTo: null, sustain: 0.4 }, { slideIn: 'below', slideOut: 'down' }, { tieTo: 0 },
  { letRing: true, sustain: 1.5 }, { grace: true }, { showString: true }, { pick: 'down' }, { pick: 'up' }, { fermata: true }, { tremolo: true },
  { staccato: true, accent: 'heavy' }, { accent: 'tenuto' }, { dynamicLabel: 'pp' }, { harmonic: true, harmonicType: 'artificial' },
  { harmonicPinch: true }, { rightFinger: 'i', tapLeft: true }, { tap: true }, { vibrato: true, vibratoWide: true }, { mute: true },
  { ghost: true, palmMute: true }, { slap: true }, { golpe: 'thumb', rasgueado: 'i i' }, { trill: 7, ornament: 'turn' },
  { fade: 'swell', whammy: [[0, 0], [1, -1]], wah: 'open' }, { finger: 0 }, { repeat: true },
];
const notated = {
  ...arrangement, open: [40, 45, 50, 55, 59, 64],
  notes: arrangement.notes.map((note, i) => ({ ...note, ...marks[i % marks.length], chord: i < 2 ? 0 : null })),
  chords: [{ time: 1, name: 'E5', notes: [0, 1], fingers: [1, 3, -1, -1, -1, -1], accent: 'heavy', strum: 'down', barre: { fret: 1, from: 0, to: 1, half: true } }],
  handShapes: [{ startTime: 3, endTime: 5, name: 'Am', frets: [0, 2, 2, 1, 0, -1], fingers: [], arpeggio: true }],
  markers: [{ time: 1, text: '♩ = 120' }], hairpins: [{ time: 2, endTime: 3, kind: 'cresc' }, { time: 4, endTime: 5, kind: 'dim' }],
  beats: [0, 1, 2, 3, 4, 5, 6].map((time) => ({ time, measure: time % 2 ? -1 : time / 2 + 1 })),
};
for (const tabLayout of ['scroll', 'pages'])
  for (const now of [0, 1.5, 3, 6])
    assert.doesNotThrow(() => drawTab(canvas, notated, now, { ...theme(DEFAULT_STYLE), tabLayout, markings: 'white' }), `${tabLayout} at ${now} s`);

// Marks: the fingering goes first, then everything written around a note, and the fret numbers are left alone
const written = (tabMarks) => {
  texts.length = 0;
  drawTab({ ...canvas, getContext: () => writer }, notated, 1.5, { ...theme(DEFAULT_STYLE), tabMarks });
  return [...texts];
};
const AROUND = ['E5', 'Am', 'pp', 'fret 12', '\u00bdB1', 'AH', 'PH', 'm.g.', 'full'];
const everything = written('all'), plain = written('plain'), bare = written('notes');
assert.ok(AROUND.every((mark) => everything.includes(mark)), `the lot is written: ${[...new Set(everything)]}`);
assert.ok(AROUND.every((mark) => plain.includes(mark)) && plain.length < everything.length, 'no fingering, the rest as it was');
assert.ok(!AROUND.some((mark) => bare.includes(mark)), `nothing written around a note: ${[...new Set(bare)]}`);
assert.ok(notated.notes.filter((note) => note.time >= 1.5 && note.time < 3.5).map((note) => String(note.fret)).some((fret) => bare.includes(fret)), 'the fret numbers stay');

// The notation page: the numbers on their strings and the strings named, a rest written, and the beat being played boxed
const beatBoxes = [];
const boxer = new Proxy({ fillText: (str) => texts.push(str), roundRect: (x, y, w, h) => h > 40 && h < 200 && beatBoxes.push([x, w]) }, { get: (target, key) => (key in target ? target[key] : context[key]) });
texts.length = rects.length = 0;
const page = { ...timed, notes: [{ ...NOTE, time: 1, string: 2, fret: 2 }, { ...NOTE, time: 1.5, string: 0, fret: 3 }], rhythm: [[1, 4, false], [1.5, 4, false], [2, 1, true]].map(([time, value, rest]) => ({ time, value, dots: 0, rest, tuplet: 0 })) };
drawSheet({ ...canvas, getContext: () => boxer }, page, 1.2, theme(DEFAULT_STYLE), {});
assert.ok(['2', '3', 'E', 'A'].every((str) => texts.includes(str)), `numbers and string names written: ${[...new Set(texts)]}`);
assert.ok(rects.length >= 1, 'the whole rest is written as its bar');
assert.equal(beatBoxes.filter(([, w]) => w > 20).length, 1, 'one beat boxed');
assert.equal(beatBoxes.filter(([, w]) => w <= 20).length, 1, 'the moment marked once, a rounded marker');
beatBoxes.length = 0;
drawSheet({ ...canvas, getContext: () => boxer }, page, 1.2, { ...theme(DEFAULT_STYLE), beatBox: false }, {});
assert.deepEqual(beatBoxes.map(([, w]) => w > 20), [false], 'with the highlight off, the marker alone');
assert.doesNotThrow(() => drawSheet({ ...canvas, getContext: () => boxer }, page, 1.2, { ...theme(DEFAULT_STYLE), sheetNotes: true }, {}), 'the staff over each system draws, its glyphs waiting on the face');
// What tab writes around a note, on the page: the note held into in brackets, a palm mute and a let ring as labelled runs,
// the chord's name, the words under the rhythm; and none of the marks with the Marks setting at just the notes
const marked = {
  ...page, chords: [{ time: 1, name: 'E5', notes: [0, 1], fingers: [], frets: [], accent: false, palmMute: false, fretHandMute: false, highDensity: false }],
  notes: [{ ...NOTE, time: 1, string: 2, fret: 2, chord: 0, tieTo: 2, palmMute: true, vibrato: true }, { ...NOTE, time: 1, string: 0, fret: 3, chord: 0, palmMute: true, slideTo: 5, sustain: 0.4 }, { ...NOTE, time: 1.5, string: 2, fret: 2, hammerOn: true, letRing: true }, { ...NOTE, time: 2, string: 2, fret: 4, letRing: true, bendCurve: [[0, 0], [1, 1]], sustain: 0.5 }],
  lyrics: [{ time: 1, length: 0.5, text: 'Smoke' }, { time: 1.5, length: 0.5, text: 'on' }],
};
texts.length = 0;
drawSheet({ ...canvas, getContext: () => boxer }, marked, 0.5, theme(DEFAULT_STYLE), {});
assert.ok(['(2)', 'P.M.', 'let ring', 'E5', 'Smoke', 'H', 'full'].every((str) => texts.includes(str)), `the marks are written: ${[...new Set(texts)]}`);
texts.length = 0;
drawSheet({ ...canvas, getContext: () => boxer }, marked, 0.5, { ...theme(DEFAULT_STYLE), tabMarks: 'notes' }, {});
assert.ok(!['P.M.', 'let ring', 'E5', 'H', 'full'].some((str) => texts.includes(str)) && texts.includes('(2)') && texts.includes('Smoke'), 'just the notes: the tie and the words stay, the marks go');

console.log('ok');
