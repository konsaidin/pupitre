// Генератор apps/web/src/guitar/ui/GuitarIcon.tsx: пути Tabler Icons 3.49.0 (MIT) + свои иконки Рампы c-* и узоры
// постеров pt-* из tools/icons/rampa-custom-icons.svg. Порт design/icons/build-sprite.py (тот же список иконок).
// Запуск: node tools/icons/build-guitar-icons.mjs <распакованный npm pack @tabler/icons@3.49.0>/package
// Тарбол: npm pack @tabler/icons@3.49.0 — sha256 aa3042907eb0bdb079fd70733e2d75f785683d4726279128a0ca2343099f7074
// (сверено с dist.integrity реестра npm).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../apps/web/src/guitar/ui/GuitarIcon.tsx');
const CUSTOM = join(HERE, 'rampa-custom-icons.svg');
const OUTLINE = `books search filter arrows-sort upload file-music file-import music player-play player-pause player-stop
player-skip-back player-track-prev player-track-next repeat metronome headphones volume volume-2 microphone plug-connected
settings adjustments-horizontal adjustments-alt chevron-down chevron-right chevron-left chevron-up x check circle-check
alert-triangle info-circle refresh trash dots-vertical dots magnet pin pinned flag zoom-in zoom-out keyboard clock flame
crown trophy sparkles bolt ear hand-finger flip-horizontal chart-histogram chart-bar activity cpu power eye eye-off
arrow-back-up arrow-left arrow-right lock layout-grid list-details loader-2 plus minus circle-dashed user maximize minimize
device-floppy wave-sine wave-square vinyl disc gauge target timeline history arrows-exchange cloud-upload download link
unlink brain wand scissors stack-2 route bookmark star medal hourglass-high broadcast guitar-pick device-speaker
arrows-horizontal grip-vertical focus-centered crosshair keyframes chart-dots chart-line settings-2 world language
accessible user-circle arrow-guide progress-check ruler-measure circle-half-2 headphones-off microphone-off plug-x
player-record arrows-maximize circle-dot`.split(/\s+/);
const FILLED = `player-play player-pause player-stop player-record star flame crown circle-check alert-triangle info-circle
circle bolt circle-dot point pinned lock trophy`.split(/\s+/);

const pkg = process.argv[2];
if (!pkg || !existsSync(join(pkg, 'icons/outline'))) {
  console.error('Использование: node tools/icons/build-guitar-icons.mjs <…>/package  (распакованный @tabler/icons@3.49.0)');
  process.exit(2);
}
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
if (version !== '3.49.0') throw Error(`Ожидался @tabler/icons 3.49.0, получен ${version}`);

// Содержимое <svg> без корня и без служебной рамки 24×24; пробелы схлопнуты.
function inner(svg) {
  const body = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1];
  if (body === undefined) throw Error('не SVG');
  return body.replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, '').replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}
const icons = new Map(), missing = [];
for (const [names, dir, suffix] of [[OUTLINE, 'outline', ''], [FILLED, 'filled', '-filled']]) {
  for (const name of names) {
    const file = join(pkg, 'icons', dir, `${name}.svg`);
    if (!existsSync(file)) { missing.push(`${dir}/${name}`); continue; }
    icons.set(name + suffix, inner(readFileSync(file, 'utf8')));
  }
}
if (missing.length) throw Error(`Нет в пакете: ${missing.join(', ')}`);
const patterns = new Map();
for (const m of readFileSync(CUSTOM, 'utf8').matchAll(/<symbol id="([^"]+)" viewBox="([^"]+)"([^>]*)>([\s\S]*?)<\/symbol>/g)) {
  const [, id, viewBox, attrs, body] = m;
  // Заливка и штрих корня символа (у узоров) переезжают на обёртку <g>.
  const flat = body.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
  const markup = attrs.trim() ? `<g ${attrs.trim()}>${flat}</g>` : flat;
  if (id.startsWith('c-') && viewBox === '0 0 24 24') icons.set(id, markup);
  else if (id.startsWith('pt-')) patterns.set(id, { viewBox, markup });
  else throw Error(`Неизвестный символ ${id} (${viewBox})`);
}

const q = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const key = s => (/^[a-z]\w*$/i.test(s) ? s : q(s));
const union = names => names.map(n => `  | ${q(n)}`).join('\n');
const out = `// СГЕНЕРИРОВАНО tools/icons/build-guitar-icons.mjs — руками не править.
// Tabler Icons ${version} (MIT, © 2020-2026 Paweł Kuna; public/licenses/Tabler-MIT.txt): контурные — по имени Tabler,
// залитые — с суффиксом -filled. Свои c-* и узоры постеров pt-* — рисунки Рампы (tools/icons/rampa-custom-icons.svg).
// Разметка — из проверенных вендорных файлов, поэтому вставляется как есть; рантайм-зависимости нет.
export type GuitarIconName =
${union([...icons.keys()])};

export type GuitarPatternName =
${union([...patterns.keys()])};

const ICONS: Record<GuitarIconName, string> = {
${[...icons].map(([n, m]) => `  ${key(n)}: ${q(m)},`).join('\n')}
};

/** Узоры постеров (ui-spec §9.9): разметка внутри \`<svg viewBox>\`. */
export const GUITAR_PATTERNS: Record<GuitarPatternName, { viewBox: string; markup: string }> = {
${[...patterns].map(([n, p]) => `  ${key(n)}: { viewBox: ${q(p.viewBox)}, markup: ${q(p.markup)} },`).join('\n')}
};

export const GUITAR_ICON_NAMES = Object.keys(ICONS) as GuitarIconName[];

interface GuitarIconProps {
  name: GuitarIconName;
  /** sm 16, md 20, lg 24, xl 32 px — штрих по ui-spec §3.3 (классы .rp-i--*). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Подпись для иконки со смыслом; без неё иконка декоративная (aria-hidden). */
  label?: string;
  className?: string;
}

export function GuitarIcon({ name, size = 'md', label, className }: GuitarIconProps) {
  const classes = ['rp-i', size !== 'md' && \`rp-i--\${size}\`, name.endsWith('-filled') && 'rp-i--fill', className]
    .filter(Boolean)
    .join(' ');
  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
`;
writeFileSync(OUT, out);
console.log(`GuitarIcon.tsx: иконок ${icons.size} (Tabler ${OUTLINE.length} + ${FILLED.length} залитых, своих ${icons.size - OUTLINE.length - FILLED.length}), узоров ${patterns.size}, ${out.length} Б`);
