// «Вход и звук» на поддельном микрофоне Firefox: без выбора — пилюля warn «Вход не выбран»; клик по пилюле — экран;
// доступ и выбор устройства — вход открыт, шкала и мини-уровень пилюли живые, выбор в настройках; каналы, мониторинг
// «Через Пюпитр» с громкостью, замер фона (громкий тон — не тишина: подсказка), эталон A4; «Не использовать вход» закрывает; перезагрузка — выбранный вход
// открывается сам; уход в вокальный режим закрывает захват (инв. 22), возврат — открывает снова. Журнал строгий.
// Запуск: node apps/web/e2e/guitar-input.mjs
import assert from 'node:assert/strict';
import { emojiWoff2Firefox, launchFirefox, scenario, seedAndReload, startVite } from './lib/browser.mjs';

const OPEN = ['ok', 'no-signal', 'clipping'];
const pillState = (page) => page.$eval('[data-ui="shell-input-pill"]', (el) => el.dataset.state);
const sessionState = (page) => page.evaluate(() => globalThis.__pupitreInput?.().state ?? 'missing');
const settings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('pupitre.guitar.v1') ?? 'null'));
const untilOpen = (page, timeout = 15000) =>
  page.waitForFunction((open) => open.includes(document.querySelector('[data-ui="shell-input-pill"]')?.dataset.state), { timeout }, OPEN);

