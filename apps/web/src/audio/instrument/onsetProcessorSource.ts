// Исходник AudioWorklet-процессора атак (браузерный путь входа гитары) — строкой, как pitchProcessorSource.ts. Тот же
// алгоритм, что в движке (packages/engine/src/analysis.rs, Onsets): блоки по 64 сэмпла; атака — пик блока в 2.5 раза
// выше огибающей предыдущих 21 мс (скользящий максимум 16 блоков) или всплеск производной (щелчок медиатора) вчетверо выше
// её огибающей (калибровка на GuitarSet, harness/judge-guitarset.ts: лишних атак вдвое меньше при той же полноте); громче порогов, не чаще раза в 60 мс. Сообщение — { t: время контекста начала блока, peak }.
// Пороги — processorOptions (rise, riseHf, gate, gateHf, refractory); по умолчанию — как в движке.

export const ONSET_PROCESSOR_SOURCE = /* js */ `
class OnsetProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.rise = o.rise ?? 2.5;
    this.riseHf = o.riseHf ?? 4;
    this.gate = o.gate ?? 0.0032;
    this.gateHf = o.gateHf ?? 0.0016;
    this.refractory = o.refractory ?? 0.06;
    this.peaks = new Float32Array(16);
    this.peaksHf = new Float32Array(16);
    this.pos = 0;
    this.peak = 0;
    this.peakHf = 0;
    this.fill = 0;
    this.prev = 0;
    this.last = -1;
    this.blockStart = -1;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      if (this.fill === 0) this.blockStart = currentTime + i / sampleRate;
      const x = ch[i];
      const a = x < 0 ? -x : x;
      if (a > this.peak) this.peak = a;
      const d = x - this.prev < 0 ? this.prev - x : x - this.prev;
      if (d > this.peakHf) this.peakHf = d;
      this.prev = x;
      if (++this.fill < 64) continue;
      let env = 0, envHf = 0;
      for (let k = 0; k < 16; k++) {
        if (this.peaks[k] > env) env = this.peaks[k];
        if (this.peaksHf[k] > envHf) envHf = this.peaksHf[k];
      }
      this.peaks[this.pos] = this.peak;
      this.peaksHf[this.pos] = this.peakHf;
      this.pos = (this.pos + 1) % 16;
      const rose = this.peak > this.gate && this.peak > env * this.rise;
      const clicked = this.peakHf > this.gateHf && this.peakHf > envHf * this.riseHf;
      if ((rose || clicked) && (this.last < 0 || this.blockStart - this.last >= this.refractory)) {
        this.last = this.blockStart;
        this.port.postMessage({ t: this.blockStart, peak: this.peak });
      }
      this.peak = 0;
      this.peakHf = 0;
      this.fill = 0;
    }
    return true;
  }
}
registerProcessor('pupitre-onset', OnsetProcessor);
`;
