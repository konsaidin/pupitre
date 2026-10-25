import assert from 'node:assert/strict';
import { onsetEnvelope, align, snapOffset } from './sync.js';

// An irregular chart (8th notes at 150 bpm with gaps), played back 3% slower and starting 2.7 s into the "recording"
let seed = 7;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const onsets = [];
for (let i = 0; i < 400; i++) if (random() > 0.35) onsets.push(1 + i * 0.2);

const rate = 11025, offset = 2.7, ratio = 1.03;
const samples = new Float32Array(Math.ceil((offset + ratio * 82 + 3) * rate)).map(() => (random() - 0.5) * 0.02);
for (const t of onsets) { // a plucked-string-ish burst per note
  const start = Math.round((offset + ratio * t) * rate);
  for (let i = 0; i < 0.12 * rate; i++) samples[start + i] += Math.sin(i * 0.3 + random()) * Math.exp(-i / (0.03 * rate)) * 0.6;
}

const got = align(onsetEnvelope(samples, rate), onsets);
assert.ok(Math.abs(got.offset - offset) < 0.025, `offset ${got.offset}`);
assert.ok(Math.abs(got.ratio - ratio) < 0.002, `ratio ${got.ratio}`);
assert.ok(got.confidence > 2, `confidence ${got.confidence}`);

// A recording that has nothing to do with the chart should not look confident
const unrelated = align(onsetEnvelope(new Float32Array(samples.length).map(() => random() - 0.5), rate), onsets);
assert.ok(unrelated.confidence < got.confidence / 2, `unrelated confidence ${unrelated.confidence}`);

// snapOffset: 4 s of count-in clicks as loud as the notes, then the notes 4.5 s in. The first loud sound is a click;
// the confident fit knows better, so the snap lands on the first note: a nudge of about nothing
const counted = new Float32Array(samples.length).map(() => (random() - 0.5) * 0.02);
for (const t of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].concat(onsets.map((t) => 4.5 + ratio * t))) {
  const start = Math.round(t * rate);
  for (let i = 0; i < 0.12 * rate && start + i < counted.length; i++) counted[start + i] += Math.sin(i * 0.3 + random()) * Math.exp(-i / (0.03 * rate)) * 0.6;
}
const heard = onsetEnvelope(counted, rate), fitted = align(heard, onsets);
assert.ok(fitted.confidence >= 2, `count-in confidence ${fitted.confidence}`);
const snapped = snapOffset(heard, fitted, onsets[0]);
assert.ok(Math.abs(snapped) < 30, `snapped onto the count-in: ${snapped} ms`);
assert.equal(snapOffset({ env: new Float32Array(100), hop: 0.01, start: 0 }, fitted, onsets[0]), null); // silence

console.log('ok');
