import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/engine';
import { EXERCISES } from '../game/exercises';
import type { GameSummary } from '../game/scoring';
import { FakeCtx, FakeInput } from '../test/fakeAudio';
import { decodeFrame, FRAME_FLOATS } from './AudioInput';

interface Dsp {
  memory: WebAssembly.Memory;
  dsp_init(rate: number): void;
  dsp_set_gate(rms: number, clarity: number): void;
  dsp_in_ptr(): number;
  dsp_out_ptr(): number;
  dsp_frame_floats(): number;
  dsp_process(count: number): number;
  dsp_latency_ms(): number;
}

const modulePromise = WebAssembly.compile(readFileSync(new URL('../assets/dsp.wasm', import.meta.url)));

async function createDsp(rate: number): Promise<Dsp> {
  const instance = await WebAssembly.instantiate(await modulePromise, {});
  const dsp = instance.exports as unknown as Dsp;
  dsp.dsp_init(rate);
  dsp.dsp_set_gate(0.006, 0.6);
  expect(dsp.dsp_frame_floats()).toBe(FRAME_FLOATS);
  return dsp;
}

describe('реальный WASM и протокол кадров', () => {
  it.each([44100, 48000, 88200, 96000, 192000])('слышит 80 Гц при %i Гц входа', async (rate) => {
    const dsp = await createDsp(rate);
    let total = 0;
    let voiced = 0;
    const frequencies: number[] = [];
    let firstTime = NaN;
    let lastTime = NaN;
    for (let sample = 0; sample < rate; sample += 128) {
      const input = new Float32Array(dsp.memory.buffer, dsp.dsp_in_ptr(), 128);
      for (let i = 0; i < input.length; i++) input[i] = 0.3 * Math.sin(2 * Math.PI * 80 * (sample + i) / rate);
      const count = dsp.dsp_process(input.length);
      const out = new Float32Array(dsp.memory.buffer, dsp.dsp_out_ptr(), count * FRAME_FLOATS);
      for (let i = 0; i < count; i++) {
        const frame = decodeFrame(out, i * FRAME_FLOATS, 0);
        if (Number.isNaN(firstTime)) firstTime = frame.t;
        lastTime = frame.t;
        if (frame.t <= 0.25) continue;
        total++;
        if (frame.voiced) { voiced++; frequencies.push(frame.hz); }
      }
    }
    expect(voiced / total).toBeGreaterThan(0.95);
    expect(frequencies.reduce((sum, hz) => sum + hz, 0) / frequencies.length).toBeCloseTo(80, 0);
    // Ресемплинг не меняет шкалу времени и частоту выдачи кадров вдвое.
    expect(firstTime).toBeLessThan(0.05);
    expect(lastTime).toBeGreaterThan(0.99);
    expect(dsp.dsp_latency_ms()).toBeGreaterThan(50);
    expect(dsp.dsp_latency_ms()).toBeLessThan(90);
  });
});

describe('голос → WASM → упражнение → итог', () => {
  it.each([
    [48000, 'vibrato'], [96000, 'vibrato'], [48000, 'steady'], [48000, 'off-pitch'],
  ] as const)('%i Гц / %s получает соответствующий результат', async (rate, mode) => {
    const dsp = await createDsp(rate);
    const map = EXERCISES.find((exercise) => exercise.id === 'vibrato-hold')!
      .build({ lowMidi: 48, highMidi: 67 }, { bpm: 60, repeats: 2 });
    const ctx = new FakeCtx();
    const input = new FakeInput();
    let summary: GameSummary | null = null;
    const engine = new GameEngine({ctx: ctx as unknown as AudioContext, input, map,
      difficulty: 'medium', latencyMs: 0, guideNotes: false, metronome: false,
      onFinish: (result) => { summary = result; },
    });
    await engine.start();
    let phase = 0;
    try {
      const totalSamples = Math.ceil(rate * (map.durationMs / 1000 + 3.5));
      for (let sample = 0; sample < totalSamples; sample += 128) {
        const samples = new Float32Array(dsp.memory.buffer, dsp.dsp_in_ptr(), 128);
        for (let i = 0; i < samples.length; i++) {
          const t = (sample + i) / rate;
          const songMs = (t - 3) * 1000;
          const note = map.notes.find((n) => songMs >= n.startMs && songMs < n.startMs + n.durMs);
          if (!note) { samples[i] = 0; continue; }
          const midi = note.midi + (mode === 'off-pitch' ? 4 : 0)
            + (mode === 'steady' ? 0 : 0.5 * Math.sin(2 * Math.PI * 5.5 * t));
          phase += 2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) / rate;
          samples[i] = 0.3 * Math.sin(phase);
        }
        const count = dsp.dsp_process(samples.length);
        const flat = new Float32Array(dsp.memory.buffer, dsp.dsp_out_ptr(), count * FRAME_FLOATS);
        ctx.currentTime = (sample + samples.length) / rate;
        for (let i = 0; i < count; i++) input.push(decodeFrame(flat, i * FRAME_FLOATS, 0));
        if (summary) break;
      }
      const result = summary as GameSummary | null;
      expect(result).not.toBeNull();
      if (mode === 'vibrato') {
        expect(result!.perfect).toBe(map.notes.length);
        expect(result!.accuracy).toBeGreaterThan(0.95);
      } else {
        expect(result!.miss).toBe(map.notes.length);
        expect(result!.accuracy).toBeLessThan(0.1);
      }
    } finally {
      engine.quit();
    }
  }, 10000);
});
