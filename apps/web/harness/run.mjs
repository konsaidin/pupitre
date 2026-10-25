// Запуск задач, полный учёт реестров и сравнение метрик с эталоном.
import { build } from '../node_modules/esbuild/lib/main.js';
import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registry, dataRoot, externalPath, exists, repoRoot } from '../../../tools/datasets/verify.mjs';

export function pool(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('Размер пула должен быть положительным целым');
  const active = new Set();
  return {
    async close() { await Promise.all([...active].map(w => w.terminate())); },
    async map(items, modulePath, payload) {
      const url = modulePath instanceof URL ? modulePath.href : pathToFileURL(resolve(modulePath)).href;
      const workers = [], result = new Array(items.length);
      let cursor = 0;
      try {
        await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => new Promise((done, reject) => {
          const w = new Worker(`
            const { parentPort, workerData } = require('node:worker_threads');
            const modulePromise = import(workerData.url);
            parentPort.on('message', async ({ index, item }) => {
              try {
                const mod = await modulePromise;
                const value = await (mod.default || mod.run)(item, workerData.payload);
                parentPort.postMessage({ index, value });
              } catch (e) { parentPort.postMessage({ error: e.stack || String(e) }); }
            });
          `, { eval: true, execArgv: [], workerData: { url, payload } });
          active.add(w); workers.push(w);
          let finished = false;
          const next = () => {
            if (cursor === items.length) { finished = true; done(); }
            else { const index = cursor++; w.postMessage({ index, item: items[index] }); }
          };
          w.on('error', reject);
          w.on('exit', code => { if (!finished) reject(new Error(`Worker завершился до результата (${code})`)); });
          w.on('message', m => {
            if (m.error) reject(new Error(m.error));
            else { result[m.index] = m.value; next(); }
          });
          next();
        })));
        return result;
      } finally { await Promise.all(workers.map(async w => { await w.terminate(); active.delete(w); })); }
    },
  };
}
export function compare(metrics, baseline) {
  const failures = [];
  for (const [key, before] of Object.entries(baseline)) {
    const now = metrics[key];
    if (!now || now.kind !== before.kind) { failures.push(`${key}: метрика отсутствует или изменила kind`); continue; }
    const limit = before.kind === 'share' ? before.value - 0.005 : before.value * 1.05;
    if (before.kind === 'share' ? now.value < limit - 1e-12 : now.value > limit + 1e-12) failures.push(`${key}: ${before.value} → ${now.value}`);
  }
  return failures;
}
async function execute(task, sets, writeBaseline, bundle) {
  const root = await dataRoot(), skipped = [], pools = [];
  const report = { task, date: new Date().toISOString(), dataRoot: root, sets, skipped, metrics: {}, registry: {}, failures: [] };
  try {
    const module = await import(pathToFileURL(bundle).href);
    const result = await module.run({
      dataRoot: root, registry, sets, log: console.log,
      pool: n => { const p = pool(n); pools.push(p); return p; },
      skip: (set, reason) => { skipped.push({ set, reason }); console.log(`${set}: ${reason === 'NOT FETCHED' ? reason : `SKIPPED (${reason})`}`); },
    });
    if (!result?.metrics || !result?.registry || !Array.isArray(result.failures)) throw new Error('Некорректный результат задачи');
    Object.assign(report, result);
    for (const [key, m] of Object.entries(report.metrics)) {
      if (!['share', 'rate', 'error'].includes(m.kind) || !Number.isFinite(m.value) || m.value < 0 || (m.kind === 'share' && m.value > 1)) report.failures.push(`${key}: некорректная метрика`);
    }
    for (const [key, r] of Object.entries(report.registry)) {
      if (!Number.isInteger(r.n) || !Number.isInteger(r.expected) || r.expected < 1 || r.n !== r.expected) report.failures.push(`${key}: неполный реестр ${r.n}/${r.expected}`);
    }
    for (const id of sets) {
      const set = registry[id];
      if (set.optional || set.localOnly) continue;
      const rows = Object.entries(report.registry).filter(([key]) => key === id || key.startsWith(`${id}/`));
      if (!rows.length || rows.some(([, r]) => r.n < set.minN)) report.failures.push(`${id}: обязательный реестр ниже minN=${set.minN}`);
    }
  } catch (e) { report.failures.push(e.stack || String(e)); }
  finally { await Promise.all(pools.map(p => p.close())); }
  const baselinePath = join(dirname(fileURLToPath(import.meta.url)), 'baselines', `${task}.json`);
  report.baseline = { path: baselinePath, rules: { share: '-0.005', rate: '+5%', error: '+5%' }, status: 'NO BASELINE' };
  if (await exists(baselinePath)) {
    const saved = JSON.parse(await readFile(baselinePath, 'utf8'));
    const regressions = compare(report.metrics, saved.metrics);
    report.baseline.status = regressions.length ? 'REGRESSION' : 'MATCH';
    report.failures.push(...regressions);
  } else console.log('NO BASELINE');
  if (writeBaseline && !report.failures.length) {
    await writeFile(baselinePath, `${JSON.stringify({ task, date: report.date, metrics: report.metrics }, null, 2)}\n`);
    report.baseline.status = 'WRITTEN';
  }
  const reports = await externalPath(join(homedir(), '.cache/pupitre/reports'));
  await mkdir(reports, { recursive: true });
  const stamp = report.date.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const path = join(reports, `${task}-${stamp}.json`);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`REPORT ${path}`);
  for (const failure of report.failures) console.error(failure);
  return Number(Boolean(report.failures.length));
}
async function main() {
  const [task, ...args] = process.argv.slice(2);
  if (!/^[a-z][a-z0-9-]*$/.test(task || '')) throw new Error('Нужно имя задачи');
  let sets = Object.keys(registry), writeBaseline = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sets' && args[i + 1]) sets = [...new Set(args[++i].split(','))];
    else if (args[i] === '--write-baseline') writeBaseline = true;
    else throw new Error(`Неизвестный аргумент: ${args[i]}`);
  }
  for (const id of sets) if (!registry[id]) throw new Error(`Неизвестный набор: ${id}`);
  await dataRoot();
  const temp = await mkdtemp(join(tmpdir(), 'pupitre-harness-'));
  try {
    const bundle = join(temp, 'task.mjs');
    await build({
      entryPoints: [join(repoRoot, 'apps/web/harness', `${task}.ts`)], outfile: bundle,
      bundle: true, platform: 'node', format: 'esm', target: 'node22',
      // Общий модуль должен сохранить import.meta.url для путей реестра.
      plugins: [{ name: 'dataset-paths', setup(b) { b.onResolve({ filter: /datasets\/verify\.mjs$/ }, () => ({ path: join(repoRoot, 'tools/datasets/verify.mjs'), external: true })); } }],
    });
    process.exitCode = await new Promise((done, reject) => {
      const child = fork(fileURLToPath(import.meta.url), ['--execute', task, JSON.stringify(sets), String(writeBaseline), bundle], { stdio: 'inherit' });
      child.on('error', reject); child.on('exit', code => done(code ?? 1));
    });
  } finally { await rm(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] === '--execute'
    ? execute(process.argv[3], JSON.parse(process.argv[4]), process.argv[5] === 'true', process.argv[6]).then(code => { process.exitCode = code; })
    : main();
  action.catch(e => { console.error(e.message); process.exitCode = 1; });
}
