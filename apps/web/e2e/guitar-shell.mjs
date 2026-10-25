// Оболочка гитарного раздела (этап 8b, приёмка п. 3): вход из вокального меню, .rampa без легаси .topbar, шрифт
// «Rampa Sans», Tab до вкладок и «Голос | Гитара» с видимым фокусом; изоляция: #/guitar/_system без легаси-стилей
// совпадает со снимком с ними (≤ 0.1 %), вокальная главная после захода в раздел и возврата — с главной до захода (вне
// .topnav, ≤ 0.1 %), data-section снова «vocal»; телефон 844×390 — .mobile-viewport и .app-frame на всё окно; сборка без
// VITE_PUPITRE_GUITAR — пункта «Гитара» нет, #/guitar раздел не открывает.
// Запуск: node apps/web/e2e/guitar-shell.mjs [--prod]  (--prod — то же на production-сборке с флагом, vite preview).
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { emojiWoff2Firefox, launchFirefox, scenario, seedAndReload, shoot, startVite, tool, webRoot } from './lib/browser.mjs';

const PROD = process.argv.includes('--prod');
const OUT = join(homedir(), '.cache/pupitre/e2e/guitar-shell');
// Легаси-стили вокала удалены (2026-10-25, вокал на Рампе); изоляция — от раскладок вокальных экранов (.vo-*).
const LEGACY_CSS = ['/src/screens/vocal.css'];
const LIMIT = 0.001; // доля различающихся пикселей

const requireWeb = createRequire(join(webRoot, 'package.json'));
const vite = () => import(pathToFileURL(requireWeb.resolve('vite')).href);

