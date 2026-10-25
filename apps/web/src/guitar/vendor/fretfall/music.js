// Pure helpers, no DOM, so `node music.test.mjs` can check them.

const TICKS_PER_QUARTER = 960; // alphaTab MIDI resolution

// changes: [{tick, tempo}] in playback order → [{tick, tempo, ms}] with the song time at each change
export function tempoMap(changes, initialTempo) {
  const map = [{ tick: 0, tempo: initialTempo, ms: 0 }];
  for (const { tick, tempo } of changes) {
    const p = map.at(-1);
    map.push({ tick, tempo, ms: p.ms + ((tick - p.tick) * 60000) / (p.tempo * TICKS_PER_QUARTER) });
  }
  return map;
}

// The tempo in force at `value` of `key` (tick or ms): the last change at or before it, or the song's start. A binary search:
// both run every frame, and a song with a tempo change on every beat has thousands
function segmentAt(map, key, value) {
  let lo = 0, hi = map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid][key] <= value) lo = mid + 1;
    else hi = mid;
  }
  return map[Math.max(0, lo - 1)];
}

export function tickToMs(map, tick) {
  const seg = segmentAt(map, 'tick', tick);
  return seg.ms + ((tick - seg.tick) * 60000) / (seg.tempo * TICKS_PER_QUARTER);
}

export function msToTick(map, ms) {
  const seg = segmentAt(map, 'ms', ms);
  return seg.tick + ((ms - seg.ms) * seg.tempo * TICKS_PER_QUARTER) / 60000;
}

const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const STANDARD = { 4: [28, 33, 38, 43], 5: [23, 28, 33, 38, 43], 6: [40, 45, 50, 55, 59, 64], 7: [35, 40, 45, 50, 55, 59, 64] };

// open-string MIDI notes, lowest string first → "E Standard", "Drop D", or the string names
export function tuningName(open) {
  const standard = STANDARD[open.length], shift = standard && open.map((m, i) => m - standard[i]);
  if (shift?.every((d) => d === shift[0])) return `${FLATS[open[0] % 12]} Standard`;
  if (shift && shift[0] === shift[1] - 2 && shift.slice(1).every((d) => d === shift[1])) return `Drop ${FLATS[open[0] % 12]}`;
  return open.map((m) => FLATS[m % 12]).join(' ');
}
export const noteName = (midi) => FLATS[midi % 12];

// The tuning a tuning is best told against: a standard one against E Standard (B Standard on 5 and 7 strings), a drop one
// against Drop D (Drop A), and Drop D itself or anything else string by string against standard. null: no standard to go by
// → { reference: its name, open: its open strings, shift: semitones each string is tuned away from it }
export function tuningReference(open) {
  const standard = STANDARD[open.length];
  if (!standard) return null;
  const offset = open.map((m, i) => m - standard[i]);
  const drop = offset[0] === offset[1] - 2 && offset.slice(1).every((d) => d === offset[1]) && offset[1] !== 0;
  const reference = drop ? standard.map((m, i) => (i ? m : m - 2)) : standard;
  return { reference: tuningName(reference), open: reference, shift: open.map((m, i) => m - reference[i]) };
}

// Marks chords that only repeat the chord just played: the same strings, frets and notation again within `gap` seconds.
// The highway draws those as beats instead of full chords: their notes get `repeat`, the chord becomes `highDensity`
// (the format's own flag for a repeated chord). Single notes are never marked: each one is still a note to play. Timing,
// links and pick direction don't count: alternate picking is still the same chord again.
// A spot played again by the very next strike (the same string and fret, within `gap`) is held down between the two: the
// later note gets `heldFrom`, the time of the strike before, so its target on the board stays lit instead of flashing off
// and on. A spot let go of in between (a mute, a slide or a bend moving off it) isn't held.
const UNMARKED = new Set(['time', 'sustain', 'chord', 'repeat', 'heldFrom', 'tieTo', 'dynamicLabel', 'pick']);
const fingering = (n) => JSON.stringify(Object.entries(n).filter(([k, v]) => !UNMARKED.has(k) && v !== null && v !== undefined && v !== false && v !== 0).sort());
export function markRepeats(notes, chords, gap = 1) {
  let before = null;
  for (let i = 0, j; i < notes.length; i = j) {
    for (j = i + 1; j < notes.length && notes[j].time - notes[i].time < 0.005; j++);
    const group = notes.slice(i, j), shape = group.map(fingering).sort().join('|');
    const chord = group[0].chord ?? null, soon = !!before && group[0].time - before.time <= gap, repeat = chord !== null && soon && before.shape === shape;
    for (const n of group) {
      n.repeat = repeat;
      const kept = soon && !n.mute && before.group.some((b) => b.string === n.string && b.fret === n.fret && !b.mute && !b.bend && !b.bendCurve && (b.slideTo ?? b.slideUnpitchTo ?? null) === null);
      n.heldFrom = kept ? before.time : null;
    }
    if (repeat) chords[chord].highDensity = true;
    before = { shape, time: group[0].time, group };
  }
}

