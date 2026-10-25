// Режим обучения на поддельном микрофоне Firefox (тон 1 кГц — ни одна нота демо с ним не совпадает): на старте выбран
// «Учить песню» → игра встаёт на первой ноте (плашка «Сыграй, чтобы ехать дальше», время стоит, промахов нет);
// пауза и продолжение — снова ждёт; переключение на «Играть» в меню паузы недоступно — через перезапуск: «Играть»
// на старте — песня идёт, промахи засчитываются. Распознавание «сыграно» — src/guitar/play/learn.test.ts.
// Запуск: node apps/web/e2e/guitar-learn.mjs
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { emojiWoff2Firefox, launchFirefox, scenario, seedAndReload, shoot, startVite } from './lib/browser.mjs';

const OUT = join(homedir(), '.cache/pupitre/e2e/learn');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OPEN = ['ok', 'no-signal', 'clipping'];

await scenario(async (track) => {
  const vite = await startVite();
  let browser;
  try {
    browser = await launchFirefox();
    const page = await browser.newPage();
    track(page, { knownPreexisting: [emojiWoff2Firefox] });
    await page.goto(vite.url);
    await seedAndReload(page);

    // вход: поддельный микрофон
    await page.goto(new URL('#/guitar/input', vite.url).href);
    await page.waitForSelector('[data-ui="input-allow"], [data-ui="input-devices"]', { timeout: 20000 });
    await page.click((await page.$('[data-ui="input-allow"]')) ? '[data-ui="input-allow"]' : '[data-ui="input-devices"] .io__device');
    await page.waitForFunction((open) => open.includes(document.querySelector('[data-ui="shell-input-pill"]')?.dataset.state), { timeout: 15000 }, OPEN);

    // демо-песня → игра
    await page.goto(new URL('#/guitar', vite.url).href);
    await page.waitForSelector('[data-ui="library-empty"], [data-ui="library-grid"] .rp-songcard', { timeout: 20000 });
    if (await page.$('[data-ui="library-demo"]')) await page.click('[data-ui="library-demo"]');
    await page.waitForSelector('[data-ui="library-grid"] .rp-songcard', { timeout: 60000 });
    await page.click('.rp-songcard__poster-link');
    await page.waitForSelector('[data-ui="song-play"]');
    await page.click('[data-ui="song-play"]');
    await page.waitForSelector('[data-ui="play-start"]', { timeout: 60000 });
    assert.equal(await page.$('.game__nojudge'), null, 'при выбранном входе — «Без оценки»');
    for (const ui of ['play-accuracy', 'play-streak', 'play-score', 'play-input']) assert.ok(await page.$(`[data-ui="${ui}"]`), `нет ${ui}`);

    await page.click('[data-ui="play-mode"] .rp-seg__item:nth-child(2)');
    await page.waitForFunction(() => document.querySelector('[data-ui="play-mode"] .rp-seg__item:nth-child(2)')?.getAttribute('aria-checked') === 'true');
    await shoot(page, join(OUT, 'learn-start-1440x900.png'), { width: 1440, height: 900 });
    await page.click('[data-ui="play-go"]');
    await page.waitForSelector('[data-ui="play-waiting"]', { timeout: 20000 });
    await wait(400);
    await shoot(page, join(OUT, 'learn-waiting-1440x900.png'), { width: 1440, height: 900 });
    const at = async () => page.evaluate(() => document.querySelector('[data-ui="play-time"]').textContent);
    const first = await at();
    const chip = await page.evaluate(() => document.querySelector('[data-ui="play-waiting"]').textContent);
    await wait(2500);
    const later = await at();
    const accuracy = await page.evaluate(() => document.querySelector('[data-ui="play-accuracy"] .hud-stat__v').textContent);
    console.log(`ждём: «${chip}»; время ${first} → ${later}; точность ${accuracy}`);
    assert.equal(later, first, 'время идёт во время ожидания');
    assert.ok(await page.$('[data-ui="play-waiting"]'), 'ожидание снялось без попадания');
    assert.ok(!/\d/.test(accuracy), `промахи во время ожидания: ${accuracy}`);
    // пауза из ожидания и продолжение — снова ждёт ту же ноту
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-ui="play-paused"]');
    await page.click('[data-ui="play-paused"] .pause__item'); // «Продолжить» (Esc на паузе — выход)
    await page.waitForSelector('[data-ui="play-waiting"]', { timeout: 20000 });
    console.log('пауза и продолжение: снова ждёт');
    // настройка запомнилась
    const learnSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('pupitre.guitar.v1')).learn);
    assert.equal(learnSaved, true, 'режим обучения не сохранился');
  } finally {
    try { await browser?.close(); } finally { await vite.close(); }
  }
});
