// Синт-минус (этап 11; операция render воркера): AlphaSynth с заглушкой вывода и exportAudio по MidiFile партитуры
// (того же, что строит таймлайн, формат 0). Минус — все дорожки, кроме партии игрока (основной и вторичный MIDI-канал её
// дорожки), гайд — она одна. Скорость — множитель темпа событий MidiFile. Саундфонт — MuseScore General от главного
// потока, без него — SONiVOX из пакета alphaTab (встроен в чанк воркера: под file:// fetch не работает).
// Перегруженные гитары (GM 29/30) рендерятся чистым тоном по одной и идут через модель усилителя (tone.ts). Ударные —
// живым китом AVL Black Pearl (свой саундфонт, отдельный проход; чего в ките нет — киту саундфонта). Поверх минуса и
// гайда — комната. Каждый проход рендера — копия MidiFile только со своими каналами: нота синтезируется один раз.
import * as alphaTab from '@coderline/alphatab';
import sonivox from '@coderline/alphatab/soundfont/sonivox.sf3?inline';
import { ampSim, panInto, room, type AmpModel } from './tone';

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
let drumKit: Uint8Array | null = null;
/** Кит ударных AVL Black Pearl (главный поток передаёт его воркеру); null — ударные саундфонта. */
export function setDrumKit(bytes: Uint8Array | null): void {
  drumKit = bytes;
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

/** Перегруз по GM-программе дорожки: Overdriven Guitar — кранч, Distortion Guitar — хай-гейн. */
const AMP_OF: Partial<Record<number, AmpModel>> = { 29: 'crunch', 30: 'high-gain' };
/** Вход модели усилителя: Electric Guitar (clean). */
const DI_PROGRAM = 27;
const DRUM_CHANNEL = 9;
/**
 * Ноты GM-ударных → ноты кита AVL (раскладка не GM: 48 — хай-хэт «swish», 50 — заглушённый крэш). Томы GM — на два
 * барабана кита (центр и край), китайская — на третий крэш. Нет в таблице — играет кит саундфонта.
 */
export const KIT_NOTES: Readonly<Partial<Record<number, number>>> = {
  35: 36, 36: 36, 37: 37, 38: 38, 39: 39, 40: 40,
  41: 41, 43: 43, 45: 45, 47: 45, 48: 47, 50: 47,
  42: 42, 44: 44, 46: 46,
  49: 49, 51: 51, 52: 60, 53: 53, 54: 54, 55: 55, 56: 56, 57: 57, 59: 59, 70: 61,
};
/** Канал кита в его проходе: кит — мелодический пресет 0 своего саундфонта. */
const KIT_CHANNEL = 0;
/**
 * Громкость кита относительно ударных MuseScore General на той же дорожке (по K-взвешенной громкости BS.1770): баланс
 * дорожек остаётся тем, что в файле.
 */
const KIT_GAIN = 1.3;
/** Пик минуса и гайда вместе на полной громкости (транспорт складывает слои как есть): выше — оба тише поровну. */
const HEADROOM = 0.9;
/** Панорамы разведённых перегруженных гитар по порядку дорожек. */
const SPREAD = [-0.7, 0.7, -0.35, 0.35];
/**
 * Уровень гитары после усилителя (RMS по громким блокам, до панорамы): по громкости (K-взвешивание BS.1770) — как у
 * Distortion Guitar MuseScore General на полной громкости дорожки, так что баланс дорожек остаётся тем, что в файле.
 */
const AMP_LEVEL = 0.018;

export interface TrackVoice {
  channels: number[];
  /** Ударные: при загруженном ките — его проход. */
  drums: boolean;
  /** Через модель усилителя; null — сэмплы саундфонта как есть (громкость и панораму ставит синтезатор). */
  amp: AmpModel | null;
  /** Панорама −1…1 и громкость дорожки — для гитар через усилитель (их DI рендерится по центру). */
  pan: number;
  gain: number;
}

/** Как звучит каждая дорожка партитуры (по индексу дорожки). */
export function voicesOf(score: alphaTab.model.Score): TrackVoice[] {
  const ampOf = (t: alphaTab.model.Track) => (t.staves.some((s) => s.isPercussion) ? null : (AMP_OF[t.playbackInfo.program] ?? null));
  const amped = score.tracks.filter(ampOf);
  // Две и больше перегруженных гитар, и все по центру (так в большинстве GP-файлов), — разводим, как в студийном миксе.
  const spread = amped.length >= 2 && amped.every((t) => t.playbackInfo.balance === 8);
  return score.tracks.map((t) => {
    const k = amped.indexOf(t);
    return {
      channels: channelsOf(t), amp: ampOf(t), drums: t.staves.some((s) => s.isPercussion),
      pan: spread && k >= 0 ? SPREAD[k % SPREAD.length] : (t.playbackInfo.balance - 8) / 8,
      // громкость дорожки alphaSynth: куб доли CC7 (alphaTab ставит CC7 = 8 × громкость GP)
      gain: (Math.min(16, Math.max(0, t.playbackInfo.volume)) / 16) ** 3,
    };
  });
}

/** Пустая копия MidiFile с теми же форматом, разрешением и сдвигом. */
function emptyLike(midiFile: alphaTab.midi.MidiFile): alphaTab.midi.MidiFile {
  const out = new alphaTab.midi.MidiFile();
  out.format = midiFile.format;
  out.division = midiFile.division;
  out.tickShift = midiFile.tickShift;
  return out;
}
const isKitNote = (e: alphaTab.midi.MidiEvent & { channel?: number; noteKey?: number }) =>
  e.channel === DRUM_CHANNEL && e.noteKey !== undefined && KIT_NOTES[e.noteKey] !== undefined;

/**
 * Копия MidiFile для прохода рендера: общие события (темп, размер, конец дорожки — длина рендера та же) и события только
 * каналов keep. di — их программа заменяется чистой электрогитарой по центру: вход модели усилителя. withoutKit — ноты
 * ударных, которые играет кит (kitPass), не берутся. Исходный MidiFile не меняется — его держит кэш воркера.
 */
export function midiPass(
  midiFile: alphaTab.midi.MidiFile, keep: ReadonlySet<number>, { di = false, withoutKit = false }: { di?: boolean; withoutKit?: boolean } = {},
): alphaTab.midi.MidiFile {
  const out = emptyLike(midiFile);
  const { ProgramChangeEvent, ControlChangeEvent, ControllerType } = alphaTab.midi;
  for (const e of midiFile.events as Array<alphaTab.midi.MidiEvent & { channel?: number }>) {
    if (e.channel === undefined) out.addEvent(e);
    else if (!keep.has(e.channel) || (withoutKit && isKitNote(e))) continue;
    else if (di && e instanceof ProgramChangeEvent) out.addEvent(new ProgramChangeEvent(e.track, e.tick, e.channel, DI_PROGRAM));
    else if (di && e instanceof ControlChangeEvent && e.controller === ControllerType.PanCoarse)
      out.addEvent(new ControlChangeEvent(e.track, e.tick, e.channel, e.controller, 64));
    else out.addEvent(e);
  }
  return out;
}

/**
 * Проход кита: ноты ударных из таблицы KIT_NOTES — его нотами на канале кита, туда же громкость, панорама и экспрессия
 * дорожки ударных; смена банка и программы не переносится (кит — пресет 0 своего саундфонта).
 */
export function kitPass(midiFile: alphaTab.midi.MidiFile): alphaTab.midi.MidiFile {
  const out = emptyLike(midiFile);
  const { NoteOnEvent, NoteOffEvent, ControlChangeEvent, ControllerType, ProgramChangeEvent } = alphaTab.midi;
  const carried: number[] = [ControllerType.VolumeCoarse, ControllerType.PanCoarse, ControllerType.ExpressionControllerCoarse];
  out.addEvent(new ProgramChangeEvent(0, 0, KIT_CHANNEL, 0));
  for (const e of midiFile.events as Array<alphaTab.midi.MidiEvent & { channel?: number }>) {
    if (e.channel === undefined) out.addEvent(e);
    else if (e.channel !== DRUM_CHANNEL) continue;
    else if (e instanceof NoteOnEvent || e instanceof NoteOffEvent) {
      const key = KIT_NOTES[e.noteKey];
      if (key === undefined) continue;
      const Note = e instanceof NoteOnEvent ? NoteOnEvent : NoteOffEvent;
      out.addEvent(new Note(e.track, e.tick, KIT_CHANNEL, key, e.noteVelocity));
    } else if (e instanceof ControlChangeEvent && carried.includes(e.controller))
      out.addEvent(new ControlChangeEvent(e.track, e.tick, KIT_CHANNEL, e.controller, e.value));
  }
  return out;
}

/** Микс набора дорожек: сэмплы GM одним проходом, перегруженные гитары — по одной через усилитель; поверх — комната. */
function renderVoices(midiFile: alphaTab.midi.MidiFile, voices: readonly TrackVoice[], sampleRate: number, speed: number): StereoPcm {
  const synth = synthFor(midiFile, sampleRate);
  const plain = new Set(voices.filter((v) => !v.amp).flatMap((v) => v.channels));
  const kit = drumKit && voices.some((v) => v.drums) ? drumKit : null;
  // проход GM — всегда, даже пустой: он задаёт длину и тишину минуса у песни из одной партии
  const out = renderMidi(midiPass(midiFile, plain, { withoutKit: !!kit }), sampleRate, speed, {}, synth);
  if (kit) {
    const drums = renderMidi(kitPass(midiFile), sampleRate, speed, {}, presetHost('kit', kit, new Set([0]), new Set(), sampleRate));
    const n = Math.min(out.left.length, drums.left.length);
    for (let i = 0; i < n; i++) {
      out.left[i] += drums.left[i] * KIT_GAIN;
      out.right[i] += drums.right[i] * KIT_GAIN;
    }
  }
  for (const v of voices) {
    if (!v.amp) continue;
    const di = renderMidi(midiPass(midiFile, new Set(v.channels), { di: true }), sampleRate, speed, {}, synth);
    for (let i = 0; i < di.left.length; i++) di.left[i] = (di.left[i] + di.right[i]) * 0.5;
    panInto(out, ampSim(di.left, sampleRate, v.amp, AMP_LEVEL), v.pan, v.gain);
  }
  room(out, sampleRate);
  return out;
}

/** Минус (все дорожки, кроме партии игрока) и гайд (она одна) с общим запасом по пику HEADROOM. */
export function renderSong(midiFile: alphaTab.midi.MidiFile, voices: readonly TrackVoice[], player: number, sampleRate: number, speed: number) {
  const minus = renderVoices(midiFile, voices.filter((_, i) => i !== player), sampleRate, speed);
  const guide = renderVoices(midiFile, voices.filter((_, i) => i === player), sampleRate, speed);
  let peak = 0;
  for (let i = 0; i < minus.left.length; i++)
    peak = Math.max(peak, Math.abs(minus.left[i] + (guide.left[i] ?? 0)), Math.abs(minus.right[i] + (guide.right[i] ?? 0)));
  if (peak > HEADROOM) {
    const g = HEADROOM / peak;
    for (const a of [minus.left, minus.right, guide.left, guide.right]) for (let i = 0; i < a.length; i++) a[i] *= g;
  }
  return { minus, guide };
}

// Синтезаторы с загруженными пресетами — песни (саундфонт) и кита ударных: саундфонт разбирается и его сэмплы (в SF3 —
// Vorbis) декодируются один раз на набор программ песни, а не на каждый проход рендера; экспортёры проходов берут
// готовые пресеты.
const hosts = new Map<'song' | 'kit', { soundFont: Uint8Array; key: string; synth: alphaTab.synth.AlphaSynth }>();

function presetHost(role: 'song' | 'kit', sf: Uint8Array, programs: Set<number>, drums: Set<number>, sampleRate: number) {
  const { ProgramChangeEvent, NoteOnEvent, EndOfTrackEvent } = alphaTab.midi;
  const key = `${[...programs].sort((a, b) => a - b)}|${[...drums].sort((a, b) => a - b)}`;
  const hit = hosts.get(role);
  if (hit?.soundFont === sf && hit.key === key) return hit.synth;
  hit?.synth.destroy();
  // Набор программ alphaSynth берёт из загруженного MidiFile: хватает программ и нот ударных на нулевом тике.
  const union = new alphaTab.midi.MidiFile();
  for (const p of programs) union.addEvent(new ProgramChangeEvent(0, 0, 0, p));
  for (const k of drums) union.addEvent(new NoteOnEvent(0, 0, DRUM_CHANNEL, k, 100));
  union.addEvent(new EndOfTrackEvent(0, 0));
  const synth = new alphaTab.synth.AlphaSynth(silentOutput(sampleRate), CHUNK_MS);
  synth.isReady = true; // вывод-заглушка о готовности не сообщает, а без неё пресеты не грузятся
  synth.loadSoundFont(sf, false);
  synth.loadMidiFile(union);
  hosts.set(role, { soundFont: sf, key, synth });
  return synth;
}

/** Синтезатор с пресетами всех программ и ударных песни и программы DI. */
function synthFor(midiFile: alphaTab.midi.MidiFile, sampleRate: number): alphaTab.synth.AlphaSynth {
  const { ProgramChangeEvent, NoteOnEvent } = alphaTab.midi;
  const programs = new Set([DI_PROGRAM]), drums = new Set<number>();
  for (const e of midiFile.events) {
    if (e instanceof ProgramChangeEvent && e.channel !== DRUM_CHANNEL) programs.add(e.program);
    else if (e instanceof NoteOnEvent && e.channel === DRUM_CHANNEL) drums.add(e.noteKey);
  }
  return presetHost('song', soundFontBytes(), programs, drums, sampleRate);
}

/**
 * Рендер MidiFile в стерео PCM на sampleRate; speed — множитель темпа (0.5 — вдвое медленнее). synth — с пресетами
 * программ этого файла; у прохода по части каналов — синтезатор всей песни.
 */
export function renderMidi(
  midiFile: alphaTab.midi.MidiFile, sampleRate: number, speed: number, pass: RenderPass, synth = synthFor(midiFile, sampleRate),
): StereoPcm {
  const tempos = midiFile.events.filter((e): e is alphaTab.midi.TempoChangeEvent => e instanceof alphaTab.midi.TempoChangeEvent);
  const original = tempos.map((e) => e.beatsPerMinute);
  for (const e of tempos) e.beatsPerMinute *= speed;
  try {
    const options = new alphaTab.synth.AudioExportOptions();
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
