// Отклик дорожки на вердикты (ui-spec §9, §10.2) на dev-стенде с имитацией судьи (#/guitar/_dev/highway?verdicts=1,
// звука нет): над грифом появляются подписи «← −38 мс» (рано), «+52 мс →» (поздно), «✕ D♯3 · +1 лад» (не та нота),
// живут ≈ 600 мс и гаснут; попадание вовремя и промах — без подписи. Снимки в паузе (пробел) — вспышка попадания и серая
// нота промаха на канвасе, для взгляда человека: ~/.cache/pupitre/e2e/verdicts/.
// Запуск: node apps/web/e2e/guitar-verdicts.mjs
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { emojiWoff2Firefox, launchFirefox, scenario, seedAndReload, shoot, startVite } from './lib/browser.mjs';

const OUT = join(homedir(), '.cache/pupitre/e2e/verdicts');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// пауза стенда — пробел (keyboard.press('Space') в Firefox BiDi не знает)
const space = (page) => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })));

await scenario(async (track) => {
  const vite = await startVite();
  let browser;
  try {
    browser = await launchFirefox();
    const page = await browser.newPage();
    track(page, { knownPreexisting: [emojiWoff2Firefox] });
    await page.goto(vite.url);
    await seedAndReload(page);
    await page.goto(new URL('#/guitar/_dev/highway?verdicts=1', vite.url).href);
    await page.waitForSelector('[data-ui="dev-highway"][data-verdicts="on"] [data-ui="highway-verdicts"]', { timeout: 20000 });

    // 8 с наблюдения: какие подписи видны (opacity > 0), их вид, текст и сколько живут
    const seen = await page.evaluate(async () => {
      const out = { kinds: {}, texts: {}, maxShown: 0, lifeMs: [] };
      const born = new Map();
      const until = performance.now() + 8000;
      while (performance.now() < until) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const shown = [...document.querySelectorAll('[data-ui="highway-verdicts"] .rp-verdict')].filter((el) => Number(el.style.opacity) > 0);
        out.maxShown = Math.max(out.maxShown, shown.length);
        const alive = new Set();
        for (const el of shown) {
          const kind = [...el.classList].find((c) => c.startsWith('rp-verdict--'))?.slice(12) ?? '?';
          const text = el.textContent;
          const key = `${kind}|${text}`;
          alive.add(key);
          if (!born.has(key)) born.set(key, performance.now());
          out.kinds[kind] = (out.kinds[kind] ?? 0) + 1;
          (out.texts[kind] ??= []).includes(text) || out.texts[kind].length > 4 || out.texts[kind].push(text);
        }
        for (const [key, at] of born) if (!alive.has(key)) {
          out.lifeMs.push(Math.round(performance.now() - at));
          born.delete(key);
        }
      }
      return out;
    });
    console.log(`подписи: ${JSON.stringify(seen.texts)}; одновременно до ${seen.maxShown}; живут ${seen.lifeMs.slice(0, 8).join(', ')} мс`);
    for (const kind of ['early', 'late', 'wrong']) assert.ok(seen.kinds[kind] > 0, `нет подписи ${kind}`);
    assert.ok(seen.texts.early.every((t) => /^−\d+ мс$/.test(t)), `рано: ${seen.texts.early}`);
    assert.ok(seen.texts.late.every((t) => /^\+\d+ мс$/.test(t)), `поздно: ${seen.texts.late}`);
    assert.ok(seen.texts.wrong.every((t) => /^[A-G]♯?\d( · [+−]\d+ лад(а|ов)?)?$/.test(t)), `не та: ${seen.texts.wrong}`);
    assert.ok(seen.texts.wrong.some((t) => / · \+1 лад$/.test(t)), 'у одиночной ноты — «+1 лад»');
    assert.equal(Object.keys(seen.kinds).filter((k) => !['early', 'late', 'wrong'].includes(k)).length, 0, 'попадание и промах — без подписи');
    const lives = seen.lifeMs.filter((ms) => ms > 100);
    assert.ok(lives.length > 3 && lives.every((ms) => ms > 400 && ms < 900), `время жизни подписи: ${seen.lifeMs}`);

    // снимки в паузе: подпись «не та» на экране (вспышки и серые ноты — в том же кадре)
    for (const [name, kind] of [['wrong', 'wrong'], ['early', 'early']]) {
      await page.waitForFunction((k) => [...document.querySelectorAll(`[data-ui="highway-verdicts"] .rp-verdict--${k}`)]
        .some((el) => Number(el.style.opacity) > 0.9), { timeout: 15000, polling: 'raf' }, kind);
      await space(page);
      await wait(150);
      await shoot(page, join(OUT, `verdicts-${name}-1440x900.png`), { width: 1440, height: 900 });
      await space(page);
    }
    // крупно (×2, полоса грифа): вспышка попадания — в первые 60 мс после вердикта; промах — серая нота на грифе
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    for (const [name, codes, from, to] of [['flash', [2, 3, 4], 0.03, 0.07], ['missed', [6], 0.05, 0.12]]) {
      await page.waitForFunction((codes, from, to) => {
        const h = window.__pupitreDevHighway;
        const now = h.now();
        for (let i = 0; i < h.arr.notes.length; i++) {
          const age = now - h.arr.statusAt[i];
          if (codes.includes(h.arr.status[i]) && age >= from && age <= to) return true;
        }
        return false;
      }, { timeout: 15000, polling: 'raf' }, codes, from, to);
      await space(page);
      await wait(150);
      await page.screenshot({ path: join(OUT, `verdicts-${name}-board@2x.png`), clip: { x: 0, y: 480, width: 1440, height: 420 } });
      await space(page);
    }
    console.log(`снимки: ${OUT}`);
  } finally {
    await browser?.close();
    await vite.close();
  }
});
