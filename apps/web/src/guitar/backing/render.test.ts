// Синт-минус (этап 11): длина рендера = длительности ± блок синтеза, нет NaN при 44.1 и 48 кГц, скорость 0.5 — вдвое
// длиннее; минус партии, которая одна звучит в песне, — тишина, гайд — она же; в том числе у дорожки с каналами ≥ 16
// (девятая партия: alphaTab выдаёт по два канала на дорожку). Тон: перегруженные гитары — через усилитель, разведены
// по сторонам; проход рендера — только свои каналы, исходный MidiFile не меняется.
import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { createConverter } from '../vendor/fretfall/fromScore.js';
import { buildTimeline } from '../import/timeline';
import { channelsOf, midiPass, renderMidi, renderSong, voicesOf } from './render';

function prepared(tex: string) {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings);
  createConverter(alphaTab).prepareScore(score);
  return { score, midiFile: buildTimeline(score, settings).midiFile };
}
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));
const track = (name: string, bars: string, program = 25) =>
  `\\track "${name}"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n\\instrument ${program}\n${bars}\n`;

describe('renderMidi', () => {
  // 10 тактов 4/4 при 120 BPM = 20 с.
  const song = prepared(`\\tempo 120\n${track('Lead', Array(10).fill('3.6.4 5.5.4 7.4.4 5.3.4').join(' | '))}${track('Rhythm', Array(10).fill('(0.6 2.5 2.4).2 (0.6 2.5 2.4).2').join(' | '))}`);

  for (const rate of [44100, 48000]) {
    it(`20 с при ${rate} Гц: длина ± блок синтеза, без NaN`, () => {
      const pcm = renderMidi(song.midiFile, rate, 1, {});
      expect(Math.abs(pcm.left.length - 20 * rate)).toBeLessThanOrEqual(64);
      expect(pcm.left.length).toBe(pcm.right.length);
      expect(pcm.left.some(Number.isNaN) || pcm.right.some(Number.isNaN)).toBe(false);
      expect(rms(pcm.left)).toBeGreaterThan(1e-3);
    });
  }

  it('скорость 0.5 — вдвое длиннее', () => {
    const pcm = renderMidi(song.midiFile, 48000, 0.5, {});
    expect(Math.abs(pcm.left.length - 40 * 48000)).toBeLessThanOrEqual(64);
  });

  it('минус единственной звучащей партии — тишина, гайд — она же', () => {
    const lone = prepared(`\\tempo 120\n${track('Lead', '3.6.4 5.5.4 7.4.4 5.3.4 | 3.6.1')}${track('Silent', 'r.1 | r.1')}`);
    const player = channelsOf(lone.score.tracks[0]);
    expect(rms(renderMidi(lone.midiFile, 48000, 1, { muted: player }).left)).toBeLessThan(1e-4);
    expect(rms(renderMidi(lone.midiFile, 48000, 1, { solo: player }).left)).toBeGreaterThan(1e-3);
  });

  it('девятая партия (каналы ≥ 16): минус — тишина, гайд звучит', () => {
    const rests = Array.from({ length: 8 }, (_, i) => track(`G${i + 1}`, 'r.1 | r.1')).join('');
    const nine = prepared(`\\tempo 120\n${rests}${track('Ninth', '3.6.4 5.5.4 7.4.4 5.3.4 | 3.6.1')}`);
    const player = channelsOf(nine.score.tracks[8]);
    expect(Math.max(...player)).toBeGreaterThanOrEqual(16);
    expect(rms(renderMidi(nine.midiFile, 48000, 1, { muted: player }).left)).toBeLessThan(1e-4);
    expect(rms(renderMidi(nine.midiFile, 48000, 1, { solo: player }).left)).toBeGreaterThan(1e-3);
  });
});

