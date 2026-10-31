// Офлайн-рендер дубля через tone.wasm (экспорт WAV): то же ядро, что в мониторинге, блоками по 4096 сэмплов (размер
// буфера ядра); после конца — тишина хвоста дилея и комнаты. Между блоками — уступка главному потоку: длинный дубль не
// замораживает интерфейс.
import { toneModule } from './toneModule';

interface ToneDsp {
  memory: WebAssembly.Memory;
  tone_init(rate: number): void;
  tone_buf_ptr(): number;
  tone_set(id: number, value: number): void;
  tone_process(n: number): void;
}

const BLOCK = 4096;
/** Рендер уступает главному потоку не реже, мс. */
const SLICE_MS = 25;

/** DI → звук с параметрами ядра по номерам (toneParams); tailSec — сколько тишины доиграть после конца. */
export async function renderTone(
  dry: Float32Array, sampleRate: number, params: readonly number[], options: { tailSec?: number; onProgress?: (share: number) => void } = {},
): Promise<Float32Array<ArrayBuffer>> {
  const dsp = (await WebAssembly.instantiate(await toneModule(), {})).exports as unknown as ToneDsp;
  dsp.tone_init(sampleRate);
  params.forEach((value, id) => dsp.tone_set(id, value));
  const out = new Float32Array(dry.length + Math.max(0, Math.round((options.tailSec ?? 0) * sampleRate)));
  let slice = performance.now();
  for (let o = 0; o < out.length; o += BLOCK) {
    const n = Math.min(BLOCK, out.length - o);
    // memory.buffer перечитываем каждый блок: после роста памяти старый detached
    const buf = new Float32Array(dsp.memory.buffer, dsp.tone_buf_ptr(), n);
    const have = Math.max(0, Math.min(n, dry.length - o));
    if (have) buf.set(dry.subarray(o, o + have));
    buf.fill(0, have);
    dsp.tone_process(n);
    out.set(new Float32Array(dsp.memory.buffer, dsp.tone_buf_ptr(), n), o);
    if (performance.now() - slice > SLICE_MS) {
      options.onProgress?.(o / out.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
      slice = performance.now();
    }
  }
  options.onProgress?.(1);
  return out;
}
