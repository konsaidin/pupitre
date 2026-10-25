// UI-ОК: эталоны никогда не перезаписываются этим гейтом.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchFirefox, startVite, seedAndReload, journal, shoot, tool } from './lib/browser.mjs';

const design = process.env.PUPITRE_DESIGN_DIR ?? join(homedir(), '.claude/plans/pupitre/guitar-mode/design');
const output = join(homedir(), '.cache/pupitre/shots', `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
const masks = JSON.parse(await readFile(new URL('./shots-masks.json', import.meta.url)));
const registry = JSON.parse(await readFile(new URL('./ui-registry.json', import.meta.url)));
let passed = 0, total = 0, regPassed = 0, regTotal = 0;

async function compare(screen, size, actualPath) {
  const [{ PNG }, { default: pixelmatch }] = await Promise.all([tool('pngjs'), tool('pixelmatch')]);
  const actual = PNG.sync.read(await readFile(actualPath));
  const expected = PNG.sync.read(await readFile(join(design, 'shots', `${screen}-${size.width}x${size.height}.png`)));
  assert.equal(actual.width, expected.width, 'Ширина эталона');
  assert.equal(actual.height, expected.height, 'Высота эталона');
  const ignored = new Set();
  for (const rect of masks.screens[screen]?.masks ?? []) {
    if (rect.size && rect.size !== `${size.width}x${size.height}`) continue;
    assert.ok(rect.why && [rect.x, rect.y, rect.width, rect.height].every(Number.isInteger), 'Маска требует координат и why');
    for (let y = Math.max(0, rect.y); y < Math.min(actual.height, rect.y + rect.height); y++) {
      for (let x = Math.max(0, rect.x); x < Math.min(actual.width, rect.x + rect.width); x++) ignored.add(y * actual.width + x);
    }
  }
  // Маски больше 15 % кадра — только с явным согласием (approvedLarge и why у каждой маски экрана этого размера).
  const share = ignored.size / (actual.width * actual.height);
  const screenMasks = (masks.screens[screen]?.masks ?? []).filter(rect => !rect.size || rect.size === `${size.width}x${size.height}`);
  if (share > 0.15) assert.ok(screenMasks.every(rect => rect.approvedLarge === true && rect.why),
    `Маски закрывают ${(share * 100).toFixed(1)} % кадра (> 15 %) без approvedLarge`);
  for (const i of ignored) {
    actual.data.fill(0, i * 4, i * 4 + 4);
    expected.data.fill(0, i * 4, i * 4 + 4);
  }
  const pixels = actual.width * actual.height - ignored.size;
  assert.ok(pixels > 0, 'Маски закрывают весь снимок');
  const diff = new PNG({ width: actual.width, height: actual.height });
  const count = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
  const ratio = count / pixels;
  console.log(`${screen} ${size.width}x${size.height}: ${(100 * ratio).toFixed(4)} % (${count}/${pixels})`);
  if (ratio > 0.02) {
    const path = actualPath.replace(/\.png$/, '-diff.png');
    await writeFile(path, PNG.sync.write(diff));
    throw new Error(`Различие > 2 %; diff: ${path}`);
  }
}

async function openMock(page, screen, size) {
  await page.setViewport({ ...size, deviceScaleFactor: 1 });
  await page.goto(`${pathToFileURL(join(design, 'mockups.html')).href}#${screen}`);
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
}