// Production-сборка во временный каталог (apps/web/dist не трогаем) и vite preview на ней.
async function preview(flag) {
  const { build, preview: serve } = await vite();
  const outDir = join(OUT, flag ? 'dist-flag' : 'dist-noflag');
  await rm(outDir, { recursive: true, force: true });
  // Dev-сервер того же процесса выставляет NODE_ENV=development, и build() без этого собрал бы dev-бандл (DEV=true).
  const env = { flag: process.env.VITE_PUPITRE_GUITAR, node: process.env.NODE_ENV };
  if (flag) process.env.VITE_PUPITRE_GUITAR = '1';
  else delete process.env.VITE_PUPITRE_GUITAR;
  process.env.NODE_ENV = 'production';
  try {
    await build({ root: webRoot, mode: 'production', logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } finally {
    for (const [key, value] of [['VITE_PUPITRE_GUITAR', env.flag], ['NODE_ENV', env.node]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const server = await serve({ root: webRoot, build: { outDir }, preview: { host: 'localhost', port: 0 } });
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

async function diff(a, b, { exclude } = {}) {
  const { PNG } = await tool('pngjs');
  const { default: pixelmatch } = await tool('pixelmatch');
  const [x, y] = await Promise.all([a, b].map(async (p) => PNG.sync.read(await readFile(p))));
  assert.deepEqual([x.width, x.height], [y.width, y.height], 'Разные размеры снимков');
  if (exclude) for (const img of [x, y]) for (let j = Math.max(0, exclude.y); j < Math.min(img.height, exclude.y + exclude.height); j++)
    for (let i = Math.max(0, exclude.x); i < Math.min(img.width, exclude.x + exclude.width); i++) img.data.fill(0, (j * img.width + i) * 4, (j * img.width + i) * 4 + 4);
  const differ = pixelmatch(x.data, y.data, null, x.width, x.height, { threshold: 0.1 });
  return differ / (x.width * x.height);
}

const rect = (page, selector) => page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
});

// Видимый фокус: вычисленные outline / box-shadow у элемента в фокусе отличаются от них же без фокуса.
async function focusRing(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    const focused = [style.outlineStyle, style.outlineWidth, style.boxShadow].join('|');
    const id = el.getAttribute('data-ui') ?? el.textContent?.trim() ?? el.tagName;
    el.blur();
    const blurred = [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineWidth, getComputedStyle(el).boxShadow].join('|');
    el.focus({ focusVisible: true });
    return { id, visible: focused !== blurred && !focused.startsWith('none|'), focused };
  });
}

await scenario(async (track) => {
  const server = PROD ? await preview(true) : await startVite();
  let browser;
  try {
    browser = await launchFirefox();
    const page = await browser.newPage();
    const log = track(page, { knownPreexisting: [emojiWoff2Firefox] });
    await page.goto(server.url);
    await seedAndReload(page);
    await page.waitForSelector('.screen.home', { visible: true });
    await shoot(page, join(OUT, 'home-before.png'), { width: 1440, height: 900 });
    const topnav = await rect(page, '[data-ui="shell-nav"]');

    // Вход из вокального режима: переключатель «Голос | Гитара» общей оболочки Рампы.
    await page.click('[data-ui="shell-mode-switch"] .rp-seg__item[aria-checked="false"]');
    await page.waitForSelector('.rampa .rp-topbar', { visible: true });
    assert.equal(await page.evaluate(() => location.hash), '#/guitar');
    assert.equal(await page.$('[data-ui="vocal-root"]'), null, 'Вокальная оболочка осталась в разделе');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.section), 'guitar');
    await page.evaluate(() => document.fonts.load('16px "Rampa Sans"').then(() => document.fonts.ready));
    const font = await page.$eval('.rp-h1', (el) => getComputedStyle(el).fontFamily);
    assert.match(font, /Rampa Sans/, `font-family .rp-h1: ${font}`);
    assert.equal(await page.evaluate(() => document.fonts.check('16px "Rampa Sans"')), true, 'Rampa Sans не загружен');

    // Tab доходит до вкладок и переключателя режима, фокус виден.
    const want = ['shell-tab-library', 'shell-tab-tuner', 'shell-tab-tone', 'shell-tab-input', 'Голос'];
    const seen = new Map();
    for (let i = 0; i < 25 && want.some((w) => !seen.has(w)); i++) {
      await page.keyboard.press('Tab');
      const ring = await focusRing(page);
      if (ring && want.includes(ring.id)) seen.set(ring.id, ring);
    }
    for (const id of want) {
      assert.ok(seen.has(id), `Tab не дошёл до ${id}`);
      assert.ok(seen.get(id).visible, `Невидимый фокус у ${id}: ${seen.get(id).focused}`);
    }

    // Изоляция: снимок справочника с раскладками вокала и без них.
    // _system — только в DEV; в production-сборке — любой экран раздела (легаси-стили там одним файлом, сверка — в dev).
    await page.goto(new URL(PROD ? '#/guitar/tuner' : '#/guitar/_system', server.url).href);
    await page.waitForSelector(PROD ? '[data-ui="stub-tuner"]' : '[data-ui="stub-system"], [data-ui="system"]', { visible: true });
    await shoot(page, join(OUT, 'system-with-legacy.png'), { width: 1440, height: 900 });
    const removed = await page.evaluate((names) => {
      let n = 0;
      for (const style of document.querySelectorAll('style[data-vite-dev-id], link[rel="stylesheet"]')) {
        const id = style.getAttribute('data-vite-dev-id') ?? '';
        if (names.some((name) => id.endsWith(name))) { style.remove(); n++; }
      }
      return n;
    }, LEGACY_CSS);
    if (!PROD) assert.equal(removed, LEGACY_CSS.length, `Легаси-стилей снято ${removed} из ${LEGACY_CSS.length}`);
    await shoot(page, join(OUT, 'system-without-legacy.png'), { width: 1440, height: 900 });
    if (!PROD) {
      const isolation = await diff(join(OUT, 'system-with-legacy.png'), join(OUT, 'system-without-legacy.png'));
      console.log(`Изоляция: различий ${(isolation * 100).toFixed(3)} %`);
      assert.ok(isolation <= LIMIT, `Раздел зависит от легаси-стилей: ${(isolation * 100).toFixed(3)} %`);
    }

    // Возврат на главную через «Голос»: стили и атрибут раздела не остаются.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.rp-modeswitch', { visible: true });
    await page.click('.rp-modeswitch .rp-seg__item[aria-checked="false"]');
    await page.waitForSelector('.screen.home', { visible: true });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.section ?? null), 'vocal', 'data-section не вернулся к голосу');
    await page.mouse.move(1439, 899);
    await shoot(page, join(OUT, 'home-after.png'), { width: 1440, height: 900 });
    const leak = await diff(join(OUT, 'home-before.png'), join(OUT, 'home-after.png'), { exclude: topnav });
    console.log(`Главная до/после раздела: различий ${(leak * 100).toFixed(3)} %`);
    assert.ok(leak <= LIMIT, `Раздел изменил вокальную главную: ${(leak * 100).toFixed(3)} %`);
    assert.deepEqual(log.errors(), [], 'Ошибки страницы/консоли/сети');

    // Телефон в ландшафте: грубый указатель включает .mobile-viewport, короб раздела — на всё окно.
    const phone = await launchFirefox({ phone: true });
    try {
      const p = await phone.newPage();
      const plog = track(p, { knownPreexisting: [emojiWoff2Firefox] });
      await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
      await p.goto(server.url);
      await seedAndReload(p);
      await p.goto(new URL('#/guitar', server.url).href);
      await p.waitForSelector('.rampa .rp-topbar', { visible: true });
      assert.ok(await p.$('.mobile-viewport'), 'Телефонный режим .mobile-viewport не включился');
      const frame = await rect(p, '.app-frame');
      assert.deepEqual([frame.width, frame.height], [844, 390], `.app-frame ${frame.width}×${frame.height}`);
      await shoot(p, join(OUT, 'phone-844x390.png'), { width: 844, height: 390 });
      assert.deepEqual(plog.errors(), [], 'Ошибки на телефоне');
    } finally {
      await phone.close();
    }
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }

  // Сборка без флага: раздел невидим и недоступен.
  const plain = await preview(false);
  let noflag;
  try {
    noflag = await launchFirefox();
    const page = await noflag.newPage();
    const log = track(page, { knownPreexisting: [emojiWoff2Firefox] });
    await page.goto(plain.url);
    await seedAndReload(page);
    await page.waitForSelector('.screen.home', { visible: true });
    assert.equal(await page.$('[data-ui="shell-mode-switch"]'), null, 'Переключатель «Гитара» в сборке без флага');
    await page.goto(new URL('#/guitar', plain.url).href);
    await page.waitForSelector('[data-ui="vocal-root"] [data-ui="shell-topbar"]', { visible: true });
    assert.equal(await page.$('[data-ui="guitar-root"]'), null, '#/guitar открыл раздел без флага');
    assert.deepEqual(log.errors(), [], 'Ошибки в сборке без флага');
  } finally {
    try { await noflag?.close(); } finally { await plain.close(); }
  }
});
