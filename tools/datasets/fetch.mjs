// Архивы и распакованные входы остаются во внешнем хранилище.
import { mkdir, statfs, stat, rename, writeFile, mkdtemp, rm, cp, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { registry, dataRoot, externalPath, exists, digest, files } from './verify.mjs';

function command(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${bin}: ${r.error?.message || r.stderr}`);
  return r.stdout;
}
async function download(a, path) {
  const algorithm = a.sha256 ? 'sha256' : 'md5';
  if (await exists(path) && await digest(path, algorithm) === a[algorithm]) return;
  const partial = await externalPath(`${path}.part`);
  let offset = await exists(partial) ? (await stat(partial)).size : 0;
  if (offset === a.size && await digest(partial, algorithm) === a[algorithm]) { await rename(partial, path); return; }
  if (offset >= a.size) offset = 0;
  const response = await fetch(a.url, { headers: offset ? { Range: `bytes=${offset}-` } : {} });
  if (!response.ok) throw new Error(`${a.path}: HTTP ${response.status}`);
  if (response.status === 206 && response.headers.get('content-range') !== `bytes ${offset}-${a.size - 1}/${a.size}`) throw new Error('Некорректный Content-Range');
  if (response.status !== 200 && response.status !== 206) throw new Error('Неожиданный ответ сервера');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: offset && response.status === 206 ? 'a' : 'w' }));
  if ((await stat(partial)).size !== a.size || await digest(partial, algorithm) !== a[algorithm]) {
    await rm(partial);
    throw new Error(`${a.path}: размер/хеш не совпадает`);
  }
  await rename(partial, path);
}
async function extract(a, path) {
  const zip = a.path.endsWith('.zip'), tar = a.path.endsWith('.tar.gz');
  if (!zip && !tar) return; // EGSet12 опубликован отдельными файлами, GP здесь не распаковываем.
  const marker = await externalPath(`${path}.extracted`);
  const hash = a.sha256 || a.md5;
  if (await exists(marker) && await readFile(marker, 'utf8') === hash) return;
  const names = command(zip ? 'unzip' : 'tar', zip ? ['-Z1', path] : ['-tzf', path]).trimEnd().split('\n');
  if (names.some(n => n.startsWith('/') || n.includes('\\') || n.split('/').includes('..'))) throw new Error('Небезопасный путь в архиве');
  const listing = command(zip ? 'unzip' : 'tar', zip ? ['-Z', '-l', path] : ['-tvzf', path]);
  if (zip ? listing.split('\n').some(s => /^[lbcp]/.test(s)) : listing.split('\n').some(s => s && !/^[-d]/.test(s))) throw new Error('Ссылки/специальные файлы в архиве запрещены');
  const stage = await mkdtemp(join(dirname(path), '.extract-'));
  try {
    command(zip ? 'unzip' : 'tar', zip ? ['-q', path, '-d', stage] : ['-xzf', path, '--no-same-owner', '--no-same-permissions', '-C', stage, ...(a.member ? [a.member] : [])]);
    for (const name of await files(stage)) {
      const target = await externalPath(join(dirname(path), name));
      await mkdir(dirname(target), { recursive: true });
      await cp(join(stage, name), target);
    }
    await writeFile(marker, hash);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
async function main() {
  const [id, ...args] = process.argv.slice(2);
  const set = registry[id];
  if (!set || (args.length && (args.length !== 2 || args[0] !== '--with'))) throw new Error('Использование: fetch.mjs <набор> [--with guitar-techs]');
  if (set.localOnly) throw new Error(`${id}: localOnly — качать вручную: ${set.source.url}`);
  if (set.flag && !args[1]?.split(',').includes(set.flag)) throw new Error(`${id}: нужен --with ${set.flag}`);
  const root = await dataRoot();
  await mkdir(root, { recursive: true });
  const disk = await statfs(root);
  if (disk.bavail * disk.bsize < 8 * 1024 ** 3) throw new Error('DISK_LOW: свободно меньше 8 ГБ');
  const dir = await externalPath(join(root, id));
  await files(dir); // Не пишем через ссылки в уже существующем наборе.
  for (const a of set.archives) {
    const path = await externalPath(join(dir, a.path));
    await mkdir(dirname(path), { recursive: true });
    await download(a, path);
    await extract(a, path);
    console.log(`${id}: ${a.path} VERIFIED`);
  }
  await writeFile(join(dir, 'SOURCE.txt'), `${JSON.stringify({ source: set.source, license: set.license, date: new Date().toISOString(), archives: set.archives, note: set.note }, null, 2)}\n`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
