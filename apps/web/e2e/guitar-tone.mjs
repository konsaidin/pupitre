// Экран «Тон» на поддельном микрофоне Firefox, без звука наружу (мониторинг выключен, минус и гайд — в нуле):
// бас-комплект (голова и кабинет, галетный переключатель середины, ручки стрелками); пресеты (встроенный → «изменён» →
// «Вернуть», «Сохранить как…» → свой переживает перезагрузку → удаление из меню); дека записи (REC → пилюля в
// оболочке → STOP → дубль в списке и в IndexedDB → переименование → удаление); тон и тюнер поверх игры (O/U, Esc —
// обратно к песне на том же месте, счёт и время не сброшены).
// Запуск: node apps/web/e2e/guitar-tone.mjs
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { emojiWoff2Firefox, launchFirefox, scenario, seedAndReload, shoot, startVite } from './lib/browser.mjs';

const OUT = join(homedir(), '.cache/pupitre/e2e/tone');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OPEN = ['ok', 'no-signal', 'clipping'];
const SILENT = { version: 1, mix: { backing: 0, reference: 0, metronome: 0, guide: 0, monitor: 0 }, monitoring: { mode: 'off' } };

await scenario(async (track) => {
  const vite = await startVite();
  let browser;
  try {
    browser = await launchFirefox();
    const page = await browser.newPage();
    track(page, { knownPreexisting: [emojiWoff2Firefox] });
    await page.goto(vite.url);
    await seedAndReload(page, { guitar: SILENT });
    const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('pupitre.guitar.v1')));

    // вход: поддельный микрофон
    await page.goto(new URL('#/guitar/input', vite.url).href);
    await page.waitForSelector('[data-ui="input-allow"], [data-ui="input-devices"]', { timeout: 20000 });
    await page.click((await page.$('[data-ui="input-allow"]')) ? '[data-ui="input-allow"]' : '[data-ui="input-devices"] .io__device');
    await page.waitForFunction((open) => open.includes(document.querySelector('[data-ui="shell-input-pill"]')?.dataset.state), { timeout: 15000 }, OPEN);

    // бас-комплект
    await page.goto(new URL('#/guitar/tone', vite.url).href);
    await page.waitForSelector('[data-ui="tone-bar"]');
    await page.click('[data-ui="tone-rig"] .rp-seg__item:nth-child(2)');
    await page.waitForSelector('[data-ui="tone-bass-amp"]');
    assert.ok(await page.$('[data-ui="tone-bass-cab"]'), 'нет кабинета 4×10');
    assert.equal(await page.$('[data-ui="tone-amp"]'), null, 'гитарная голова осталась');
    await page.click('[data-ui="tone-bass-freq"] [data-pos="4"]');
    await page.waitForFunction(() => document.querySelector('[data-ui="tone-bass-freq"] [role="slider"]')?.getAttribute('aria-valuenow') === '4');
    await page.focus('[data-ui="tone-bass-gain"] .knob__dial');
    const gain0 = (await settings()).tone.bassAmp.gain;
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
    const s1 = await settings();
    assert.equal(s1.tone.rig, 'bass');
    assert.equal(s1.tone.bassAmp.midFreq, 4);
    assert.ok(Math.abs(s1.tone.bassAmp.gain - (gain0 + 0.05)) < 1e-6, `гейн баса ${gain0} → ${s1.tone.bassAmp.gain}`);
    await shoot(page, join(OUT, 'bass-1440x900.png'), { width: 1440, height: 900 });
    console.log('бас-комплект: переключатель середины и ручки — ОК');

    // пресеты: встроенный → изменён → вернуть
    await page.select('[data-ui="tone-preset"]', 'factory:bass-slap');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('pupitre.guitar.v1')).monitoring.toneId === 'factory:bass-slap');
    assert.equal((await settings()).tone.bassAmp.ultraLo, true, 'пресет «Слэп» не применился');
    assert.equal(await page.$('[data-ui="tone-preset-modified"]'), null);
    await page.focus('[data-ui="tone-bass-treble"] .knob__dial');
    await page.keyboard.press('ArrowUp');
    await page.waitForSelector('[data-ui="tone-preset-modified"]');
    await page.click('[data-ui="tone-preset-revert"]');
    await page.waitForFunction(() => !document.querySelector('[data-ui="tone-preset-modified"]'));
    // сохранить как свой — переживает перезагрузку
    await page.keyboard.press('ArrowUp');
    await page.click('[data-ui="tone-preset-save-as"]');
    await page.waitForSelector('[data-ui="tone-preset-name"] input');
    await page.focus('[data-ui="tone-preset-name"] input');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type('Мой слэп e2e');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('pupitre.guitar.v1')).monitoring.toneId?.startsWith('user:'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-ui="tone-preset"]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-ui="tone-preset"] option')].some((o) => o.selected && o.textContent === 'Мой слэп e2e'),
      { timeout: 10000 });
    await page.click('[data-ui="tone-preset-menu"]');
    await page.click('.tone-menu__list button:nth-child(2)');
    await page.click('[data-ui="tone-preset-delete"]');
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-ui="tone-preset"] option')].some((o) => o.textContent === 'Мой слэп e2e'));
    console.log('пресеты: встроенный, изменён, вернуть, свой после перезагрузки, удаление — ОК');

    // дека записи (вход открыт заново после перезагрузки)
    await page.waitForFunction((open) => open.includes(document.querySelector('[data-ui="shell-input-pill"]')?.dataset.state), { timeout: 15000 }, OPEN);
    await page.click('[data-ui="tone-deck-rec"]');
    await page.waitForSelector('[data-ui="shell-deck"]');
    await wait(1600);
    await shoot(page, join(OUT, 'deck-rec-1440x900.png'), { width: 1440, height: 900 });
    await page.click('[data-ui="tone-deck-stop"]');
    await page.waitForSelector('[data-ui="tone-take"]', { timeout: 10000 });
    assert.equal(await page.$('[data-ui="shell-deck"]'), null, 'пилюля деки осталась после стопа');
    const stored = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('pupitre-guitar');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const req = open.result.transaction('takes').objectStore('takes').getAll();
        req.onsuccess = () => resolve(req.result.map((t) => ({ name: t.name, frames: t.frames, seconds: t.frames / t.sampleRate, bytes: t.dry.size })));
        req.onerror = () => reject(req.error);
      };
    }));
    console.log('дубль:', JSON.stringify(stored));
    assert.equal(stored.length, 1);
    assert.ok(stored[0].seconds > 1 && stored[0].seconds < 3, `длина дубля ${stored[0].seconds} с`);
    assert.equal(stored[0].bytes, stored[0].frames * 4, 'сырые сэмплы не той длины');
    await page.click('[data-ui="tone-take-rename"]');
    await page.waitForSelector('.tone-take__edit input');
    await page.focus('.tone-take__edit input');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type('Рифф в ми');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.tone-take__name')?.textContent === 'Рифф в ми');
    await page.click('[data-ui="tone-take-delete"]');
    await page.click('[data-ui="tone-take-delete"]');
    await page.waitForFunction(() => !document.querySelector('[data-ui="tone-take"]'));
    console.log('дека: запись, пилюля, дубль, переименование, удаление — ОК');

    // тон и тюнер поверх игры
    await page.goto(new URL('#/guitar', vite.url).href);
    await page.waitForSelector('[data-ui="library-empty"], [data-ui="library-grid"] .rp-songcard', { timeout: 20000 });
    if (await page.$('[data-ui="library-demo"]')) await page.click('[data-ui="library-demo"]');
    await page.waitForSelector('[data-ui="library-grid"] .rp-songcard', { timeout: 60000 });
    await page.click('.rp-songcard__poster-link');
    await page.waitForSelector('[data-ui="song-play"]');
    await page.click('[data-ui="song-play"]');
    await page.waitForSelector('[data-ui="play-start"]', { timeout: 60000 });
    await page.keyboard.press('KeyU');
    await page.waitForSelector('[data-ui="play-sheet-tuner"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.game__sheet'));
    assert.ok(await page.$('[data-ui="play-start"]'), 'после тюнера игра не на старте');
    await page.click('[data-ui="play-go"]');
    await page.waitForFunction(() => document.querySelector('[data-ui="play-time"]')?.textContent === '0:03', { timeout: 20000 });
    await page.keyboard.press('KeyO');
    await page.waitForSelector('[data-ui="play-sheet-tone"] [data-ui="tone-bar"]');
    const where = await page.evaluate(() => document.querySelector('.game__sheet-where .rp-num').textContent);
    await shoot(page, join(OUT, 'play-sheet-tone-1440x900.png'), { width: 1440, height: 900 });
    await wait(2000);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-ui="play-paused"]');
    const after = await page.evaluate(() => document.querySelector('[data-ui="play-time"]').textContent);
    console.log(`тон поверх игры: ${where} → после закрытия ${after}`);
    assert.equal(after, where, 'песня ушла вперёд под панелью тона');
    assert.ok(await page.$('[data-ui="play-score"]'), 'счёт пропал');
    await page.click('[data-ui="play-paused"] .pause__item');
    await page.waitForFunction((t0) => document.querySelector('[data-ui="play-time"]')?.textContent !== t0, { timeout: 10000 }, after);
    console.log('тон и тюнер поверх игры: пауза на месте, продолжение — ОК');
  } finally {
    try { await browser?.close(); } finally { await vite.close(); }
  }
});
