// Исходник AudioWorklet-процессора гитарного тона как строка (как pitchProcessorSource.ts: Blob URL, без бандлинга
// ворклетов). Сам DSP — ядро packages/dsp (tone.rs), собранное отдельным tone.wasm: своя память, анализ высоты не мешает.
// Тонкий хост: моно-вход → буфер ядра → tone_process на месте → выход. Параметры — плоскими парами «номер, значение»
// в processorOptions.params при создании и сообщением { type: 'set', params } потом.

export const TONE_PROCESSOR_SOURCE = /* js */ `
class ToneProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { module, params } = options.processorOptions;
    this.dsp = new WebAssembly.Instance(module, {}).exports;
    this.dsp.tone_init(sampleRate);
    this.buf = this.dsp.tone_buf_ptr();
    this.set(params);
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'set') this.set(e.data.params);
    };
  }

  set(pairs) {
    for (let i = 0; pairs && i + 1 < pairs.length; i += 2) this.dsp.tone_set(pairs[i], pairs[i + 1]);
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    // memory.buffer перечитываем каждый раз: после роста памяти старый detached
    new Float32Array(this.dsp.memory.buffer, this.buf, input.length).set(input);
    this.dsp.tone_process(input.length);
    output.set(new Float32Array(this.dsp.memory.buffer, this.buf, input.length));
    return true;
  }
}
registerProcessor('pupitre-tone', ToneProcessor);
`;
