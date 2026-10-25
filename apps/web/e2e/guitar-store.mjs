// Хранилище раздела (этап 9a, приёмка п. 2): настоящий воркер разбора (?worker&inline) импортирует фикстуру,
// песня переживает перезагрузку, повторный импорт — дубль, Blob 20 МБ пишется в IndexedDB и читается обратно.
// Dev-стенд #/guitar/_dev/store (только DEV).
import assert from 'node:assert/strict';
import { launchFirefox, scenario, seedAndReload, startVite, emojiWoff2Firefox } from './lib/browser.mjs';

const BLOB_SIZE = 20 * 1024 * 1024;
let blobSum = 0;
for (let i = 0; i < BLOB_SIZE; i += 4096) blobSum = (blobSum + ((i / 4096) & 255)) % 65521;

async function status(page, pattern, what) {
  await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('[data-ui="dev-store-status"]')?.textContent ?? ''),
    { timeout: 60000 }, pattern.source);
  const text = await page.$eval('[data-ui="dev-store-status"]', (el) => el.textContent);
  console.log(`${what}: ${text}`);
  return text;
}

await scenario(async (track) => {
  const vite = await startVite();
  let browser;
  try {
    browser = await launchFirefox();
    const page = await browser.newPage();
    track(page, { knownPreexisting: [emojiWoff2Firefox] });
    await page.goto(vite.url);
    await seedAndReload(page);
    await page.goto(new URL('#/guitar/_dev/store', vite.url).href);
    await page.waitForSelector('[data-ui="dev-store"]', { visible: true });

    await page.click('[data-ui="dev-store-import"]');
    const imported = await status(page, /^(imported|error)/, 'импорт');
    assert.match(imported, /^imported [0-9a-f]{16} 1 5 new$/, imported); // 4 ноты/аккорд в такте 1 + половинная в такте 2
    const id = imported.split(' ')[1];
    await page.waitForSelector(`[data-song="${id}"]`);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(`[data-song="${id}"]`, { timeout: 20000 });
    const title = await page.$eval(`[data-song="${id}"]`, (el) => el.textContent);
    assert.match(title, /Store probe — Pupitre · 1/, title);

    await page.click('[data-ui="dev-store-import"]');
    assert.match(await status(page, /duplicate|error/, 'повторный импорт'), /duplicate$/);

    await page.click('[data-ui="dev-store-blob"]');
    assert.equal(await status(page, /^blob /, 'Blob 20 МБ'), `blob ${BLOB_SIZE} ${blobSum}`);
  } finally {
    try { await browser?.close(); } finally { await vite.close(); }
  }
});
