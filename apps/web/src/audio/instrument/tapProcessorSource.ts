// Исходник AudioWorklet-отвода сухого сигнала для записи дублей (как pitchProcessorSource.ts: строка, Blob URL). Моно-вход
// копится кусками по 4096 сэмплов (≈ 85 мс) и уходит в главный поток с передачей буфера; выходов нет. 'reset' — перед
// новой записью: недокопленный хвост прошлой не попадает в начало следующей.

export const TAP_PROCESSOR_SOURCE = /* js */ `
class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'reset') this.n = 0;
    };
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let i = 0;
    while (i < input.length) {
      const k = Math.min(input.length - i, this.buf.length - this.n);
      this.buf.set(input.subarray(i, i + k), this.n);
      this.n += k;
      i += k;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(4096);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pupitre-tap', TapProcessor);
`;
