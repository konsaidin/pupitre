// node apps/web/harness/noise-probe.mjs — атаки и «высота» на чистом шуме при разных уровнях фона и порогах.
import { build } from '../node_modules/esbuild/lib/main.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'pupitre-noise-'));
try {
  const out = join(temp, 'probe.mjs');
  await build({ entryPoints: [join(here, 'lib/noiseProbe.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
  const { probe } = await import(pathToFileURL(out).href);
  const dsp = join(here, '../src/assets/dsp.wasm');
  for (const db of [-70, -60, -55, -50, -45]) {
    const lin = 10 ** (db / 20);
    const fixed = await probe(dsp, db, { onset: {}, pitch: { gateRms: 0.003 } });
    const adaptive = await probe(dsp, db, { onset: { gate: Math.max(0.0032, lin * 5.6), gateHf: Math.max(0.0016, lin * 2.8) }, pitch: { gateRms: Math.max(0.003, lin * 3.2) } });
    console.log(`фон ${db} dBFS: абсолютные пороги — атак ${fixed.onsetsPerMin.toFixed(1)}/мин, кадров с высотой ${(fixed.voicedShare * 100).toFixed(1)} % | от фона — атак ${adaptive.onsetsPerMin.toFixed(1)}/мин, высоты ${(adaptive.voicedShare * 100).toFixed(1)} %`);
  }
} finally { await rm(temp, { recursive: true, force: true }); }