async function checkUI(page, phone, cta) {
  await page.waitForSelector('.rampa', { visible: true });
  if (phone) assert.ok(await page.$('.mobile-viewport'), 'Нет телефонного режима');
  const issues = await page.evaluate(async () => {
    await document.fonts.ready;
    const root = document.querySelector('.rampa');
    const errors = [];
    if (root.querySelector('.btn, .card, .topbar, .seg, .seg-btn, select')) errors.push('Легаси-классы / select');
    const families = [...root.querySelectorAll('*'), root].map(e => getComputedStyle(e).fontFamily);
    for (const font of ['Rampa Sans', 'Rampa Mono']) {
      if (!families.some(f => f.includes(font)) || ![...document.fonts].some(f => f.family.replaceAll(/['"]/g, '') === font && f.status === 'loaded')) errors.push(`Шрифт ${font} не вычислен/не загружен`);
    }
    return errors;
  });
  assert.deepEqual(issues, []);
  assert.ok(cta, 'Задайте cta в shots-masks.json для этого экрана');
  let reached = false;
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press('Tab');
    // Видимый фокус — вычисленные outline/box-shadow в фокусе отличаются от них же без фокуса (декоративная тень
    // без изменения — не фокус).
    reached = await page.evaluate(selector => {
      const el = document.activeElement;
      if (!el?.matches(selector) || !el.matches(':focus-visible')) return false;
      const ring = css => [css.outlineStyle, css.outlineWidth, css.outlineColor, css.boxShadow].join('|');
      const focused = ring(getComputedStyle(el));
      el.blur();
      const blurred = ring(getComputedStyle(el));
      el.focus({ focusVisible: true });
      return focused !== blurred;
    }, cta);
    if (reached) break;
  }
  assert.ok(reached, 'Tab не дошёл до CTA с видимым фокусом');
}

async function boxes(page, selectors) {
  return page.evaluate(selectors => selectors.map(selector => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Нет блока ${selector}`);
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  }), selectors);
}

async function screenShot(screen, size, lang) {
  assert.ok(!['play', 'play-tab'].includes(screen), 'Структурная проверка canvas появится с этапом 10');
  const config = masks.screens[screen] ?? {};
  const phone = size.width === 844;
  const vite = await startVite();
  let browser;
  let log;
  try {
    browser = await launchFirefox({ phone });
    const page = await browser.newPage();
    log = journal(page);
    await page.setViewport({ ...size, deviceScaleFactor: 1 });
    await page.goto(vite.url);
    await seedAndReload(page, { lang, guitar: config.guitar });
    if (config.seed) await page.goto(`${vite.url}#/guitar/_dev/seed?set=${encodeURIComponent(config.seed)}`);
    await page.goto(`${vite.url}${config.route ?? `#/guitar/${screen === 'system' ? '_system' : screen}`}`);
    await page.waitForSelector('.rampa', { visible: true });
    const path = join(output, `${screen}-${size.width}x${size.height}.png`);
    await shoot(page, path, size);
    if (lang === 'en') {
      const overflow = await page.$$eval('.rampa button, .rampa [role="button"], .rampa [role="tab"], .rampa [role="menuitem"], .rampa .rp-rail a', els => els.filter(el => el.scrollWidth > el.clientWidth).map(el => el.outerHTML));
      assert.deepEqual(overflow, [], 'Переполнения английского текста');
    } else {
      await checkUI(page, phone, config.cta);
      const text = await page.$eval('.rampa', el => el.innerText);
      const reduced = await launchFirefox({ phone, reducedMotion: true });
      try {
        const reducedPage = await reduced.newPage();
        const reducedLog = journal(reducedPage);
        await reducedPage.setViewport({ ...size, deviceScaleFactor: 1 });
        await reducedPage.goto(vite.url);
        await seedAndReload(reducedPage, { lang, guitar: config.guitar });
        if (config.seed) await reducedPage.goto(`${vite.url}#/guitar/_dev/seed?set=${encodeURIComponent(config.seed)}`);
        await reducedPage.goto(page.url());
        await reducedPage.waitForSelector('.rampa', { visible: true });
        assert.ok(await reducedPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
        assert.equal(await reducedPage.$eval('.rampa', el => el.innerText), text, 'Текст исчез при reduced motion');
        if (reducedLog.errors().length) reducedLog.print();
        assert.deepEqual(reducedLog.errors(), [], 'Ошибки reduced motion');
      } finally { await reduced.close(); }
      const selectors = config.boxes ?? [];
      assert.ok(selectors.length && selectors.every(s => s.startsWith('.rp-')), 'Задайте рамки .rp-* в shots-masks.json');
      const actual = await boxes(page, selectors);
      const mock = await browser.newPage();
      await openMock(mock, screen, size);
      const expected = await boxes(mock, selectors);
      actual.forEach((box, i) => Object.keys(box).forEach(key => assert.ok(Math.abs(box[key] - expected[i][key]) <= 6, `${selectors[i]} ${key}: отклонение > 6 px`)));
      await compare(screen, size, path);
    }
    for (const item of registry.items.filter(item => item.screen === screen)) {
      assert.equal(item.check, 'dom', `Для ${item.dataUi} нужен отдельный e2e-сценарий`);
      if (item.seed) await page.goto(`${vite.url}#/guitar/_dev/seed?set=${encodeURIComponent(item.seed)}`);
      assert.ok(await page.$(`[data-ui=${JSON.stringify(item.dataUi)}]`), `Нет ${item.dataUi}`);
      regPassed++;
    }
    assert.deepEqual(log.errors(), [], 'Ошибки страницы/сети/консоли');
  } catch (error) { log?.print(); throw error; }
  finally { try { await browser?.close(); } finally { await vite.close(); } }
}

try {
  const screens = [];
  let lang = 'ru', selfTest = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lang') { lang = args[++i]; assert.ok(['ru', 'en'].includes(lang), 'Язык: ru или en'); }
    else if (args[i] === '--self-test') selfTest = true;
    else { assert.match(args[i], /^[a-z][a-z0-9-]*$/, 'Неизвестный аргумент'); screens.push(args[i]); }
  }
  assert.ok(!selfTest || !screens.length, '--self-test запускается отдельно от экранов');
  // SHOTS 0/0 допустим только как часть --self-test: пустой прогон не выдаёт себя за пройденный.
  if (!selfTest && !screens.length) {
    console.error('Укажите экраны: node apps/web/e2e/guitar-shots.mjs <экран…> [--lang en]; проверка обвязки — --self-test');
    process.exit(2);
  }
  await mkdir(output, { recursive: true });
  console.log(`Артефакты: ${output}`);
  if (selfTest) {
    total = 1;
    const browser = await launchFirefox();
    try {
      const page = await browser.newPage();
      const size = { width: 1440, height: 900 };
      await openMock(page, 'system', size);
      const path = join(output, 'system-1440x900.png');
      await shoot(page, path, size);
      await compare('system', size, path);
      passed++;
    } finally { await browser.close(); }
  } else {
    total = screens.length * 2;
    regTotal = screens.reduce((sum, screen) => sum + registry.items.filter(item => item.screen === screen).length * 2, 0);
    for (const screen of screens) for (const size of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
      try { await screenShot(screen, size, lang); passed++; }
      catch (error) { console.error(`${screen}: ${error.message}`); process.exitCode = 1; }
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
console.log(`SHOTS ${passed}/${total}`);
console.log(`UI-REG ${regPassed}/${regTotal}`);
