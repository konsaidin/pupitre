// Line a recording up with a chart: find audio = offset + ratio * chartTime that puts the chart's
// note onsets on the recording's attacks. No DOM, so `node sync.test.mjs` can check it.

const HOP = 128, FRAME = 1024, MIN_HZ = 150, MAX_HZ = 5000;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len, wr = Math.cos(angle), wi = Math.sin(angle), half = len / 2;
    for (let i = 0; i < n; i += len) {
      for (let j = 0, cr = 1, ci = 0; j < half; j++) {
        const a = i + j, b = a + half, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// Mono samples (ideally ~11 kHz) → how sharply the sound changes at each hop, local average removed.
// env[i] describes the moment start + i * hop (a frame is timed by its centre, not its first sample).
export function onsetEnvelope(samples, sampleRate) {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP));
  const lo = Math.round((MIN_HZ * FRAME) / sampleRate), hi = Math.min(FRAME / 2, Math.round((MAX_HZ * FRAME) / sampleRate));
  const hann = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  let prev = new Float64Array(FRAME / 2), mag = new Float64Array(FRAME / 2);
  const flux = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[f * HOP + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let k = lo; k < hi; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      sum += Math.max(0, mag[k] - prev[k]);
    }
    flux[f] = sum;
    [prev, mag] = [mag, prev];
  }
  const hop = HOP / sampleRate, half = Math.round(0.4 / hop), env = new Float32Array(frames);
  const prefix = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + flux[f];
  for (let f = 0; f < frames; f++) { // what sticks out above the surrounding 0.8 s
    const a = Math.max(0, f - half), b = Math.min(frames, f + half + 1);
    env[f] = Math.max(0, flux[f] - (prefix[b] - prefix[a]) / (b - a));
  }
  return { env, hop, start: FRAME / 2 / sampleRate };
}

const widen = (env, radius) => env.map((_, f) => {
  let m = 0;
  for (let d = -radius; d <= radius; d++) m = Math.max(m, env[f + d] ?? 0);
  return m;
});

// onsets: sorted chart times in seconds. Returns { offset, ratio, confidence } where confidence is how far the
// best fit stands above the envelope's average; below ~2 the recording probably doesn't match the chart.
export function align({ env, hop, start }, onsets, { minRatio = 0.9, maxRatio = 1.1 } = {}) {
  const audioSeconds = start + env.length * hop, first = onsets[0], last = onsets.at(-1);
  const fit = (e, ratio, offset) => {
    let sum = 0;
    for (const t of onsets) sum += e[Math.round((offset + ratio * t - start) / hop)] ?? 0;
    return sum / onsets.length;
  };
  // Coarse: for each ratio, every offset at once. On a grid of STEP hops, the onsets are spikes and the envelope is pooled to
  // its loudest in each cell; their cross-correlation, one FFT of each (the envelope's once), scores the chart at every shift
  const STEP = 4, cell = STEP * hop, coarse = widen(env, STEP), cells = Math.ceil(coarse.length / STEP);
  const pad = Math.ceil(10 / cell) + 2, reach = Math.ceil((maxRatio * last) / cell) + 1;
  let n = 1;
  while (n < cells + reach + 2 * pad) n <<= 1; // room for every shift without wrapping onto the envelope
  const envRe = new Float64Array(n), envIm = new Float64Array(n), re = new Float64Array(n), im = new Float64Array(n);
  for (let c = 0; c < cells; c++) for (let f = c * STEP; f < Math.min(coarse.length, (c + 1) * STEP); f++) envRe[c] = Math.max(envRe[c], coarse[f]);
  fft(envRe, envIm);
  let best = { score: -1, ratio: 1, offset: 0 };
  for (let ratio = minRatio; ratio <= maxRatio + 1e-9; ratio += 0.0025) {
    re.fill(0);
    im.fill(0);
    for (const t of onsets) re[Math.round((ratio * t) / cell)] += 1;
    fft(re, im);
    for (let i = 0; i < n; i++) [re[i], im[i]] = [envRe[i] * re[i] + envIm[i] * im[i], envIm[i] * re[i] - envRe[i] * im[i]]; // envelope × conj(spikes)
    fft(re, im); // transformed again: the correlation at shift k lands at n - k, n times over
    const from = Math.floor((-10 - ratio * first - start) / cell), to = Math.ceil((audioSeconds + 10 - ratio * last - start) / cell);
    for (let k = from; k <= to; k++) {
      const score = re[(((n - k) % n) + n) % n] / n / onsets.length;
      if (score > best.score) best = { score, ratio, offset: start + k * cell };
    }
  }
  const fine = widen(env, 1), rough = best;
  best = { score: -1 };
  for (let ratio = rough.ratio - 0.003; ratio <= rough.ratio + 0.003; ratio += 0.0002) {
    for (let offset = rough.offset - 0.1; offset <= rough.offset + 0.1; offset += hop / 2) {
      const score = fit(fine, ratio, offset);
      if (score > best.score) best = { score, ratio, offset };
    }
  }
  const mean = fine.reduce((a, b) => a + b, 0) / Math.max(1, fine.length);
  return { offset: best.offset, ratio: best.ratio, confidence: mean ? best.score / mean : 0 };
}

// The nudge in ms (positive: the notes later) that puts the chart's first note, at chart time `first`, on its attack in
// the recording. A confident fit says where that is to within a few tenths of a second, so the loudest attack within
// 0.3 s of there; a doubtful one says nothing, so the first loud attack, which a count-in can win. null when silent.
export function snapOffset({ env, hop, start }, { offset, ratio, confidence }, first) {
  const loudest = env.reduce((a, b) => Math.max(a, b), 0);
  if (!loudest) return null;
  let at, best = 0;
  if (confidence >= 2) {
    const near = offset + ratio * first, to = Math.min(env.length - 1, Math.floor((near + 0.3 - start) / hop));
    for (let f = Math.max(0, Math.ceil((near - 0.3 - start) / hop)); f <= to; f++) if (env[f] > best) [best, at] = [env[f], start + f * hop];
  }
  at ??= start + env.findIndex((v) => v >= loudest / 4) * hop;
  return Math.round(((at - offset) / ratio - first) * 1000);
}
