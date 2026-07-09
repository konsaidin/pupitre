// Исходник AudioWorklet-процессора как строка: загружается через Blob URL,
// чтобы не зависеть от особенностей бандлинга worklet-модулей.
//
// Алгоритм — YIN (de Cheveigné & Kawahara, 2002) с CMNDF и параболической
// интерполяцией. Окно 1024, maxTau 768 (нижняя граница ~62 Гц при 48 кГц),
// шаг 512 сэмплов (~10.7 мс).

export const PITCH_PROCESSOR_SOURCE = /* js */ `
class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.win = 1024;
    this.maxTau = 768;
    this.hop = 512;
    this.bufSize = this.win + this.maxTau;
    this.buf = new Float32Array(this.bufSize);
    this.filled = 0;
    this.sinceHop = 0;
    this.diff = new Float32Array(this.maxTau + 1);
    this.cmndf = new Float32Array(this.maxTau + 1);
    this.threshold = 0.15;
    // короче периода ~1100 Гц голос не поём: поиск ниже tauMin ловит
    // только обертоны и даёт октавные срывы вверх
    this.tauMin = Math.max(4, Math.round(sampleRate / 1100));
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let offset = 0;
    while (offset < ch.length) {
      const space = this.bufSize - this.filled;
      const take = Math.min(space, ch.length - offset);
      this.buf.set(ch.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.bufSize) {
        this.analyze();
        this.buf.copyWithin(0, this.hop);
        this.filled -= this.hop;
      }
    }
    return true;
  }

  analyze() {
    const { buf, win, maxTau, diff, cmndf } = this;
    let rms = 0;
    for (let i = 0; i < win; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / win);
    // жёсткий пол ниже минимального гейта UI: сам гейт настраивается в PitchTracker
    if (rms < 0.002) {
      this.emit(0, 0, rms);
      return;
    }
    diff[0] = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      let sum = 0;
      for (let i = 0; i < win; i++) {
        const d = buf[i] - buf[i + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }
    cmndf[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      running += diff[tau];
      cmndf[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
    }
    // первый локальный минимум ниже порога
    let tauEst = -1;
    for (let tau = this.tauMin; tau < maxTau; tau++) {
      if (cmndf[tau] < this.threshold) {
        while (tau + 1 < maxTau && cmndf[tau + 1] < cmndf[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    if (tauEst === -1) {
      // fallback: глобальный минимум, если он достаточно выражен
      let best = this.tauMin;
      for (let tau = this.tauMin + 1; tau < maxTau; tau++) if (cmndf[tau] < cmndf[best]) best = tau;
      if (cmndf[best] < 0.35) tauEst = best;
    }
    if (tauEst === -1) {
      this.emit(0, 0, rms);
      return;
    }
    // анти-октава вверх: если минимум у двойного периода заметно глубже,
    // мы поймали 2-ю гармонику — берём вдвое больший период
    const tau2 = tauEst * 2;
    if (tau2 + 1 <= maxTau) {
      let t2 = tau2;
      while (t2 + 1 < maxTau && cmndf[t2 + 1] < cmndf[t2]) t2++;
      while (t2 - 1 > tauEst && cmndf[t2 - 1] < cmndf[t2]) t2--;
      if (cmndf[t2] < cmndf[tauEst] - 0.07) tauEst = t2;
    }
    // параболическая интерполяция вокруг минимума
    let tau = tauEst;
    if (tau > 1 && tau < maxTau) {
      const a = cmndf[tau - 1], b = cmndf[tau], c = cmndf[tau + 1];
      const denom = a - 2 * b + c;
      if (Math.abs(denom) > 1e-12) tau += (0.5 * (a - c)) / denom;
    }
    const freq = sampleRate / tau;
    const clarity = 1 - cmndf[tauEst];
    this.emit(freq, clarity, rms);
  }

  emit(freq, clarity, rms) {
    this.port.postMessage({ t: currentTime, freq, clarity, rms });
  }
}
registerProcessor('pitch-processor', PitchProcessor);
`;
