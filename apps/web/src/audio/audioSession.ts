// Единственный AudioContext и AudioInput на всё приложение.

import type { AudioInput, MicOptions } from './AudioInput';
import { NativeAudioInput, nativeAudioBridge } from './NativeAudioInput';
import { WorkletAudioInput } from './WorkletAudioInput';

let ctx: AudioContext | null = null;
let input: AudioInput | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  return ctx;
}

/** Аудиовход приложения: нативный захват (Electron) либо AudioWorklet. */
export function getAudioInput(): AudioInput {
  if (!input) {
    const bridge = nativeAudioBridge();
    input = bridge
      ? new NativeAudioInput(getAudioContext(), bridge)
      : new WorkletAudioInput(getAudioContext());
  }
  return input;
}

/** Запустить микрофон (запросит разрешение при первом вызове). */
export async function ensureMic(deviceId?: string | null, opts?: MicOptions): Promise<AudioInput> {
  const inp = getAudioInput();
  await getAudioContext().resume();
  try {
    await inp.start(deviceId ?? null, opts);
  } catch (e) {
    // нативный тракт не завёлся (нет устройств, драйвер отказал) —
    // деградируем до worklet-пути, приложение остаётся рабочим
    if (inp.kind === 'native') {
      console.warn('нативный захват не запустился, фолбэк на worklet:', e);
      const fallback = new WorkletAudioInput(getAudioContext());
      input = fallback;
      try {
        await fallback.start(deviceId ?? null, opts);
      } catch {
        // сохранённый id устройства мог быть нативным — пробуем по умолчанию
        await fallback.start(null, opts);
      }
      return fallback;
    }
    throw e;
  }
  return inp;
}

export function stopMic(): void {
  input?.stop();
}
