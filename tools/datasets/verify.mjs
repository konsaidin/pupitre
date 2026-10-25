// Общие проверки хранилища используются также загрузчиком и харнессом.
import { createReadStream } from 'node:fs';
import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const registry = JSON.parse(await readFile(new URL('./registry.json', import.meta.url), 'utf8'));
export async function exists(path) {
  try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
export async function externalPath(path) {
  const absolute = resolve(path);
  let ancestor = absolute;
  while (!await exists(ancestor)) ancestor = dirname(ancestor);
  const canonical = resolve(await realpath(ancestor), relative(ancestor, absolute));
  for (const p of [absolute, canonical]) {
    const rel = relative(await realpath(repoRoot), p);
    if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..')) throw new Error(`Корень/путь данных внутри репозитория: ${path}`);
  }
  return canonical;
}
export async function dataRoot() {
  const input = process.env.PUPITRE_DATA || `${homedir()}/.cache/pupitre/datasets`;
  return externalPath(input.replace(/^~(?=\/|$)/, homedir()));
}
export async function digest(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function files(root) {
  if (!await exists(root)) return [];
  const result = [];
  async function walk(dir) {
    if ((await lstat(dir)).isSymbolicLink()) throw new Error(`Символическая ссылка в данных: ${dir}`);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Символическая ссылка в данных: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) result.push(relative(root, path).split(sep).join('/'));
    }
  }
  await walk(root);
  return result.sort();
}
export function matchGlob(path, glob) {
  const pattern = glob.split('/').map(s => s === '**' ? '(?:[^/]+/)*' : s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*').replaceAll('?', '[^/]') + '/').join('').slice(0, -1);
  return new RegExp(`^${pattern}$`).test(path);
}
export async function inspect(id, root, hashes = true) {
  const set = registry[id];
  if (!set) throw new Error(`Неизвестный набор: ${id}`);
  const dir = await externalPath(resolve(root, id));
  const all = await files(dir);
  const parts = Object.fromEntries(Object.entries(set.parts).map(([name, part]) => [name, all.filter(p => matchGlob(p, part.glob))]));
  const fetched = Object.values(parts).some(p => p.length) || set.archives.some(a => all.includes(a.path));
  const failures = [], checks = {};
  if (fetched) {
    for (const [name, list] of Object.entries(parts)) {
      if (list.length !== set.parts[name].expect) failures.push(`${id}/${name}: ${list.length}/${set.parts[name].expect}`);
    }
    if (hashes) for (const a of set.archives) {
      if (!all.includes(a.path)) continue;
      const algorithm = a.sha256 ? 'sha256' : 'md5';
      const c = checks[algorithm] ||= { n: 0, expected: set.archives.filter(x => Boolean(x[algorithm])).length };
      if (await digest(resolve(dir, a.path), algorithm) === a[algorithm]) c.n++;
      else failures.push(`${id}/${a.path}: ${algorithm} не совпадает`);
    }
  }
  return { parts, fetched, failures, checks };
}
async function main() {
  const [id, ...extra] = process.argv.slice(2);
  if (!id || extra.length) throw new Error('Использование: node tools/datasets/verify.mjs <набор>');
  const result = await inspect(id, await dataRoot());
  const set = registry[id];
  if (!result.fetched) {
    console.log(`${id}: ${set.localOnly ? 'SKIPPED (localOnly)' : 'NOT FETCHED'}`);
    process.exitCode = set.localOnly ? 0 : 1;
    return;
  }
  const counts = Object.entries(result.parts).map(([k, v]) => `${k} ${v.length}/${set.parts[k].expect}`);
  for (const [k, v] of Object.entries(result.checks)) counts.push(`${k} ${v.n}/${v.expected}`);
  console.log(`${id}: ${counts.join(', ')} ${result.failures.length ? 'FAILED' : set.localOnly || set.optional ? 'CHECKED' : 'OK'}`);
  for (const failure of result.failures) console.error(failure);
  process.exitCode = Number(Boolean(result.failures.length));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1; });
