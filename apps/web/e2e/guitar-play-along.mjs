// Срез 1 (этап 13, приёмка п. 1): пустая библиотека → демо-песня → подготовка → игра под синт-минус → отсчёт → время
// песни растёт, канвас дорожки непустой (пиксели), пауза и продолжение, перемотка вперёд, A/B-луп делает виток,
// F — во весь экран, выход на подготовку песни. Ни одного обращения к /api из раздела.
import assert from 'node:assert/strict';
import { launchFirefox, scenario, seedAndReload, startVite, emojiWoff2Firefox } from './lib/browser.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (text) => {
  const m = /(\d+):(\d\d)\s*$/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

await scenario(async (track) => {
  const vite = await startVite();
  let browser;
  try {
    browser = await launchFirefox();
    const page = await browser.newPage();
    const log = track(page, { knownPreexisting: [emojiWoff2Firefox] });
    await page.goto(vite.url);
    await seedAndReload(page);
    const sectionStart = log.all().length;
    await page.goto(new URL('#/guitar', vite.url).href);
    await page.waitForSelector('[data-ui="library-empty"]', { timeout: 20000 });
    await page.click('[data-ui="library-demo"]');
    await page.waitForSelector('[data-ui="library-grid"] .rp-songcard', { timeout: 60000 });
    await page.click('.rp-songcard__poster-link');
    await page.waitForSelector('[data-ui="song-play"]');
    await page.click('[data-ui="song-play"]');
    await page.waitForSelector('[data-ui="play-start"]', { timeout: 60000 });

    await page.click('[data-ui="play-go"]');
    await page.waitForSelector('[data-ui="play-countdown"]', { timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector('[data-ui="play-countdown"]'), { timeout: 8000 });
    const where = () => page.$eval('[data-ui="play-time"]', (el) => el.textContent ?? '');
    const t1 = seconds(await where());
    await wait(2500);
    const t2 = seconds(await where());
    console.log(`время песни: ${t1} → ${t2} с`);
    assert.ok(t2 >= t1 + 2, `время песни не растёт: ${t1} → ${t2}`);

    const lit = await page.$eval('[data-ui="highway"] canvas', (canvas) => {
      const { width, height } = canvas;
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 16) if (data[i] + data[i + 1] + data[i + 2] > 120) n++;
      return { n, width, height };
    });
    console.log(`канвас ${lit.width}×${lit.height}: светлых пикселей ${lit.n}`);
    assert.ok(lit.n > 2000, `канвас дорожки почти пуст: ${lit.n}`);

    await page.keyboard.press(' ');
    await page.waitForSelector('[data-ui="play-paused"]', { timeout: 3000 });
    const paused = seconds(await where());
    await wait(1200);
    assert.equal(seconds(await where()), paused, 'на паузе время идёт');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => !document.querySelector('[data-ui="play-paused"]'), { timeout: 3000 });

    const beforeSeek = seconds(await where());
    await page.keyboard.press('ArrowRight');
    await wait(1500);
    const afterSeek = seconds(await where());
    console.log(`перемотка: ${beforeSeek} → ${afterSeek} с`);
    assert.ok(afterSeek >= beforeSeek + 4, `перемотка вперёд не сработала: ${beforeSeek} → ${afterSeek}`);

    // Луп текущей секции: дожидаемся витка — время возвращается назад, пилюля «Такты» на месте.
    await page.keyboard.press('l');
    await page.waitForSelector('[data-ui="play-loop"]', { timeout: 3000 });
    let wrapped = false;
    let last = seconds(await where());
    for (let i = 0; i < 40 && !wrapped; i++) {
      await wait(500);
      const now = seconds(await where());
      if (now < last) wrapped = true;
      last = now;
    }
    assert.ok(wrapped, 'A/B-луп не сделал виток');
    console.log(`луп: ${await page.$eval('[data-ui="play-loop"]', (el) => el.textContent)}`);
    await page.keyboard.press('l');

    await page.keyboard.press('f');
    await wait(500);
    console.log(`полный экран: ${await page.evaluate(() => !!document.fullscreenElement)}`);
    if (await page.evaluate(() => !!document.fullscreenElement)) await page.keyboard.press('f');

    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-ui="play-paused"]', { timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-ui="song"]', { timeout: 5000 });

    const api = log.all().slice(sectionStart).filter((e) => e.type === 'request' && /\/api\//.test(e.url));
    assert.deepEqual(api.map((e) => e.url), [], 'раздел ходил в /api');
  } finally {
    try { await browser?.close(); } finally { await vite.close(); }
  }
});
