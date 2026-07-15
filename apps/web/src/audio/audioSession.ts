// Единственный AudioContext и AudioInput на всё приложение.

import type { AudioInput, MicOptions } from './AudioInput';
import { WorkletAudioInput } from './WorkletAudioInput';

let ctx: AudioContext | null = null;
let input: AudioInput | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  return ctx;
}

/** Аудиовход приложения. Пока единственный бэкенд — AudioWorklet (веб). */
export function getAudioInput(): AudioInput {
  if (!input) input = new WorkletAudioInput(getAudioContext());
  return input;
}

/** Запустить микрофон (запросит разрешение при первом вызове). */
export async function ensureMic(deviceId?: string | null, opts?: MicOptions): Promise<AudioInput> {
  const inp = getAudioInput();
  await getAudioContext().resume();
  await inp.start(deviceId ?? null, opts);
  return inp;
}

export function stopMic(): void {
  input?.stop();
}
