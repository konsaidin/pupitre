// Качество распознавания гитары на GuitarSet (CC BY 4.0, 360 записей × микрофон и звукосниматель): каждая запись —
// через ворклеты браузерного пути и гитарного судью (lib/judgeTrack.ts). Метрики по каждой части и по соло/аккомпанементу:
//   recall — доля событий разметки, засчитанных при правильной игре (выше — лучше);
//   false_accept — доля засчитанных событий партии на 2 полутона выше на том же звуке, % (ниже — лучше: это «засчитал
//   не то»); chord_* — то же только по аккордам; cross_accept — партия другого трека на этом звуке, % засчитанных
//   («играю что попало»); stray_onsets — атаки вне нот разметки в минуту (ниже — лучше).
// Запуск: node apps/web/harness/run.mjs judge-guitarset --sets guitarset [--write-baseline]
// Калибровка: PUPITRE_TUNE='{"rise":2}' — переопределения порогов ворклета атак.
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { inspect, repoRoot } from '../../../tools/datasets/verify.mjs';
import type { TrackResult } from './lib/judgeTrack';

type Metric = { value: number; kind: 'share' | 'rate' | 'error' };

export async function run(ctx) {
  const result = { metrics: {} as Record<string, Metric>, registry: {} as Record<string, { n: number; expected: number }>, failures: [] as string[] };
  if (!ctx.sets.includes('guitarset')) return result;
  const set = ctx.registry.guitarset;
  const found = await inspect('guitarset', ctx.dataRoot, false);
  if (!found.fetched) {
    ctx.skip('guitarset', 'NOT FETCHED');
    return result;
  }
  result.failures.push(...found.failures);
  const tune = process.env.PUPITRE_TUNE ? JSON.parse(process.env.PUPITRE_TUNE) : undefined;
  const { build } = await import(join(repoRoot, 'apps/web/node_modules/esbuild/lib/main.js'));
  const temp = await mkdtemp(join(tmpdir(), 'pupitre-judge-'));
  try {
    const worker = join(temp, 'judgeTrack.mjs');
    await build({ entryPoints: [join(repoRoot, 'apps/web/harness/lib/judgeTrack.ts')], outfile: worker, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
    const dsp = join(repoRoot, 'apps/web/src/assets/dsp.wasm');
    // пути частей — от каталога набора
    const base = join(ctx.dataRoot, 'guitarset');
    const jamsOf = new Map((found.parts.annotation as string[]).map((p) => [p.split('/').pop()!.replace(/\.jams$/, ''), p]));
    const pool = ctx.pool(Math.max(1, availableParallelism() - 2));
    for (const part of ['mono-mic', 'mono-pickup']) {
      const wavs = found.parts[part] as string[];
      result.registry[`guitarset/${part}`] = { n: wavs.length, expected: set.parts[part].expect };
      const items = wavs.map((wav) => {
        const id = wav.split('/').pop()!.replace(/_(mic|mix)\.wav$/, '');
        const jams = jamsOf.get(id);
        return { id, wav: join(base, wav), jams: jams && join(base, jams), dsp, tune };
      }).map((item, k, all) => {
        // «чужая» партия — следующий трек того же типа (соло/аккомпанемент), по кругу
        const same = all.filter((o) => o.id.endsWith(item.id.endsWith('_solo') ? '_solo' : '_comp'));
        const next = same[(same.indexOf(item) + 1) % same.length];
        return { ...item, otherJams: next.jams };
      });
      const missing = items.filter((i) => !i.jams);
      if (missing.length) result.failures.push(`${part}: нет разметки у ${missing.map((i) => i.id).join(', ')}`);
      const t0 = Date.now();
      const rows = (await pool.map(items.filter((i) => i.jams), worker, null)) as TrackResult[];
      const label = part === 'mono-mic' ? 'mic' : 'pickup';
      for (const [kind, filter] of [['', () => true], ['_solo', (r: TrackResult) => r.id.endsWith('_solo')], ['_comp', (r: TrackResult) => r.id.endsWith('_comp')]] as const) {
        const sel = rows.filter(filter);
        const sum = (k: keyof TrackResult) => sel.reduce((s, r) => s + (r[k] as number), 0);
        const events = sum('events');
        const chords = sum('chords');
        result.metrics[`recall_${label}${kind}`] = { value: sum('hits') / events, kind: 'share' };
        result.metrics[`false_accept_${label}${kind}`] = { value: (sum('falseHits') / events) * 100, kind: 'error' };
        if (chords) {
          result.metrics[`chord_recall_${label}${kind}`] = { value: sum('chordHits') / chords, kind: 'share' };
          result.metrics[`chord_false_accept_${label}${kind}`] = { value: (sum('falseChordHits') / chords) * 100, kind: 'error' };
        }
        result.metrics[`cross_accept_${label}${kind}`] = { value: (sum('crossHits') / Math.max(1, sum('crossEvents'))) * 100, kind: 'error' };
        result.metrics[`stray_onsets_${label}${kind}`] = { value: sum('strayOnsets') / (sum('seconds') / 60), kind: 'rate' };
        result.metrics[`wrong_${label}${kind}`] = { value: (sum('wrong') / events) * 100, kind: 'error' };
      }
      ctx.log(`${part}: ${rows.length} записей за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
    }
    for (const [k, m] of Object.entries(result.metrics)) ctx.log(`  ${k.padEnd(30)} ${m.kind === 'share' ? `${(m.value * 100).toFixed(1)} %` : m.value.toFixed(2)}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return result;
}
