// ELECTRON-сценарий среза 1 (этап 13, приёмка п. 3): под file:// — демо-песня через библиотеку, рендер синт-минуса в
// воркере, 10 с игры; время рендера и снимки подготовки и игры — в отчёт (~/.cache/pupitre/e2e/electron).
// Запуск: node apps/desktop/e2e/run-electron.mjs apps/desktop/e2e/guitar-play-main.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { guitarApp } = require('./lib/guitar-app');

const OUT = path.join(os.homedir(), '.cache/pupitre/e2e/electron');
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;

(async () => {
  const g = await guitarApp({ timeoutMs: 90000 });
  await g.scenario(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await g.run(`localStorage.setItem('pupitre.lang.v1', 'ru'); localStorage.setItem('pupitre.profile.v1', '{}'); location.hash = '#/guitar'; location.reload()`);
    await g.until(q('[data-ui="library-demo"]'), 'пустая библиотека');
    await g.run(`${q('[data-ui="library-demo"]')}.click()`);
    await g.until(q('[data-ui="library-grid"] .rp-songcard'), 'карточка демо-песни', 30000);
    await g.run(`${q('.rp-songcard__poster-link')}.click()`);
    await g.until(q('[data-ui="song-play"]'), 'подготовка песни');
    fs.writeFileSync(path.join(OUT, 'song-1440x900.png'), await g.shot());
    const t0 = Date.now();
    await g.run(`${q('[data-ui="song-play"]')}.click()`);
    await g.until(q('[data-ui="play-start"]'), 'минус готов', 60000);
    console.log(`рендер синт-минуса и сессия: ${Date.now() - t0} мс`);
    await g.run(`${q('[data-ui="play-go"]')}.click()`);
    await g.until(`(${q('[data-ui="play-time"]')}?.textContent ?? '') >= '0:08'`, '10 с игры', 20000);
    fs.writeFileSync(path.join(OUT, 'play-1440x900.png'), await g.shot());
    const state = await g.run(`({ time: ${q('[data-ui="play-time"]')}.textContent, where: ${q('[data-ui="play-where"]')}.textContent, protocol: location.protocol })`);
    console.log(`ELECTRON ${process.versions.electron}: ${JSON.stringify(state)}`);
    if (state.protocol !== 'file:') throw new Error('не file://');
  });
})();
