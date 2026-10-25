// Сквозная проверка распознавания на звуке: партия гитары демо-песни «Первый свет», синтезированная соло (идеальное
// исполнение синтезатором alphaTab, SONiVOX), → те же исходники ворклетов, что в браузерном пути (вокальное WASM-ядро
// высоты и детектор атак), в имитации AudioWorklet → кадры → гитарный судья. Почти все события засчитаны, «не та
// нота» — редкость; по ходу печатается сводка по видам вердиктов. Атак детектор находит не все (в переборе новая нота
// звучит поверх прошлой) — остальные судья берёт по смене высоты; атак при этом не больше, чем событий × 1.5.
// Отклик дорожке: попадание сообщается по кадрам, а не по закрытию события — медиана меньше 30 мс после удара, 90 % —
// меньше 80 мс; ранний отклик почти всегда совпадает с итогом. Двузвучия на низких струнах YIN слышит плохо (редкие
// ложные кадры) — они засчитаны по удару, не «не та нота».
import * as alphaTab from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFrame, FRAME_FLOATS } from '../../audio/AudioInput';
import type { InputFrame } from '../../audio/instrument/session';
import { ONSET_PROCESSOR_SOURCE } from '../../audio/instrument/onsetProcessorSource';
import { PITCH_PROCESSOR_SOURCE } from '../../audio/pitchProcessorSource';
import { channelsOf, renderMidi } from '../backing/render';
import { buildTimeline } from '../import/timeline';
import { convertScore } from '../import/toArrangement';
import { buildPlayableMap } from '../model/playable';
import { createConverter } from '../vendor/fretfall/fromScore.js';
import { guitarJudge } from './guitarJudge';

const RATE = 48000;
const BLOCK = 128;
const YIN_HALF_WINDOW = 896;
const demo = readFileSync(new URL('../demo/demo.alphatex', import.meta.url), 'utf8');

interface Shim {
  messages: unknown[];
  process(block: Float32Array, time: number): void;
}

/** Процессор ворклета из исходника-строки в имитации AudioWorkletGlobalScope (currentTime, sampleRate, порт). */
function worklet(source: string, name: string, processorOptions: object): Shim {
  const scope = { currentTime: 0, sampleRate: RATE };
  const messages: unknown[] = [];
  class AudioWorkletProcessor {
    port = { postMessage: (m: unknown) => messages.push(m), onmessage: null as unknown };
  }
  let Processor: (new (options: object) => { process(inputs: Float32Array[][]): boolean }) | null = null;
  const registerProcessor = (n: string, cls: typeof Processor) => {
    if (n === name) Processor = cls;
  };
  // eslint-free тест: исходник ворклета читает currentTime и sampleRate как глобалы — подставляются через with
  new Function('AudioWorkletProcessor', 'registerProcessor', 'scope', `with (scope) { ${source} }`)(AudioWorkletProcessor, registerProcessor, scope);
  if (!Processor) throw Error(`процессор ${name} не зарегистрирован`);
  const processor = new (Processor as unknown as new (options: object) => { process(inputs: Float32Array[][]): boolean })({ processorOptions });
  return {
    messages,
    process(block, time) {
      scope.currentTime = time;
      processor.process([[block]]);
    },
  };
}

