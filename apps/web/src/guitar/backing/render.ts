// Синт-минус (этап 11; операция render воркера): AlphaSynth с заглушкой вывода и exportAudio по MidiFile партитуры
// (того же, что строит таймлайн, формат 0). Минус — партия игрока заглушена (основной и вторичный MIDI-канал её
// дорожки), гайд — она же соло. Скорость — множитель темпа событий MidiFile. Саундфонт — SONiVOX из пакета alphaTab
// (встроен в чанк воркера: под file:// fetch не работает).
import * as alphaTab from '@coderline/alphatab';
import sonivox from '@coderline/alphatab/soundfont/sonivox.sf3?inline';

export interface RenderPass {
  /** MIDI-каналы, которые глушатся. */
  muted?: number[];
  /** Только эти каналы звучат (гайд). */
  solo?: number[];
}

export interface StereoPcm {
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
}

const CHUNK_MS = 500;

let soundFont: Uint8Array | null = null;
/** Свой саундфонт (MuseScore General — главный поток передаёт его воркеру); null — встроенный SONiVOX. */
export function setSoundFont(bytes: Uint8Array | null): void {
  soundFont = bytes;
}
function soundFontBytes(): Uint8Array {
  if (!soundFont) {
    const b64 = sonivox.slice(sonivox.indexOf(',') + 1);
    const bin = atob(b64);
    soundFont = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) soundFont[i] = bin.charCodeAt(i);
  }
  return soundFont;
}

const emitter = () => ({ on: () => () => {}, off: () => {} });
// Вывод-заглушка: exportAudio синтезирует блоки сам, устройство не нужно.
function silentOutput(sampleRate: number): alphaTab.synth.ISynthOutput {
  return {
    sampleRate, open() {}, play() {}, destroy() {}, pause() {}, addSamples() {}, resetSamples() {}, activate() {},
    ready: emitter(), samplesPlayed: emitter(), sampleRequest: emitter(),
    enumerateOutputDevices: async () => [], setOutputDevice: async () => {}, getOutputDevice: async () => null,
  } as unknown as alphaTab.synth.ISynthOutput;
}

/** Каналы дорожки (основной и вторичный — для эффектов вроде флажолетов). */
export function channelsOf(track: alphaTab.model.Track): number[] {
  return [...new Set([track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel])];
}

/** Рендер MidiFile в стерео PCM на sampleRate; speed — множитель темпа (0.5 — вдвое медленнее). */
export function renderMidi(midiFile: alphaTab.midi.MidiFile, sampleRate: number, speed: number, pass: RenderPass): StereoPcm {
  const tempos = midiFile.events.filter((e): e is alphaTab.midi.TempoChangeEvent => e instanceof alphaTab.midi.TempoChangeEvent);
  const original = tempos.map((e) => e.beatsPerMinute);
  for (const e of tempos) e.beatsPerMinute *= speed;
  try {
    const synth = new alphaTab.synth.AlphaSynth(silentOutput(sampleRate), CHUNK_MS);
    const options = new alphaTab.synth.AudioExportOptions();
    options.soundFonts = [soundFontBytes()];
    options.sampleRate = sampleRate;
    options.masterVolume = 0.5;
    options.metronomeVolume = 0;
    options.useSyncPoints = false;
    // Каналы — по событиям самого MidiFile: alphaTab нумерует их не по 16 MIDI-каналам (GP3–5: 2×(канал файла − 1),
    // MusicXML: по два на партию), так что у дорожек дальше восьмой они ≥ 16.
    // Громкость задаётся ЯВНО каждому каналу: конструктор экспортёра alphaTab 1.8.4 ставит громкость метронома до
    // загрузки MIDI, на канал метронома по умолчанию (16) — и девятая дорожка (каналы 16/17) иначе молчит.
    const used = new Set<number>();
    for (const e of midiFile.events as Array<{ channel?: number }>) if (Number.isInteger(e.channel)) used.add(e.channel!);
    for (const ch of used) {
      const off = pass.muted?.includes(ch) || (pass.solo !== undefined && !pass.solo.includes(ch));
      options.trackVolume.set(ch, off ? 0 : 1);
    }
    const exporter = synth.exportAudio(options, midiFile, [], new Map());
    const chunks: Float32Array[] = [];
    let total = 0;
    for (let chunk = exporter.render(CHUNK_MS); chunk; chunk = exporter.render(CHUNK_MS)) {
      chunks.push(chunk.samples);
      total += chunk.samples.length;
    }
    synth.destroy();
    // Сэмплы чанков — стерео вперемешку (L, R, L, R…).
    const frames = total >> 1;
    const left = new Float32Array(frames), right = new Float32Array(frames);
    let f = 0;
    for (const samples of chunks) {
      for (let i = 0; i + 1 < samples.length; i += 2, f++) {
        left[f] = samples[i];
        right[f] = samples[i + 1];
      }
    }
    return { left, right };
  } finally {
    tempos.forEach((e, i) => (e.beatsPerMinute = original[i]));
  }
}