describe('тон', () => {
  const riff = Array(4).fill('(0.6 2.5 2.4).4 (0.6 2.5 2.4).4 (3.6 5.5 5.4).4 (3.6 5.5 5.4).4').join(' | ');
  const metal = prepared(`\\tempo 120\n${track('Rhythm L', riff, 30)}${track('Rhythm R', riff, 30)}${track('Crunch', riff, 29)}${track('Clean', riff, 27)}`);
  const programsOf = (m: alphaTab.midi.MidiFile, ch: number) =>
    m.events.filter((e): e is alphaTab.midi.ProgramChangeEvent => e instanceof alphaTab.midi.ProgramChangeEvent && e.channel === ch).map((e) => e.program);

  it('перегруз — по программе GM, перегруженные по центру разводятся; громкость — куб доли, как у alphaSynth', () => {
    const v = voicesOf(metal.score);
    expect(v.map((x) => x.amp)).toEqual(['high-gain', 'high-gain', 'crunch', null]);
    expect(v.slice(0, 3).map((x) => x.pan)).toEqual([-0.7, 0.7, -0.35]);
    metal.score.tracks[0].playbackInfo.balance = 4;
    metal.score.tracks[0].playbackInfo.volume = 8;
    const custom = voicesOf(metal.score)[0];
    expect([custom.pan, custom.gain]).toEqual([-0.5, 0.125]);
    metal.score.tracks[0].playbackInfo.balance = 8;
    metal.score.tracks[0].playbackInfo.volume = 16;
  });

  it('проход: ноты только своих каналов, темп и конец общие; DI — чистая гитара по центру; исходник не тронут', () => {
    const [a, b] = [channelsOf(metal.score.tracks[0]), channelsOf(metal.score.tracks[1])];
    const notes = (m: alphaTab.midi.MidiFile, chs: number[]) => m.events.filter((e) => e instanceof alphaTab.midi.NoteOnEvent && chs.includes(e.channel)).length;
    const di = midiPass(metal.midiFile, new Set(a), true);
    expect(notes(di, a)).toBe(notes(metal.midiFile, a));
    expect(notes(di, b)).toBe(0);
    expect(di.events.some((e) => e instanceof alphaTab.midi.TempoChangeEvent)).toBe(true);
    expect(di.events.at(-1)!.tick).toBe(metal.midiFile.events.at(-1)!.tick);
    expect(programsOf(di, a[0])).toEqual([27]);
    expect(programsOf(metal.midiFile, a[0])).toEqual([30]);
    const pans = di.events.filter((e): e is alphaTab.midi.ControlChangeEvent => e instanceof alphaTab.midi.ControlChangeEvent && e.controller === alphaTab.midi.ControllerType.PanCoarse);
    expect(pans.map((e) => e.value)).toEqual(a.map(() => 64));
  });

  it('минус и гайд: одной длины, без NaN; гайд перегруженной партии звучит, минус единственной партии — тишина', () => {
    const r = renderSong(metal.midiFile, voicesOf(metal.score), 0, 48000, 1);
    expect(r.minus.left.length).toBe(r.guide.left.length);
    for (const a of [r.minus.left, r.minus.right, r.guide.left, r.guide.right]) expect(a.some(Number.isNaN)).toBe(false);
    expect(rms(r.guide.left)).toBeGreaterThan(1e-3);
    expect(rms(r.minus.left)).toBeGreaterThan(1e-3);
    // гитара игрока разведена влево: в гайде левый канал громче правого
    expect(rms(r.guide.left)).toBeGreaterThan(rms(r.guide.right) * 1.5);

    const lone = prepared(`\\tempo 120\n${track('Solo', '3.6.4 5.5.4 7.4.4 5.3.4 | 3.6.1', 30)}`);
    const solo = renderSong(lone.midiFile, voicesOf(lone.score), 0, 48000, 1);
    expect(rms(solo.minus.left)).toBeLessThan(1e-4);
    expect(rms(solo.guide.left)).toBeGreaterThan(1e-3);
  });
});
