// Прослушивание дубля: DI → ворклет тона (параметры — как у мониторинга; меняются на лету — ручки крутятся вживую, это и
// есть ре-ампинг) → индикатор → выход. «Сухой» — тот же путь с ядром в обходе. Контекст воспроизведения — свой, один на
// вкладку (создаётся при первом прослушивании, по жесту игрока). Хвост дилея и комнаты доигрывает сам ворклет.
import { changedToneParams } from './tone';
import { addToneWorklet } from './toneModule';
import { createPlaybackContext, type PlaybackContext } from './playback';

export interface TakePlayback {
  readonly duration: number;
  /** Позиция в дубле, с. */
  position(): number;
  /** RMS выхода за последние ≈ 40 мс, dBFS. */
  levelDb(): number;
  setTone(params: readonly number[]): void;
  stop(): void;
  /** Дубль доиграл (не зовётся после stop()). */
  onEnded: (() => void) | null;
}

let context: PlaybackContext | null = null;
const FADE_S = 0.012;

export async function playTake(samples: Float32Array<ArrayBuffer>, sampleRate: number, params: readonly number[], fromSec = 0): Promise<TakePlayback> {
  context ??= createPlaybackContext();
  const ctx = context;
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const module = await addToneWorklet(ctx);
  const buffer = ctx.createBuffer(1, Math.max(1, samples.length), sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  let sent = params;
  const tone = new AudioWorkletNode(ctx, 'pupitre-tone', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { module, params: changedToneParams(null, params) },
  });
  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  const gain = ctx.createGain();
  source.connect(tone).connect(meter).connect(gain).connect(ctx.destination);
  const from = Math.min(Math.max(0, fromSec), buffer.duration);
  const startedAt = ctx.currentTime + 0.02;
  source.start(startedAt, from);
  const probe = new Float32Array(meter.fftSize);
  let stopped = false;
  const playback: TakePlayback = {
    duration: buffer.duration,
    position: () => Math.min(buffer.duration, from + Math.max(0, ctx.currentTime - startedAt)),
    levelDb() {
      meter.getFloatTimeDomainData(probe);
      let sum = 0;
      for (let i = 0; i < probe.length; i++) sum += probe[i] * probe[i];
      return sum > 0 ? 10 * Math.log10(sum / probe.length) : -Infinity;
    },
    setTone(next) {
      const pairs = changedToneParams(sent, next);
      sent = next;
      if (pairs.length && !stopped) tone.port.postMessage({ type: 'set', params: pairs });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      source.onended = null;
      // короткий спад — без щелчка
      gain.gain.setTargetAtTime(0, ctx.currentTime, FADE_S);
      setTimeout(() => {
        try {
          source.stop();
        } catch {
          // уже остановлен
        }
        source.disconnect();
        tone.port.close();
        tone.disconnect();
        gain.disconnect();
      }, 80);
    },
    onEnded: null,
  };
  source.onended = () => {
    if (!stopped) playback.onEnded?.();
  };
  return playback;
}
