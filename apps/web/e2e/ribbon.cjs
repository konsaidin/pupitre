// E2E ленты вокала: упражнение с фейковым микрофоном (тон 1 кГц),
// проверка что лента рисуется (цветные пиксели слева от линии «сейчас»),
// переключение на пиано-ролл и обратно, скриншоты.
const puppeteer = require('puppeteer-core');

const PROFILE = {
  range: { lowMidi: 48, highMidi: 72 },
  difficulty: 'beginner',
  headphonesWarned: true,
};

(async () => {
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: '/usr/bin/firefox',
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    extraPrefsFirefox: {
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
    },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto('http://localhost:5173/', { waitUntil: 'load' });
    await page.evaluate((profile) => {
      localStorage.setItem('slopsician.lang.v1', 'en');
      localStorage.setItem('slopsician.profile.v1', JSON.stringify(profile));
    }, PROFILE);
    await page.goto('http://localhost:5173/#/exercises', { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' }); // профиль читается при инициализации

    // «Sing» прямо в шапке первой карточки → сетап → старт
    try {
      await page.waitForSelector('.card-head .btn.primary', { timeout: 10000 });
    } catch (e) {
      await page.screenshot({ path: 'debug-no-card.png' });
      console.log('URL:', page.url(), 'BODY:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
      throw e;
    }
    await page.click('.card-head .btn.primary');
    await page.waitForSelector('.btn.primary.big');
    await page.click('.btn.primary.big');

    // отсчёт 3 с + немного игры (с запасом на холодный старт dev-сервера)
    await new Promise((r) => setTimeout(r, 7500));
    await page.screenshot({ path: 'ribbon.png' });

    const ribbonStats = await page.evaluate(() => {
      const canvas = document.querySelector('.pianoroll-wrap canvas');
      if (!canvas) return { error: 'canvas не найден' };
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const img = ctx.getImageData(0, 0, w, h).data;
      // фон #0d1117; считаем «цветные» пиксели левее линии «сейчас» (~30%)
      const nowX = Math.floor(w * 0.3);
      let ribbon = 0;
      let green = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < nowX; x++) {
          const i = (y * w + x) * 4;
          const r = img[i], g = img[i + 1], b = img[i + 2];
          if (Math.abs(r - 13) + Math.abs(g - 17) + Math.abs(b - 23) < 30) continue; // фон
          ribbon++;
          if (g > r + 30 && g > b + 20) green++;
        }
      }
      return { canvasW: w, canvasH: h, coloredLeftOfNow: ribbon, greenish: green };
    });
    console.log('ribbon:', JSON.stringify(ribbonStats));

    // переключение на пиано-ролл (вторая кнопка сегмента в шапке) и обратно
    const segButtons = await page.$$('.game-header .seg .seg-btn');
    await segButtons[1].click();
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: 'roll.png' });
    const rollHasKeyboard = await page.evaluate(() => {
      const canvas = document.querySelector('.pianoroll-wrap canvas');
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(0, 0, 40, canvas.height).data;
      let light = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] > 180 && img[i + 1] > 180 && img[i + 2] > 180) light++;
      }
      return light > 500; // белые клавиши слева
    });
    await segButtons[0].click();
    await new Promise((r) => setTimeout(r, 500));

    console.log('roll keyboard visible:', rollHasKeyboard);
    const ok = !ribbonStats.error && ribbonStats.coloredLeftOfNow > 2000 && rollHasKeyboard;
    console.log(ok ? 'E2E OK' : 'E2E FAIL');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
  }
})();
