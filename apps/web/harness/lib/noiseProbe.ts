// Шум без музыки через ворклеты браузерного пути: сколько атак в минуту и кадров «есть высота» даёт фон звуковой карты
// (розовый шум + фон 50 Гц) при абсолютных порогах и при порогах от замеренного фона. Запуск — из noise-probe.mjs.
import { readFileSync } from 'node:fs';
import { ONSET_PROCESSOR_SOURCE } from '../../src/audio/instrument/onsetProcessorSource';
import { PITCH_PROCESSOR_SOURCE } from '../../src/audio/pitchProcessorSource';
import { decodeFrame, FRAME_FLOATS } from '../../src/audio/AudioInput';

function worklet(source: string, name: string, rate: number, processorOptions: object) {
  const scope = { currentTime: 0, sampleRate: rate };
  const messages: unknown[] = [];
  class AudioWorkletProcessor { port = { postMessage: (m: unknown) => messages.push(m), onmessage: null as unknown }; }
  let P: any = null;
  new Function('AudioWorkletProcessor', 'registerProcessor', 'scope', `with (scope) { ${source} }`)(AudioWorkletProcessor, (n: string, c: any) => { if (n === name) P = c; }, scope);
  const proc = new P({ processorOptions });
  return { messages, process(b: Float32Array, t: number) { scope.currentTime = t; proc.process([[b]]); } };
}

export async function probe(dsp: string, noiseDb: number, gates: { onset: object; pitch: { gateRms: number } }) {
  const rate = 48000, seconds = 60;
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  // розовый шум (Пол Келлет) с RMS noiseDb + фон 50 Гц на 6 дБ тише
  const x = new Float32Array(rate * seconds);
  let b0 = 0, b1 = 0, b2 = 0, sum = 0;
  for (let i = 0; i < x.length; i++) {
    const w = rnd();
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    x[i] = b0 + b1 + b2 + w * 0.1848;
    sum += x[i] * x[i];
  }
  const k = 10 ** (noiseDb / 20) / Math.sqrt(sum / x.length);
  for (let i = 0; i < x.length; i++) x[i] = x[i] * k + 10 ** ((noiseDb - 6) / 20) * Math.SQRT2 * Math.sin((2 * Math.PI * 50 * i) / rate);
  const module = await WebAssembly.compile(readFileSync(dsp));
  const pitch = worklet(PITCH_PROCESSOR_SOURCE, 'pitch-processor', rate, { module, gateRms: gates.pitch.gateRms, gateClarity: 0.5 });
  const onset = worklet(ONSET_PROCESSOR_SOURCE, 'pupitre-onset', rate, gates.onset);
  for (let i = 0; i + 128 <= x.length; i += 128) { const b = x.slice(i, i + 128); pitch.process(b, i / rate); onset.process(b, i / rate); }
  let voiced = 0, total = 0;
  for (const m of pitch.messages as Array<{ t0: number; frames: Float32Array }>)
    for (let o = 0; o + FRAME_FLOATS <= m.frames.length; o += FRAME_FLOATS) { total++; if (decodeFrame(m.frames, o, m.t0).voiced) voiced++; }
  return { onsetsPerMin: onset.messages.length / (seconds / 60), voicedShare: voiced / Math.max(1, total) };
}
