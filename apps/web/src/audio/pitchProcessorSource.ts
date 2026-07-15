// Исходник AudioWorklet-процессора как строка: загружается через Blob URL,
// чтобы не зависеть от особенностей бандлинга worklet-модулей.
//
// Сам DSP (YIN + вибрато + расщепление + громкость) живёт в Rust-ядре
// packages/dsp, скомпилированном в WASM. Worklet — тонкий хост: пишет сэмплы
// в память ядра, зовёт dsp_process и пересылает готовые кадры анализа.
// Скомпилированный WebAssembly.Module приходит через processorOptions
// (Module структурно клонируем); new WebAssembly.Instance в worklet синхронный.

export const PITCH_PROCESSOR_SOURCE = /* js */ `
class PitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { module, gateRms, gateClarity } = options.processorOptions;
    const instance = new WebAssembly.Instance(module, {});
    this.dsp = instance.exports;
    this.dsp.dsp_init(sampleRate);
    this.dsp.dsp_set_gate(gateRms, gateClarity);
    this.inPtr = this.dsp.dsp_in_ptr();
    this.outPtr = this.dsp.dsp_out_ptr();
    this.frameFloats = this.dsp.dsp_frame_floats();
    this.startTime = -1;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.type === 'gate') this.dsp.dsp_set_gate(d.gateRms, d.gateClarity);
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // время первого сэмпла — начало отсчёта t кадров ядра
    if (this.startTime < 0) this.startTime = currentTime;
    // memory.buffer перечитываем каждый раз: после роста памяти старый detached
    new Float32Array(this.dsp.memory.buffer, this.inPtr, ch.length).set(ch);
    const n = this.dsp.dsp_process(ch.length);
    if (n > 0) {
      const len = n * this.frameFloats;
      // копия обязательна: выходной буфер ядра переиспользуется
      const flat = new Float32Array(len);
      flat.set(new Float32Array(this.dsp.memory.buffer, this.outPtr, len));
      this.port.postMessage({ t0: this.startTime, frames: flat }, [flat.buffer]);
    }
    return true;
  }
}
registerProcessor('pitch-processor', PitchProcessor);
`;
