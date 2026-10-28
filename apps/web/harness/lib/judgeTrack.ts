// Один трек GuitarSet через распознавание браузерного пути: WAV → ворклеты атак (pupitre-onset) и высоты (вокальное
// WASM-ядро) в имитации AudioWorkletGlobalScope → кадры → гитарный судья против партии из разметки JAMS.
// Три прогона судьи на одних кадрах: настоящая партия (полнота), та же партия на 2 полутона выше (ложные
// засчитывания: честный судья почти ничего не засчитает), и атаки вне нот разметки (ложные атаки в минуту).
import { readFileSync } from 'node:fs';
import type { InputFrame } from '../../src/audio/instrument/session';
import { decodeFrame, FRAME_FLOATS } from '../../src/audio/AudioInput';
import { ONSET_PROCESSOR_SOURCE } from '../../src/audio/instrument/onsetProcessorSource';
import { PITCH_PROCESSOR_SOURCE } from '../../src/audio/pitchProcessorSource';
import { CHORD_RULES, guitarJudge, type ChordRules } from '../../src/guitar/judge/guitarJudge';
import type { TabEvent, TabMap } from '../../src/guitar/model/types';

const BLOCK = 128;
const YIN_HALF_WINDOW = 896;
/** Ноты разных струн, начатые в пределах этого окна, — один удар (аккорд), как в табулатуре. */
const CHORD_MS = 40;
/** Атака дальше этого от любой ноты разметки — ложная. */
const STRAY_MS = 100;

export interface TrackInput {
  id: string;
  wav: string;
  jams: string;
  /** Разметка другого трека того же типа: «играю что попало» — сколько засчитает судья. */
  otherJams?: string;
  dsp: string;
  /** Переопределения порогов (калибровка): передаются ворклету атак и судье. */
  tune?: { rise?: number; riseHf?: number; gate?: number; gateHf?: number; refractory?: number; chord?: Partial<ChordRules>; match?: { tol?: number; octaves?: number }; pitchOnsetRun?: number };
}

export interface TrackResult {
  id: string;
  seconds: number;
  events: number;
  chords: number;
  hits: number;
  chordHits: number;
  wrong: number;
  falseHits: number;
  falseChordHits: number;
  crossEvents: number;
  crossHits: number;
  onsets: number;
  strayOnsets: number;
}

function readWav(path: string): { rate: number; mono: Float32Array } {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`не WAV: ${path}`);
  let off = 12;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let format = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      const frames = Math.floor(size / ((bits / 8) * channels));
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * (bits / 8);
          sum += format === 3 ? buf.readFloatLE(p) : bits === 16 ? buf.readInt16LE(p) / 32768 : buf.readInt32LE(p) / 2147483648;
        }
        mono[i] = sum / channels;
      }
      return { rate, mono };
    }
    off = body + size + (size & 1);
  }
  throw new Error(`нет data в ${path}`);
}

function worklet(source: string, name: string, rate: number, processorOptions: object) {
  const scope = { currentTime: 0, sampleRate: rate };
  const messages: unknown[] = [];
  class AudioWorkletProcessor {
    port = { postMessage: (m: unknown) => messages.push(m), onmessage: null as unknown };
  }
  let Processor: (new (o: object) => { process(inputs: Float32Array[][]): boolean }) | null = null;
  const registerProcessor = (n: string, cls: typeof Processor) => {
    if (n === name) Processor = cls;
  };
  new Function('AudioWorkletProcessor', 'registerProcessor', 'scope', `with (scope) { ${source} }`)(AudioWorkletProcessor, registerProcessor, scope);
  if (!Processor) throw Error(`процессор ${name} не зарегистрирован`);
  const processor = new (Processor as unknown as new (o: object) => { process(inputs: Float32Array[][]): boolean })({ processorOptions });
  return {
    messages,
    process(block: Float32Array, time: number) {
      scope.currentTime = time;
      processor.process([[block]]);
    },
  };
}

/** Партия из JAMS: ноты шести струн, близкие по началу — один удар. */
function eventsOf(jamsPath: string, shift: number): TabEvent[] {
  const jams = JSON.parse(readFileSync(jamsPath, 'utf8')) as { annotations: Array<{ namespace: string; data: Array<{ time: number; duration: number; value: number }> }> };
  const notes = jams.annotations
    .filter((a) => a.namespace === 'note_midi')
    .flatMap((a) => a.data.map((d) => ({ ms: d.time * 1000, durMs: d.duration * 1000, midi: Math.round(d.value) + shift })))
    .sort((a, b) => a.ms - b.ms);
  const events: TabEvent[] = [];
  for (const n of notes) {
    const last = events.at(-1);
    if (last && n.ms - last.startMs <= CHORD_MS && !last.notes.some((x) => x.midi === n.midi)) {
      last.notes.push({ midi: n.midi, techs: [] } as unknown as TabEvent['notes'][number]);
      continue;
    }
    events.push({ startMs: n.ms, durMs: n.durMs, judge: 'attack', windowScale: 1, notes: [{ midi: n.midi, techs: [] }] } as unknown as TabEvent);
  }
  return events;
}

