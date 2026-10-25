// Оценка игры вживую (M2) на поддельном микрофоне Firefox: вход выбран → в игре вместо «Без оценки» — точность, серия,
// очки, множитель и пилюля входа; кадры входа доходят до судьи (тон 1 кГц поддельного микрофона ни с одной нотой демо не
// совпадает — вердикты идут промахами, точность становится числом); перемотка к концу → итоги с промахами;
// «Сыграть ещё» — новая сессия с экраном старта. Качество распознавания — в src/guitar/judge/pipeline.test.ts.
// Запуск: node apps/web/e2e/guitar-scoring.mjs
import assert from 'node:assert/strict';
import { emojiWoff2Firefox, launchFirefox, scenario, seedAndReload, startVite } from './lib/browser.mjs';

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

    await page.click('[data-ui="play-go"]');
    await page.waitForFunction(() => !document.querySelector('[data-ui="play-countdown"]') && !document.querySelector('[data-ui="play-start"]'), { timeout: 10000 });
    // первые события закрываются промахами — точность становится числом
    await page.waitForFunction(() => /\d/.test(document.querySelector('[data-ui="play-accuracy"] .hud-stat__v')?.textContent ?? ''), { timeout: 15000 });
    const hud = await page.evaluate(() => ({
      accuracy: document.querySelector('[data-ui="play-accuracy"] .hud-stat__v').textContent,
      streak: document.querySelector('[data-ui="play-streak"] .hud-stat__v').textContent,
      input: document.querySelector('[data-ui="play-input"]').dataset.state,
    }));
    console.log(`HUD: точность ${hud.accuracy}, серия ${hud.streak}, вход ${hud.input}`);
    assert.ok(OPEN.includes(hud.input), `вход в игре: ${hud.input}`);

    // к концу песни: перемотка по 5 с
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowRight');
      await wait(150);
    }
    await page.waitForSelector('[data-ui="play-results"]', { timeout: 40000 });
    const results = await page.evaluate(() => ({
      accuracy: document.querySelector('[data-ui="results-accuracy"]').textContent,
      hits: Number(document.querySelector('[data-ui="results-hits"]').textContent),
      misses: Number(document.querySelector('[data-ui="results-misses"]').textContent),
    }));
    console.log(`итоги: ${JSON.stringify(results)}`);
    assert.ok(results.misses > 0, 'нет промахов при чужом тоне');

    await page.click('[data-ui="results-again"]');
    await page.waitForSelector('[data-ui="play-start"]', { timeout: 60000 });
    assert.equal(await page.$('[data-ui="play-results"]'), null);
    console.log('«Сыграть ещё»: новая сессия');
  } finally {
    try { await browser?.close(); } finally { await vite.close(); }
  }
});
