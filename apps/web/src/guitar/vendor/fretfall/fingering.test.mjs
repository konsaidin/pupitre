import assert from 'node:assert/strict';
import { suggestPositions, fingerFor } from './fingering.js';

const run = (frets, step = 0.25) => {
  const notes = frets.flatMap((f, i) => (Array.isArray(f) ? f : [f]).map((fret) => ({ time: i * step, sustain: 0, fret })));
  return { notes, ...suggestPositions(notes) };
};

// A pentatonic box at the 5th fret stays in one position, one finger per fret
const box = run([5, 8, 5, 7, 5, 7, 5, 7]);
assert.deepEqual(box.anchors.map((a) => a.fret), [5]);
assert.deepEqual(box.notes.map((n) => box.fingers.get(n)), [1, 4, 1, 3, 1, 3, 1, 3]);

// A lick that moves up the neck shifts once, and lands with the index on the new position
const move = run([5, 7, 5, 7, 12, 15, 12, 14]);
assert.deepEqual(move.anchors.map((a) => [a.fret, a.time]), [[5, 0], [12, 1]]);
assert.deepEqual(move.notes.slice(4).map((n) => move.fingers.get(n)), [1, 4, 1, 3]);

// A chord wider than the hand stretches from its lowest note
const wide = run([[3, 7]]);
assert.deepEqual([wide.anchors[0].fret, wide.anchors[0].width], [3, 5]);
assert.deepEqual(wide.notes.map((n) => wide.fingers.get(n)), [1, 4]);

// A chromatic run needs at most one shift, not one per note
assert.ok(run([5, 6, 7, 8, 9, 10]).anchors.length <= 2);

// Open strings don't move the hand; empty charts are fine
assert.deepEqual(run([5, 0, 7, 0, 5]).anchors.map((a) => a.fret), [5]);
assert.deepEqual(suggestPositions([]).anchors, []);
assert.equal(fingerFor(9, 5), 4); // out of reach: the little finger stretches

console.log('ok');