async function demoFrames(): Promise<{ frames: InputFrame[]; map: ReturnType<typeof buildPlayableMap> }> {
  // партия игрока соло — как гайд в игре
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(demo, settings);
  createConverter(alphaTab).prepareScore(score);
  const { midiFile } = buildTimeline(score, settings);
  const pcm = renderMidi(midiFile, RATE, 1, { solo: channelsOf(score.tracks[0]) });

  const parsedSettings = new alphaTab.Settings();
  const parsed = alphaTab.importer.ScoreLoader.loadAlphaTex(demo, parsedSettings);
  const arr = convertScore({ score: parsed, settings: parsedSettings, encoding: 'utf-8', warnings: [] }, { format: 'gp7', fileSha256: 'demo' }).arrangements[0];
  const map = buildPlayableMap(arr, { kind: 'synth', speed: 1, leadInMs: 0 }, { mode: 'max' });

  const module = await WebAssembly.compile(readFileSync(new URL('../../assets/dsp.wasm', import.meta.url)));
  const pitch = worklet(PITCH_PROCESSOR_SOURCE, 'pitch-processor', { module, gateRms: 0.003, gateClarity: 0.5 });
  const onset = worklet(ONSET_PROCESSOR_SOURCE, 'pupitre-onset', {});
  // моно: среднее каналов рендера (как сведение «Оба»)
  const mono = new Float32Array(pcm.left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (pcm.left[i] + pcm.right[i]);
  for (let i = 0; i + BLOCK <= mono.length; i += BLOCK) {
    const block = mono.slice(i, i + BLOCK);
    pitch.process(block, i / RATE);
    onset.process(block, i / RATE);
  }
  const frames: InputFrame[] = [];
  for (const m of pitch.messages as Array<{ t0: number; frames: Float32Array }>) {
    for (let o = 0; o + FRAME_FLOATS <= m.frames.length; o += FRAME_FLOATS) {
      const f = decodeFrame(m.frames, o, m.t0);
      frames.push({
        atMs: (f.t - YIN_HALF_WINDOW / RATE) * 1000, midi: f.voiced && Number.isFinite(f.midiRaw) ? f.midiRaw : NaN,
        clarity: f.clarity, levelDb: 20 * Math.log10(Math.max(1e-9, f.rms)), onset: false,
      });
    }
  }
  for (const m of onset.messages as Array<{ t: number; peak: number }>) {
    frames.push({ atMs: m.t * 1000, midi: NaN, clarity: 0, levelDb: 20 * Math.log10(m.peak), onset: true });
  }
  frames.sort((a, b) => a.atMs - b.atMs || Number(b.onset) - Number(a.onset));
  return { frames, map };
}

describe('распознавание на звуке синтезатора', () => {
  it('демо-песня соло: засчитано ≥ 90 % событий, «не та нота» ≤ 5 %, ложных атак нет', async () => {
    const { frames, map } = await demoFrames();
    let frameMs = 0;
    const firstTold: Array<{ kind: string; delayMs: number } | undefined> = [];
    const judge = guitarJudge({ map, difficulty: 'medium' }, {
      toClock: (ms) => ms / 1000, a4Hz: 440, strictness: 'normal',
      onStatus: (i, status, v) => {
        if (status === 'attacked' || status === 'none' || firstTold[i]) return;
        firstTold[i] = { kind: status, delayMs: frameMs - (map.notes[i].startMs + (v?.offsetMs ?? 0)) };
      },
    });
    judge.onBegin(0);
    map.notes.forEach((_, i) => judge.reset(i, 0));
    for (const f of frames) {
      frameMs = f.atMs;
      judge.onFrame(f, f.atMs);
    }
    const toldEarly = firstTold.slice();
    const verdicts = map.notes.map((_, i) => judge.finalize(i));
    const judged = verdicts.filter((v) => v.kind !== 'skipped');
    const count = (kinds: string[]) => judged.filter((v) => kinds.includes(v.kind!)).length;
    const hits = count(['hit', 'early', 'late']);
    const wrong = count(['wrong']);
    const offsets = judged.filter((v) => v.offsetMs !== undefined && v.kind !== 'wrong').map((v) => v.offsetMs!).sort((a, b) => a - b);
    const onsets = frames.filter((f) => f.onset).length;
    const missed = verdicts.map((v, i) => [v, map.notes[i]] as const).filter(([v]) => v.kind === 'missed' || v.kind === 'wrong');
    console.log(missed.map(([v, e]) => `${v.kind} ${Math.round(e.startMs)} мс: ${e.notes.map((n) => `${n.string}/${n.fret} (${n.midi})`).join(' ')}` +
      (v.heardMidi === undefined ? '' : `, слышно ${v.heardMidi.toFixed(2)}`)).join('\n'));
    console.log(
      `событий ${judged.length}: попаданий ${hits} (точно ${count(['hit'])}, рано ${count(['early'])}, поздно ${count(['late'])}), ` +
        `не та ${wrong}, пропуск ${count(['missed'])}; атак ${onsets}; медиана смещения ${offsets[offsets.length >> 1]} мс`,
    );
    const hitKinds = ['hit', 'early', 'late'];
    const delays = toldEarly.filter((x) => x && hitKinds.includes(x.kind)).map((x) => x!.delayMs).sort((a, b) => a - b);
    const flips = verdicts.filter((v, i) => toldEarly[i] && hitKinds.includes(toldEarly[i]!.kind) !== hitKinds.includes(v.kind!)).length;
    console.log(`ранний отклик попадания: ${delays.length} событий, медиана ${delays[delays.length >> 1]?.toFixed(1)} мс после удара, ` +
      `90 % — до ${delays[Math.floor(delays.length * 0.9)]?.toFixed(1)} мс; разошлись с итогом: ${flips}`);
    expect(delays.length).toBeGreaterThanOrEqual(hits * 0.9);
    expect(delays[delays.length >> 1]).toBeLessThan(30);
    expect(delays[Math.floor(delays.length * 0.9)]).toBeLessThan(80);
    expect(flips).toBeLessThanOrEqual(2);
    expect(judged.length).toBeGreaterThan(60);
    expect(hits / judged.length).toBeGreaterThanOrEqual(0.9);
    expect(wrong / judged.length).toBeLessThanOrEqual(0.05);
    expect(onsets).toBeGreaterThan(judged.length * 0.5);
    expect(onsets).toBeLessThan(judged.length * 1.5);
  }, 60000);
});