let tuneOf: NonNullable<TrackInput['tune']> = {};
function judgeAll(events: TabEvent[], frames: InputFrame[], chordRules: ChordRules) {
  const map = { notes: events } as unknown as TabMap;
  const judge = guitarJudge({ map, difficulty: 'medium' }, { toClock: (ms) => ms / 1000, a4Hz: 440, strictness: 'normal', chordRules, match: tuneOf.match, pitchOnsetRun: tuneOf.pitchOnsetRun });
  judge.onBegin(0);
  events.forEach((_, i) => judge.reset(i, 0));
  for (const f of frames) judge.onFrame(f, f.atMs);
  return events.map((_, i) => judge.finalize(i));
}

export default async function judgeTrack(input: TrackInput): Promise<TrackResult> {
  const { rate, mono } = readWav(input.wav);
  const module = await WebAssembly.compile(readFileSync(input.dsp));
  const pitch = worklet(PITCH_PROCESSOR_SOURCE, 'pitch-processor', rate, { module, gateRms: 0.003, gateClarity: 0.5 });
  const onset = worklet(ONSET_PROCESSOR_SOURCE, 'pupitre-onset', rate, input.tune ?? {});
  for (let i = 0; i + BLOCK <= mono.length; i += BLOCK) {
    const block = mono.slice(i, i + BLOCK);
    pitch.process(block, i / rate);
    onset.process(block, i / rate);
  }
  const frames: InputFrame[] = [];
  for (const m of pitch.messages as Array<{ t0: number; frames: Float32Array }>) {
    for (let o = 0; o + FRAME_FLOATS <= m.frames.length; o += FRAME_FLOATS) {
      const f = decodeFrame(m.frames, o, m.t0);
      frames.push({
        atMs: (f.t - YIN_HALF_WINDOW / rate) * 1000, midi: f.voiced && Number.isFinite(f.midiRaw) ? f.midiRaw : NaN,
        clarity: f.clarity, levelDb: 20 * Math.log10(Math.max(1e-9, f.rms)), onset: false,
      });
    }
  }
  const onsetTimes = (onset.messages as Array<{ t: number; peak: number }>).map((m) => m.t * 1000);
  for (const t of onsetTimes) frames.push({ atMs: t, midi: NaN, clarity: 0, levelDb: -20, onset: true });
  frames.sort((a, b) => a.atMs - b.atMs || Number(b.onset) - Number(a.onset));

  const events = eventsOf(input.jams, 0);
  const shifted = eventsOf(input.jams, 2);
  const hitKind = (k?: string) => k === 'hit' || k === 'early' || k === 'late';
  tuneOf = input.tune ?? {};
  const rules = { ...CHORD_RULES, ...input.tune?.chord };
  const real = judgeAll(events, frames, rules);
  const fake = judgeAll(shifted, frames, rules);
  const other = input.otherJams ? eventsOf(input.otherJams, 0).filter((e) => e.startMs < (mono.length / rate) * 1000) : [];
  const cross = other.length ? judgeAll(other, frames, rules) : [];
  const starts = events.map((e) => e.startMs);
  let stray = 0;
  for (const t of onsetTimes) if (!starts.some((s) => Math.abs(s - t) <= STRAY_MS)) stray++;
  const chord = (i: number) => events[i].notes.length > 1;
  return {
    id: input.id,
    seconds: mono.length / rate,
    events: events.length,
    chords: events.filter((e) => e.notes.length > 1).length,
    hits: real.filter((v) => hitKind(v.kind)).length,
    chordHits: real.filter((v, i) => chord(i) && hitKind(v.kind)).length,
    wrong: real.filter((v) => v.kind === 'wrong').length,
    falseHits: fake.filter((v) => hitKind(v.kind)).length,
    falseChordHits: fake.filter((v, i) => chord(i) && hitKind(v.kind)).length,
    crossEvents: other.length,
    crossHits: cross.filter((v) => hitKind(v.kind)).length,
    onsets: onsetTimes.length,
    strayOnsets: stray,
  };
}
