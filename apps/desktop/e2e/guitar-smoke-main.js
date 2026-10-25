// ELECTRON-смоук гитарного раздела (этап 8b, приёмка п. 4): file://, ленивый чанк раздела загружен, CSS «Рампы»
// применён (фон .rampa), шрифт «Rampa Sans» доступен, 0 ошибок консоли; снимок оболочки — в отчёт.
// Запуск: node apps/desktop/e2e/run-electron.mjs apps/desktop/e2e/guitar-smoke-main.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { guitarApp } = require('./lib/guitar-app');

const OUT = path.join(os.homedir(), '.cache/pupitre/e2e/electron');

(async () => {
  const g = await guitarApp();
  await g.scenario(async () => {
    await g.run(`localStorage.setItem('pupitre.lang.v1', 'ru'); localStorage.setItem('pupitre.profile.v1', '{}'); location.reload()`);
    await g.until(`document.querySelector('.screen.home')`, 'вокальная главная');
    await g.run(`location.hash = '#/guitar'`);
    await g.until(`document.querySelector('.rampa .rp-topbar')`, 'оболочка раздела');
    const state = await g.run(`(async () => {
      await document.fonts.load('16px "Rampa Sans"');
      await document.fonts.ready;
      // Под file:// Chromium не пишет resource timing модулей; CSS ленивого чанка вставляет загрузчик Vite при import().
      const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href') ?? '');
      return {
        protocol: location.protocol,
        lazyChunk: links.some((h) => /GuitarApp-[\\w-]+\\.css$/.test(h)),
        background: getComputedStyle(document.querySelector('.rampa')).backgroundColor,
        font: document.fonts.check('16px "Rampa Sans"'),
        section: document.documentElement.dataset.section,
        legacyTopbar: !!document.querySelector('.topbar'),
      };
    })()`);
    console.log(`ELECTRON ${process.versions.electron} / Chromium ${process.versions.chrome}: ${JSON.stringify(state)}`);
    if (state.protocol !== 'file:') throw new Error(`Протокол ${state.protocol}, ожидался file:`);
    if (!state.lazyChunk) throw new Error('Ленивый чанк GuitarApp не загружен');
    if (state.background !== 'rgb(7, 8, 13)') throw new Error(`Фон .rampa ${state.background} — CSS Рампы не применён`);
    if (!state.font) throw new Error('Шрифт Rampa Sans недоступен');
    if (state.section !== 'guitar') throw new Error('data-section не выставлен');
    if (state.legacyTopbar) throw new Error('Легаси .topbar в разделе');
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'shell-1440x900.png'), await g.shot());
    console.log(`Снимок: ${path.join(OUT, 'shell-1440x900.png')}`);
  });
})();
