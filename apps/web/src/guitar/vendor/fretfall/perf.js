// Frame profiler for the highway. Open the page with ?perf for a panel with the frame rate, frame times, where each frame's
// script time goes and how much it draws, and a benchmark that sweeps the whole song, for numbers to compare before and after
// a change. The parts also show as timings in the DevTools Performance panel, where the CPU can be throttled to try a slower
// computer. Script time is only what the page's code takes: the canvas is rasterized after it, so a frame that takes much
// longer than its script is waiting on the browser (pixels, glow). Off, lap() is all that runs.

const KEEP = 120, BENCH_FRAMES = 600, SLOW = 25; // frames in the panel's figures; frames a benchmark takes; ms: a dropped frame at 60 Hz
const DRAWS = { fill: 'fill', stroke: 'stroke', fillText: 'text', strokeText: 'text', createLinearGradient: 'gradient', createRadialGradient: 'gradient', measureText: 'measure' };
let on = false, frame = null, last = 0, frames = [], bench = null, panel = null, shownAt = 0, canvas = null;

export function lap(name) { // the time since the last lap goes to this part of the frame
  if (!on) return;
  const now = performance.now();
  frame.parts[name] = (frame.parts[name] ?? 0) + now - last;
  performance.measure(name, { start: last, end: now });
  last = now;
}

export function startFrame() {
  if (!on) return;
  const now = performance.now();
  performance.clearMeasures();
  frame = { start: now, interval: frame ? now - frame.start : 0, parts: {}, calls: {} };
  last = now;
}

export function endFrame() {
  if (!on) return;
  frame.script = performance.now() - frame.start;
  frames.push(frame);
  if (frames.length > KEEP) frames.shift();
  if (bench) {
    bench.frames.push(frame);
    if (bench.frames.length === BENCH_FRAMES) finishBench();
  }
  if (frame.start - shownAt > 250) show();
}

// The song time to draw while a benchmark runs (null otherwise): the whole song, evenly, over BENCH_FRAMES frames
export const benchTime = () => (bench ? (bench.at++ / BENCH_FRAMES) * bench.length : null);

const stats = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return { avg: sorted.reduce((a, b) => a + b, 0) / sorted.length, p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) };
};
const ms = ({ avg, p95, max }) => `avg ${avg.toFixed(1)} · p95 ${p95.toFixed(1)} · max ${max.toFixed(1)} ms`;
const average = (list, key) => {
  const names = [...new Set(list.flatMap((f) => Object.keys(f[key])))];
  return Object.fromEntries(names.map((name) => [name, list.reduce((sum, f) => sum + (f[key][name] ?? 0), 0) / list.length]));
};

function summary(list) {
  const timed = list.slice(1); // the first interval runs from before the list started
  return {
    fps: 1000 / stats(timed.map((f) => f.interval)).avg,
    frame: stats(timed.map((f) => f.interval)),
    slow: timed.filter((f) => f.interval > SLOW).length / timed.length,
    script: stats(list.map((f) => f.script)),
    parts: average(list, 'parts'),
    calls: average(list, 'calls'),
    canvas: `${canvas.width}×${canvas.height} (${((canvas.width * canvas.height) / 1e6).toFixed(1)} MP at ${devicePixelRatio}x)`,
  };
}

function show() {
  shownAt = frame.start;
  if (frames.length < 3) return;
  const s = summary(frames), round = (o, digits) => Object.entries(o).map(([k, v]) => `${k} ${v.toFixed(digits)}`).join('  ');
  panel.firstChild.textContent = [
    `${s.fps.toFixed(0)} fps · canvas ${s.canvas}`,
    `frame  ${ms(s.frame)} · ${(s.slow * 100).toFixed(0)}% over ${SLOW} ms`,
    `script ${ms(s.script)}`,
    `ms     ${round(s.parts, 2)}`,
    `calls  ${round(s.calls, 0)}`,
    bench ? `benchmark ${bench.frames.length}/${BENCH_FRAMES}…` : panel.result ?? '',
  ].join('\n');
}

function finishBench() {
  const s = summary(bench.frames);
  bench.done(s);
  bench = null;
  panel.result = `benchmark: ${s.fps.toFixed(0)} fps · frame p95 ${s.frame.p95.toFixed(1)} · script avg ${s.script.avg.toFixed(2)} p95 ${s.script.p95.toFixed(2)} ms`;
  console.table({ frame: s.frame, script: s.script, ...Object.fromEntries(Object.entries(s.parts).map(([k, avg]) => [k, { avg }])) });
  console.log('benchmark', s);
}

// Draws the song from start to end over BENCH_FRAMES frames; resolves to its summary
export const runBench = (length) => new Promise((done) => {
  if (!on || bench || !length) return done(null);
  bench = { at: 0, length, frames: [], done };
});

// Turns the profiler on, counting what the canvas draws: fills, strokes, text, gradients, text measured, and glow (anything
// drawn with a shadow blur, often the dearest by far)
export function startProfiler(highway, songLength) {
  on = true;
  canvas = highway;
  const g = canvas.getContext('2d');
  for (const [method, kind] of Object.entries(DRAWS)) {
    const original = g[method];
    g[method] = function (...args) {
      if (frame) {
        frame.calls[kind] = (frame.calls[kind] ?? 0) + 1;
        if (this.shadowBlur > 0 && kind !== 'gradient' && kind !== 'measure') frame.calls.glow = (frame.calls.glow ?? 0) + 1;
      }
      return original.apply(this, args);
    };
  }
  panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:1000;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.8);color:#fff;font:11px/1.5 ui-monospace,monospace;white-space:pre;pointer-events:auto';
  const button = Object.assign(document.createElement('button'), { textContent: 'Benchmark the song', style: 'margin-top:6px;font:inherit' });
  button.onclick = () => runBench(songLength());
  panel.append(document.createElement('div'), button);
  document.body.append(panel);
  window.perf = { bench: () => runBench(songLength()), frames }; // for the console: await perf.bench()
}
