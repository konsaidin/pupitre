// E2E живого тракта: фейковый микрофон Firefox → getUserMedia → AudioWorklet
// → Rust/WASM ядро → AnalysisFrame. Модуль импортируется через Vite dev-сервер.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: '/usr/bin/firefox',
    headless: true,
    extraPrefsFirefox: {
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
    },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('[console.error]', m.text());
    });
    await page.goto('http://localhost:5173/', { waitUntil: 'load' });
    const result = await page.evaluate(async () => {
      const { WorkletAudioInput } = await import('/src/audio/WorkletAudioInput.ts');
      const { DEFAULT_MIC } = await import('/src/audio/AudioInput.ts');
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.resume();
      const input = new WorkletAudioInput(ctx);
      const frames = [];
      input.onFrame((f) => frames.push(f));
      await input.start(null, DEFAULT_MIC);
      await new Promise((r) => setTimeout(r, 3000));
      const latencyMs = Math.round(input.latencyMs() * 10) / 10;
      const devices = (await input.listDevices()).length;
      input.stop();
      const voiced = frames.filter((f) => f.voiced);
      const mid = frames[Math.floor(frames.length / 2)] ?? null;
      return {
        sampleRate: ctx.sampleRate,
        latencyMs,
        devices,
        baseLatencyMs: Math.round((ctx.baseLatency ?? 0) * 1000 * 10) / 10,
        total: frames.length,
        voicedCount: voiced.length,
        meanDtMs:
          frames.length > 1
            ? Math.round(((frames[frames.length - 1].t - frames[0].t) / (frames.length - 1)) * 100000) / 100
            : 0,
        voicedF0: voiced.slice(0, 5).map((f) => Math.round(f.hz * 10) / 10),
        sampleFrame: mid && {
          hz: Math.round(mid.hz * 10) / 10,
          midi: Number.isNaN(mid.midi) ? 'NaN' : Math.round(mid.midi * 100) / 100,
          clarity: Math.round(mid.clarity * 100) / 100,
          rms: Math.round(mid.rms * 10000) / 10000,
          voiced: mid.voiced,
          loudDb: Math.round(mid.loudDb * 10) / 10,
          vibrato: mid.vibrato,
          distortion: { active: mid.distortion.active, score: Math.round(mid.distortion.score * 100) / 100 },
          breathiness: Math.round(mid.breathiness * 100) / 100,
        },
      };
    });
    console.log(JSON.stringify(result, null, 2));
    const ok = result.total > 300 && Math.abs(result.meanDtMs - (256 / result.sampleRate) * 1000) < 0.5;
    console.log(ok ? 'E2E OK: кадры идут с шагом hop/sr' : 'E2E FAIL');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
  }
})();
