// tone.wasm (гитарный процессор packages/dsp/src/tone.rs; только гитарный чанк): компилируется один раз на страницу —
// мониторинг (ворклет сессии входа), прослушивание дублей с живым тоном и офлайн-рендер экспорта. Ворклет 'pupitre-tone'
// регистрируется в каждом контексте отдельно (addToneWorklet).
// data-URI, а не ?url: под file:// в Electron fetch ассетов не работает (как WorkletAudioInput)
import toneWasmDataUri from '../../assets/tone.wasm?inline';
import { TONE_PROCESSOR_SOURCE } from './toneProcessorSource';

let modulePromise: Promise<WebAssembly.Module> | null = null;

/** Байты tone.wasm из data-URI. */
export function toneWasmBytes(): Uint8Array<ArrayBuffer> {
  const bin = atob(toneWasmDataUri.slice(toneWasmDataUri.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function toneModule(): Promise<WebAssembly.Module> {
  modulePromise ??= WebAssembly.compile(toneWasmBytes());
  return modulePromise;
}

const registering = new WeakMap<BaseAudioContext, Promise<WebAssembly.Module>>();

/** Регистрирует ворклет тона в контексте (один раз на контекст, одновременные вызовы ждут одной регистрации — повторный
 *  registerProcessor бросил бы); вернёт модуль для processorOptions. Неудача — следующий вызов пробует снова. */
export function addToneWorklet(ctx: BaseAudioContext): Promise<WebAssembly.Module> {
  let pending = registering.get(ctx);
  if (!pending) {
    pending = (async () => {
      const module = await toneModule();
      const url = URL.createObjectURL(new Blob([TONE_PROCESSOR_SOURCE], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      return module;
    })();
    registering.set(ctx, pending);
    pending.catch(() => registering.delete(ctx));
  }
  return pending;
}
