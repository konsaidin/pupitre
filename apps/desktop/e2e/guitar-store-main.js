// ELECTRON: воркер разбора (?worker&inline) под file:// (этап 9a, приёмка п. 3) — dev-стенд #/guitar/_dev/store:
// импорт alphaTex-фикстуры через настоящий воркер, песня переживает перезагрузку, 0 ошибок консоли.
// Запуск: node apps/desktop/e2e/run-electron.mjs apps/desktop/e2e/guitar-store-main.js --dev-build
const { guitarApp } = require('./lib/guitar-app');

(async () => {
  const g = await guitarApp({ timeoutMs: 60000 });
  await g.scenario(async () => {
    await g.run(`localStorage.setItem('pupitre.lang.v1', 'ru'); localStorage.setItem('pupitre.profile.v1', '{}'); location.hash = '#/guitar/_dev/store'; location.reload()`);
    await g.until(`document.querySelector('[data-ui="dev-store"]')`, 'dev-стенд хранилища');
    if (!(await g.run('location.protocol === "file:"'))) throw new Error('не file://');
    await g.run(`document.querySelector('[data-ui="dev-store-import"]').click()`);
    await g.until(`/^(imported|error)/.test(document.querySelector('[data-ui="dev-store-status"]').textContent)`, 'ответ воркера', 30000);
    const status = await g.run(`document.querySelector('[data-ui="dev-store-status"]').textContent`);
    console.log(`воркер под file://: ${status}`);
    if (!/^imported [0-9a-f]{16} 1 5 (new|duplicate)$/.test(status)) throw new Error(status);
    const id = status.split(' ')[1];
    await g.run('location.reload()');
    await g.until(`document.querySelector('[data-song="${id}"]')`, 'песня после перезагрузки', 15000);
  });
})();