async function clickText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (selector, text) => [...document.querySelectorAll(selector)].find((el) => el.textContent.trim() === text) ?? null,
    selector,
    text,
  );
  const el = handle.asElement();
  assert.ok(el, `нет «${text}» в ${selector}`);
  await el.click();
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
    await page.goto(new URL('#/guitar', vite.url).href);
    await page.waitForSelector('[data-ui="shell-input-pill"]', { timeout: 20000 });

    // 1. Вход не выбран: пилюля warn, захват закрыт.
    assert.equal(await pillState(page), 'off');
    assert.equal(await page.$eval('[data-ui="shell-input-pill"] .rp-inputpill__name', (el) => el.textContent), 'Вход не выбран');
    assert.ok(await page.$('[data-ui="shell-input-pill"] .rp-led--warn'), 'у невыбранного входа LED не warn');

    // 2. Клик по пилюле — экран «Вход и звук»; доступ (если браузер прячет метки) и выбор устройства.
    await page.click('[data-ui="shell-input-pill"]');
    await page.waitForSelector('[data-ui="input-screen"]', { timeout: 10000 });
    assert.ok(page.url().endsWith('#/guitar/input'), `адрес экрана: ${page.url()}`);
    await page.waitForSelector('[data-ui="input-allow"], [data-ui="input-devices"]', { timeout: 10000 });
    if (await page.$('[data-ui="input-allow"]')) {
      console.log('доступ: кнопка «Разрешить доступ»');
      await page.click('[data-ui="input-allow"]');
    } else {
      console.log('доступ: метки устройств видны, выбор из списка');
      await page.click('[data-ui="input-devices"] .io__device');
    }
    await untilOpen(page);
    await page.waitForSelector('[data-ui="input-devices"] .io__device[aria-checked="true"]', { timeout: 10000 });
    const devices = await page.$$eval('[data-ui="input-devices"] .io__device', (els) => els.map((el) => `${el.textContent} ${el.getAttribute('aria-checked')}`));
    console.log(`устройства: ${devices.join(' | ')}`);
    const saved = await settings(page);
    assert.ok(saved?.input?.deviceId, 'выбранное устройство не записано в настройки');
    assert.ok(saved.input.deviceLabel, 'метка устройства не записана');
    console.log(`настройки: ${saved.input.deviceId.slice(0, 12)}… «${saved.input.deviceLabel}»`);

    // 3. Шкала и мини-уровень живые (поддельный микрофон Firefox — тон).
    await page.waitForFunction(() => Number(document.querySelector('[data-ui="input-meter"] .rp-meter')?.style.getPropertyValue('--v')) > 0.2, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-ui="shell-input-pill"] .rp-mini-meter i.on').length > 0, { timeout: 5000 });
    const meter = await page.evaluate(() => ({
      v: document.querySelector('[data-ui="input-meter"] .rp-meter').style.getPropertyValue('--v'),
      peak: document.querySelector('[data-ui="input-peak"]').textContent,
      advice: document.querySelector('[data-ui="input-advice"]').dataset.advice,
      state: document.querySelector('[data-ui="shell-input-pill"]').dataset.state,
      bars: document.querySelectorAll('[data-ui="shell-input-pill"] .rp-mini-meter i.on').length,
    }));
    console.log(`уровень: --v=${meter.v}, «${meter.peak}», совет ${meter.advice}, состояние ${meter.state}, делений ${meter.bars}`);
    assert.match(meter.peak, /^пик −?\d+ дБFS$/);
    assert.notEqual(meter.advice, 'closed');

    // 4. Канал: смесь и первый вход переключаются без ошибок и пишутся в настройки.
    await clickText(page, '[data-ui="input-channel"] .rp-seg__item', 'Вход 1');
    assert.equal((await settings(page)).input.channel, 0);
    const both = await page.evaluate(() => [...document.querySelectorAll('[data-ui="input-channel"] .rp-seg__item')].find((el) => el.textContent === 'Оба')?.disabled);
    if (!both) {
      await clickText(page, '[data-ui="input-channel"] .rp-seg__item', 'Оба');
      assert.equal((await settings(page)).input.channel, -1);
    } else console.log('канал: устройство моно — «Оба» недоступно');

    // 5. Мониторинг через Пюпитр: громкость появляется и пишется; «Не слышать» — прячется.
    await clickText(page, '[data-ui="input-monitoring"] .rp-seg__item', 'Через Пюпитр');
    await page.waitForSelector('[data-ui="input-monitor-volume"]');
    await page.$eval('[data-ui="input-monitor-volume"]', (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '40');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    let s = await settings(page);
    assert.deepEqual([s.monitoring.mode, s.mix.monitor], ['tone', 0.4]);
    await clickText(page, '[data-ui="input-monitoring"] .rp-seg__item', 'Не слышать');
    assert.equal(await page.$('[data-ui="input-monitor-volume"]'), null);
    assert.equal((await settings(page)).monitoring.mode, 'off');

    // 6. Оценка задержки туда-обратно — число.
    const rtl = await page.$eval('[data-ui="input-latency"] .io__rtl', (el) => el.textContent);
    console.log(`задержка туда-обратно: ${rtl}`);

    // 7. Замер фона: тон поддельного микрофона (≈ −23 дБFS) — не тишина: подсказка, в настройки не идёт.
    await page.click('[data-ui="input-measure"]');
    await page.waitForFunction(() => /Слишком громко/.test(document.querySelector('[data-ui="input-noise"]')?.textContent ?? ''), { timeout: 8000 });
    const noise = await page.$eval('[data-ui="input-noise"]', (el) => el.textContent);
    console.log(`фон: ${noise}`);
    assert.equal((await settings(page)).input.noiseDb, undefined);

    // 8. Эталон A4: 440 → 441 → 440.
    await page.click('[data-ui="input-a4"] button[aria-label="Больше"]');
    assert.equal(await page.$eval('[data-ui="input-a4"] output', (el) => el.textContent), 'A4 441 Гц');
    assert.equal((await settings(page)).reference.a4Hz, 441);
    await page.click('[data-ui="input-a4"] button[aria-label="Меньше"]');
    assert.equal((await settings(page)).reference.a4Hz, 440);

    // 9. «Не использовать вход» закрывает захват; выбор снова — открывает.
    await page.click('.io__off');
    await page.waitForFunction(() => document.querySelector('[data-ui="shell-input-pill"]')?.dataset.state === 'off', { timeout: 5000 });
    assert.equal(await sessionState(page), 'off');
    assert.equal((await settings(page)).input.deviceId, null);
    await page.click('[data-ui="input-devices"] .io__device');
    await untilOpen(page);

    // 10. Перезагрузка в библиотеке: выбранный вход открывается сам, пилюля живая.
    await page.goto(new URL('#/guitar', vite.url).href);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-ui="shell-input-pill"]', { timeout: 20000 });
    await untilOpen(page);
    // жест игрока запускает контекст, если браузер придержал его до жеста
    await page.mouse.click(5, 300);
    await page.waitForFunction(() => document.querySelectorAll('[data-ui="shell-input-pill"] .rp-mini-meter i.on').length > 0, { timeout: 8000 });
    console.log(`после перезагрузки: ${await pillState(page)}`);

    // 11. Вокальный режим закрывает захват (один захват на приложение), возврат — открывает.
    await clickText(page, '[data-ui="shell-mode-switch"] .rp-seg__item', 'Голос');
    await page.waitForFunction(() => !document.querySelector('[data-ui="guitar-root"]'), { timeout: 10000 });
    await page.waitForFunction(() => globalThis.__pupitreInput?.().state === 'off', { timeout: 5000 });
    console.log('вокальный режим: захват закрыт');
    await page.goto(new URL('#/guitar', vite.url).href);
    await page.waitForSelector('[data-ui="shell-input-pill"]', { timeout: 20000 });
    await untilOpen(page);
    console.log(`возврат в раздел: ${await pillState(page)}`);
  } finally {
    await browser?.close();
    await vite.close();
  }
});