// Connections the highway draws between notes, for charts from any source: a tie to the next note for linked notes,
// let-ring notes sounding until the string is played again (4 s at most), a dynamic only where it changes (f is where a
// Guitar Pro file starts), and a barre where one finger holds three or more strings at the same fret.
export function annotate(notes, chords) {
  const last = {}, from = {}; // the note before on each string, and the fret its tied chain set out from
  let dynamic = 'f';
  notes.forEach((n, i) => {
    const before = last[n.string];
    if (before !== undefined) {
      const p = notes[before];
      if (p.letRing) p.sustain = Math.max(p.sustain, Math.min(n.time - p.time, 4));
      // A note that starts already bent, at the pitch the one before ended on and on the same fret, is that same string
      // still pushed over: the hand never let it come back, whatever the sustain says, so the rail carries through
      const bentTo = (x) => x.bendCurve?.at(-1)?.[1] ?? x.bend ?? 0,
        bentFrom = (x) => x.bendCurve?.[0]?.[1] ?? 0;
      if (bentFrom(n) > 0 && p.fret === n.fret && bentTo(p) === bentFrom(n)) p.sustain = Math.max(p.sustain, n.time - p.time);
      if (p.linkNext) {
        p.tieTo = i;
        n.tied = true; // held on from the note before: the same ring, carried on, never picked again
        // A slide tied onward has to arrive by the time the note it is tied to takes over, however short that is;
        // left to its own sustain (and the quarter second a slide is given at least) it is still on its way, and the
        // two halves of the slide meet at different frets
        if ((p.slideTo ?? p.slideUnpitchTo ?? null) !== null) p.slideSpan = n.time - p.time;
        // It rings until the note it is tied to takes over, whatever its own sustain says: left shorter, its trail
        // stops a hair before the next one starts and the chain shows a gap at every join
        p.sustain = Math.max(p.sustain, n.time - p.time);
      }
      // A slide that goes up and comes straight back. The chart ends the tied chain at the top and starts a note on the
      // fret it set out from a few hundredths of a second later, with nothing of its own to play — a hand coming back,
      // not a second pick. The chain slides back to it and it carries the ring on, as the rest of the chain does
      const plain = (x) => (x.slideTo ?? x.slideUnpitchTo ?? null) === null && !x.bend && !x.bendCurve && !x.hammerOn && !x.pullOff;
      if (!n.tied && p.tied && n.chord === null && plain(n) && n.fret === from[n.string] && n.time - (p.time + p.sustain) < 0.1) {
        p.slideTo = n.fret;
        p.slideSpan = n.time - p.time;
        n.tied = true;
      }
    }
    n.dynamicLabel = n.dynamic && n.dynamic !== dynamic ? n.dynamic : null;
    if (n.dynamic) dynamic = n.dynamic;
    if (!n.tied) from[n.string] = n.fret; // a fresh pick is where the next chain sets out from
    last[n.string] = i;
  });
  for (const n of Object.values(last).map((i) => notes[i])) if (n.letRing) n.sustain = Math.max(n.sustain, 2);
  for (const c of chords) c.barre ??= barreOf(c);
}

