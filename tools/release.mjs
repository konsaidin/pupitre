// Релиз без GitHub Actions: проверки, сборка Linux (AppImage) и Windows (установщик и portable .exe) на этой машине,
// тег и GitHub Release через gh (обычный API, не Actions). Windows собирается из Linux через electron-builder (wine не
// нужен: подпись и правка exe выключены в apps/desktop/package.json).
// Запуск: node tools/release.mjs 0.3.0 [--skip-checks] [--draft]
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'apps/desktop');
const args = process.argv.slice(2);
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const skipChecks = args.includes('--skip-checks');
const draft = args.includes('--draft');
if (!version) throw new Error('Использование: node tools/release.mjs X.Y.Z [--skip-checks] [--draft]');
const tag = `v${version}`;

const sh = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
const step = (name) => console.log(`\n[release] ${name}`);

step('состояние репозитория');
if (out('git branch --show-current') !== 'master') throw new Error('релиз — только с master');
if (out('git status --porcelain')) throw new Error('есть незакоммиченные изменения');
sh('git fetch -q --tags origin master');
if (out('git rev-parse HEAD') !== out('git rev-parse origin/master')) throw new Error('master не совпадает с origin/master — сначала push/pull');
if (out(`git tag -l ${tag}`)) throw new Error(`тег ${tag} уже есть`);
const previous = out('git tag -l "v*" --sort=-v:refname').split('\n').filter(Boolean)[0] ?? '';

step(`версия ${version}`);
const pkgPath = join(desktop, 'package.json');
const pkg = readFileSync(pkgPath, 'utf8');
writeFileSync(pkgPath, pkg.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));

try {
  if (!skipChecks) {
    step('проверки');
    sh('npx vitest run', { cwd: join(root, 'apps/web') });
    sh('node tools/gates/check-build.mjs');
    sh('node tools/gates/check-sources.mjs');
    sh('node tools/gates/check-licenses.mjs');
    sh('node tools/gates/check-vocal.mjs --browser');
  }

  step('сборка: веб, нативные модули, пакеты');
  sh('node apps/desktop/build-web.mjs');
  sh('npm run copy-web', { cwd: desktop });
  sh('npm run build:native', { cwd: desktop });
  sh('npm run build:engine', { cwd: desktop });
  sh('npx electron-builder --linux --publish never', { cwd: desktop });
  sh('npx electron-builder --win --x64 --publish never', { cwd: desktop });
} catch (e) {
  writeFileSync(pkgPath, pkg); // версию не оставляем при неудаче
  throw e;
}

const release = join(desktop, 'release');
const files = readdirSync(release)
  .filter((f) => f.includes(`-${version}`) && /\.(AppImage|exe)$/.test(f))
  .map((f) => join(release, f));
if (files.length < 3) throw new Error(`ожидалось 3 файла сборки, есть: ${files.join(', ')}`);

step('коммит версии и тег');
sh('git add apps/desktop/package.json');
sh(`git commit -q -m "Релиз ${tag}"`);
sh(`git tag -a ${tag} -m "Pupitre ${tag}"`);
sh('git push -q origin master');
sh(`git push -q origin ${tag}`);

step('GitHub Release');
const log = out(`git log --no-merges --format="- %s" ${previous ? `${previous}..${tag}` : tag}`)
  .split('\n')
  .filter((l) => !l.startsWith('- Релиз v'))
  .join('\n');
const notes = `## Скачать\n\n- Linux: \`Pupitre-${version}-linux-x86_64.AppImage\`\n- Windows: \`Pupitre-Setup-${version}.exe\` (установщик) или \`Pupitre-${version}-win-x64.exe\` (без установки)\n\nСборки не подписаны: Windows SmartScreen предупредит — «Подробнее» → «Выполнить в любом случае».\n\n## Изменения${previous ? ` с ${previous}` : ''}\n\n${log}\n`;
const notesPath = join(release, `notes-${version}.md`);
writeFileSync(notesPath, notes);
const quoted = files.map((f) => JSON.stringify(f)).join(' ');
sh(`gh release create ${tag} ${quoted} --title "Pupitre ${tag}" --notes-file ${JSON.stringify(notesPath)}${draft ? ' --draft' : ''}`);
console.log(`\n[release] готово: ${tag}`);
