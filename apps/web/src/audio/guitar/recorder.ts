// Запись дубля: сухой сигнал открытого входа (session.onInputAudio — у движка тот же отвод, что у анализа, у браузера —
// ворклет) копится кусками; остановка склеивает их в один Float32Array. Частота — первого куска (переоткрытие входа на
// другой частоте посреди записи даёт куски, которые пропускаются). Предел длины — MAX_TAKE_SECONDS: дальше запись
// останавливается сама. Пик и уровень последних 100 мс — для деки.
import { inputRecordable, onInputAudio } from '../instrument/session';

export const MAX_TAKE_SECONDS = 20 * 60;

export interface TakeAudio {
  sampleRate: number;
  samples: Float32Array<ArrayBuffer>;
  /** Пик, доля полной шкалы. */
  peak: number;
}

export interface Recording {
  /** Записано, с. */
  seconds(): number;
  /** RMS последнего куска, dBFS (−Infinity — тишина или кусков ещё нет). */
  levelDb(): number;
  peak(): number;
  /** Остановить и забрать запись; null — ни одного куска не пришло. */
  stop(): TakeAudio | null;
}

export { inputRecordable };

/** Начать запись; onLimit — запись упёрлась в предел и остановилась (stop() отдаст её). */
export function startRecording(onLimit?: () => void): Recording {
  const chunks: Float32Array[] = [];
  let rate = 0;
  let frames = 0;
  let peak = 0;
  let level = -Infinity;
  let limited = false;
  let off: (() => void) | null = onInputAudio((samples, sampleRate) => {
    if (!(sampleRate > 0)) return;
    if (!rate) rate = sampleRate;
    if (sampleRate !== rate || limited) return;
    const room = MAX_TAKE_SECONDS * rate - frames;
    const chunk = samples.length > room ? samples.slice(0, room) : samples.slice();
    chunks.push(chunk);
    frames += chunk.length;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i];
      sum += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    level = sum > 0 ? 10 * Math.log10(sum / Math.max(1, chunk.length)) : -Infinity;
    if (frames >= MAX_TAKE_SECONDS * rate) {
      limited = true;
      off?.();
      off = null;
      onLimit?.();
    }
  });
  return {
    seconds: () => (rate ? frames / rate : 0),
    levelDb: () => level,
    peak: () => peak,
    stop() {
      off?.();
      off = null;
      if (!frames) return null;
      const samples = new Float32Array(frames);
      let at = 0;
      for (const c of chunks) {
        samples.set(c, at);
        at += c.length;
      }
      chunks.length = 0;
      return { sampleRate: rate, samples, peak };
    },
  };
}