// Arpeggios: a chord shape held while its notes are played one at a time (a held hand shape over single notes). Each
// of its notes rings until the shape is let go or its string is played again, as let ring, and the shape gets `arpeggio`,
// so the highway shows it held all the way. A shape held for less than 0.6 s is a fingering for a quick pair of notes, not
// an arpeggio, and so is one that only one string plays. notes: sorted by time.
export function markArpeggios(notes, handShapes) {
  for (const shape of handShapes) {
    if (shape.endTime - shape.startTime < 0.6) continue;
    const from = notes.findIndex((n) => n.time >= shape.startTime - 0.005), inShape = [];
    for (let i = from; i >= 0 && i < notes.length && notes[i].time < shape.endTime - 0.005; i++)
      if (notes[i].chord === null && shape.frets[notes[i].string] === notes[i].fret) inShape.push(i);
    if (new Set(inShape.map((i) => notes[i].string)).size < 2) continue;
    shape.arpeggio = true;
    for (const i of inShape) {
      const n = notes[i], next = notes.find((m, j) => j > i && m.string === n.string && m.time > n.time + 0.005);
      n.sustain = Math.max(n.sustain, Math.min(shape.endTime, next?.time ?? Infinity) - n.time);
      n.letRing = true;
    }
  }
}

function barreOf({ frets = [], fingers = [] }) {
  const held = {};
  frets.forEach((fret, string) => {
    if (fret > 0 && fingers[string] >= 1) (held[`${fingers[string]}:${fret}`] ??= []).push(string);
  });
  const [key, strings] = Object.entries(held).sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  return strings?.length >= 3 ? { fret: +key.split(':')[1], from: Math.min(...strings), to: Math.max(...strings) } : null;
}

// Lyrics in two rows, karaoke style. lines: [{ time, end, syllables }] in order. Returns the lines on the top and bottom
// rows as indexes (-1: empty). The top row is the line being sung, from 0.2 s after the line before it ends (so its last
// word is seen lit), or else the next one, from 8 s ahead; the bottom row is the line after that, up next. A line with
// nothing coming up soon after it stays 1.5 s once it ends.
export function lyricsShown(lines, t) {
  const soon = (i) => i < lines.length && lines[i].time - t < 8;
  let top = lines.findIndex((l) => t < l.end + 0.2);
  if (top < 0) top = lines.length;
  if (!soon(top)) top = top > 0 && t < lines[top - 1].end + 1.5 ? top - 1 : -1;
  return { top, bottom: top >= 0 && soon(top + 1) ? top + 1 : -1 };
}

// What a page loops by name (fretfall.phrases): the part's sections where the file names them, each up to the next, else
// its phrases. Seconds. Whatever comes before the first section (a recording's lead-in) is one of its own, unnamed, so
// every moment of the song is in one
export function phrasesOf(arr, length) {
  if (!arr.sections?.length) return arr.phrases.map((p) => ({ name: p.name ?? '', start: p.time, end: p.endTime }));
  const all = arr.sections.map((s, i) => ({ name: s.name, start: s.time, end: arr.sections[i + 1]?.time ?? length }));
  return all[0].start > 0 ? [{ name: '', start: 0, end: all[0].start }, ...all] : all;
}

// The count-in before a start from a pause (fretfall.countIn): `n` clicks a beat apart, twice as many once the tempo
// heard (the beats' at `t`, times speed) is 120 bpm or more, a fast bar being too short to get the hands ready.
// The song carries on from where it was paused, mid-beat or not, so it starts early enough for its next beat to fall one
// beat after the last click, in time with them. → { count, gap, at: [the clicks], start }, seconds from now on the
// clock rather than the song's
export function countIn(beats, t, n, speed) {
  const next = beats.findIndex((b) => b.time >= t - 0.01),
    i = Math.max(0, Math.min(next < 0 ? Infinity : next, beats.length - 2)), // past the last beat: the last two's
    gap = (beats.length > 1 ? beats[i + 1].time - beats[i].time : 0.5) / speed, // no beats to go by: 120 bpm
    count = 60 / gap >= 120 ? n * 2 : n,
    lead = next < 0 ? 0 : Math.max(0, beats[next].time - t) / speed, // till the song's next beat, once it plays
    start = Math.max(0, count * gap - lead); // a lead-in longer than the count-in: the song starts now, the clicks later
  return { count, gap, at: Array.from({ length: count }, (_, k) => start + lead - (count - k) * gap), start };
}
