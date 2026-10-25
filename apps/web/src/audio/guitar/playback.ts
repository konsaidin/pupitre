// Звук гитарного раздела (инв. 4: аудио-API и устройства — только в audio/**): контекст воспроизведения игры и
// AudioBuffer синт-минуса. Раздел пользуется только этим модулем и типом PlaybackContext.
export type PlaybackContext = AudioContext;

export function createPlaybackContext(): PlaybackContext {
  return new AudioContext({ latencyHint: 'interactive' });
}

/** Частота рендера минуса: частота контекста при 44 100 / 48 000 Гц, иначе 48 000 (ресемплирует контекст). */
export const renderRateFor = (contextRate: number) => (contextRate === 44100 || contextRate === 48000 ? contextRate : 48000);

/** Стерео-буфер из PCM; AudioBuffer не привязан к контексту — переживает пересоздание контекста (StrictMode). */
export function stereoBuffer(ctx: PlaybackContext, left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>, sampleRate: number): AudioBuffer {
  const buffer = ctx.createBuffer(2, Math.max(1, left.length), sampleRate);
  buffer.copyToChannel(left, 0);
  buffer.copyToChannel(right, 1);
  return buffer;
}

/**
 * Часы того, что слышно: время звука (часы performance.now, мс) → время контекста, которое в этот момент звучало из
 * колонок (getOutputTimestamp); без него — currentTime минус задержка вывода. Игрок играет под то, что слышит, — его
 * удар сравнивается с этим временем песни.
 */
export function heardClock(ctx: PlaybackContext): (atMs: number) => number {
  return (atMs) => {
    const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (stamp && Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime) && (stamp.performanceTime ?? 0) > 0) {
      return stamp.contextTime! + (atMs - stamp.performanceTime!) / 1000;
    }
    return ctx.currentTime - outputDelayMs(ctx) / 1000 - (performance.now() - atMs) / 1000;
  };
}

/** Задержка вывода контекста, мс (базовая + выходная; браузер может не сообщить выходную). */
export function outputDelayMs(ctx: PlaybackContext): number {
  return ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000;
}
