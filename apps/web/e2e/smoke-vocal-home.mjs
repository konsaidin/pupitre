import assert from 'node:assert/strict';
import { startVite, launchFirefox, seedAndReload, scenario, emojiWoff2Firefox } from './lib/browser.mjs';

await scenario(async track => {
  const vite = await startVite();
  let browser;
  try {
    browser = await launchFirefox();
    const page = await browser.newPage();
    const log = track(page, { knownPreexisting: [emojiWoff2Firefox] });
    await page.goto(vite.url);
    await seedAndReload(page);
    await page.waitForSelector('.screen.home', { visible: true });
    assert.equal(await page.$('.lang-picker'), null, 'Показан выбор языка');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    assert.deepEqual(log.errors(), [], 'Неожиданные ошибки страницы/консоли/сети');
  } finally {
    try { await browser?.close(); } finally { await vite.close(); }
  }
});
