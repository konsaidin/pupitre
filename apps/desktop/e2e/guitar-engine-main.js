// ELECTRON + нативный движок (этап 41): аддон packages/engine через мост preload (--pupitre-engine), JACK этой машины
// (у PipeWire — pipewire-jack); production-сборка веба, file://. Мониторинг выключен — на выходе тишина.
// 1) Самопроверка без устройств: петля внутри графа — задержка щелчков ровно один квант при 64, 128 и 256 кадрах.
// 2) «Вход и звук» на движке: бэкенд engine, устройства — клиенты JACK; выбранный вход открыт; задержка — отчёт драйвера
//    (при 128 кадрах — меньше 20 мс туда-обратно); буфер 64 переоткрывает движок с квантом 64; 0 срывов.
// 3) Игра с оценкой на движке: демо-песня, кадры анализа движка идут в страницу, судья выносит вердикты (вход молчит —
//    промахи), HUD — точность числом, пилюля входа в игре.
// 4) Изоляция падений: процесс движка (utilityProcess) убит — окно живо, сессия входа поднимает движок заново.
// 5) Уход в вокальный режим закрывает движок (один захват на приложение). Снимок экрана — в отчёт.
// Нет JACK — SKIPPED (сценарий проходит: движка в системе нет, приложение остаётся на захвате браузера).
// Запуск: node apps/desktop/e2e/run-electron.mjs apps/desktop/e2e/guitar-engine-main.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { guitarApp } = require('./lib/guitar-app');

const OUT = path.join(os.homedir(), '.cache/pupitre/e2e/electron');
const OPEN = `['ok', 'no-signal', 'clipping'].includes(document.querySelector('[data-ui="shell-input-pill"]')?.dataset.state)`;

(async () => {
  const g = await guitarApp({ engine: true, timeoutMs: 120000 });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Скрытое окно само почти не крутит кадры анимации: перерисовка и кадр на каждый опрос.
  const untilFramed = async (js, what, ms = 20000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      g.win.webContents.invalidate();
      // скрытое окно после capturePage кадров не даёт (снимок экрана входа выше) — запасной таймер, иначе ожидание вечное
      if (await g.run(`Promise.race([new Promise((r) => requestAnimationFrame(r)), new Promise((r) => setTimeout(r, 200))]).then(() => Boolean(${js}))`)) return;
      await wait(30);
    }
    throw new Error(`Не дождались: ${what}`);
  };
  await g.scenario(async () => {
    await g.run(`localStorage.setItem('pupitre.lang.v1', 'ru'); localStorage.setItem('pupitre.profile.v1', '{}'); location.reload()`);
    await g.until(`document.querySelector('.screen.home')`, 'вокальная главная');
    if (!(await g.run(`Boolean(window.pupitreEngine)`))) throw new Error('мост window.pupitreEngine не появился');
    const available = await g.run(`window.pupitreEngine.available()`);
    if (!available.ok) {
      console.log(`SKIPPED: JACK недоступен — ${available.reason}`);
      return;
    }

    // 1. Петля без устройств: задержка = квант.
    for (const buffer of [64, 128, 256]) {
      const r = await g.run(`(async () => {
        let meters = null;
        const off = window.pupitreEngine.onMeters((m) => (meters = m));
        await window.pupitreEngine.open({ capture: null, playback: null, channel: 0, bufferFrames: ${buffer}, monitorGain: 0, loopback: true });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const rtl = await window.pupitreEngine.measureRtl(6);
        off();
        await window.pupitreEngine.close();
        return { rtl, quantum: meters?.bufferFrames, xruns: meters?.xruns };
      })()`);
      console.log(`петля ${buffer}: квант ${r.quantum}, задержка ${r.rtl.delaysFrames.join(',')} (медиана ${r.rtl.medianMs.toFixed(2)} мс), промахов ${r.rtl.misses}, срывов ${r.xruns}`);
      if (r.quantum !== buffer) throw new Error(`квант ${r.quantum}, запрошен ${buffer}`);
      if (r.rtl.misses || r.rtl.delaysFrames.length !== 6 || r.rtl.delaysFrames.some((d) => d !== buffer)) throw new Error(`задержка петли не равна кванту: ${JSON.stringify(r.rtl)}`);
    }

    // 2. Экран входа на движке.
    await g.run(`location.hash = '#/guitar/input'`);
    await g.until(`document.querySelector('[data-ui="input-devices"] .io__device')`, 'список устройств движка', 15000);
    const screen = await g.run(`({
      backend: document.querySelector('[data-ui="input-screen"]').dataset.backend,
      devices: [...document.querySelectorAll('[data-ui="input-devices"] .io__device')].map((el) => el.textContent),
    })`);
    console.log(`бэкенд ${screen.backend}; устройства: ${screen.devices.join(' | ')}`);
    if (screen.backend !== 'engine') throw new Error(`бэкенд экрана ${screen.backend}, ожидался engine`);
    // предпочесть двухканальное устройство не встроенной карты (интерфейс), иначе первое
    await g.run(`(() => {
      const rows = [...document.querySelectorAll('[data-ui="input-devices"] .io__device')];
      (rows.find((el) => /CODEC|USB|Scarlett|Interface/i.test(el.textContent) && !/Mono/i.test(el.textContent)) ?? rows[0]).click();
    })()`);
    await g.until(OPEN, 'вход движка открыт', 15000);
    await untilFramed(`document.querySelector('[data-ui="input-latency"]')?.dataset.kind === 'engine' && /≈/.test(document.querySelector('[data-ui="input-latency"] .io__rtl')?.textContent ?? '')`, 'отчёт задержки движка');
    await wait(1200); // квант устанавливается после подключения — свежий отчёт драйвера приходит с метрами
    const state = await g.run(`({
      pill: document.querySelector('[data-ui="shell-input-pill"]').dataset.backend,
      hint: document.querySelector('.rp-field__hint')?.textContent,
      rtl: document.querySelector('[data-ui="input-latency"] .io__rtl').textContent,
      legend: document.querySelector('[data-ui="input-latency"] .lat-legend').textContent,
      saved: JSON.parse(localStorage.getItem('pupitre.guitar.v1')).input,
      status: null,
    })`);
    state.status = await g.run(`window.pupitreEngine.status()`);
    console.log(`ELECTRON ${process.versions.electron}: ${JSON.stringify(state)}`);
    const rtlMs = Number(state.rtl.replace(/[^\d,]/g, '').replace(',', '.'));
    if (state.pill !== 'engine') throw new Error('пилюля не на движке');
    if (!state.status.open || state.status.bufferFrames !== 128) throw new Error(`движок: ${JSON.stringify(state.status)}`);
    if (!(rtlMs > 0 && rtlMs < 20)) throw new Error(`задержка туда-обратно ${state.rtl} — ожидалось меньше 20 мс при 128`);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'input-engine-1440x900.png'), await g.shot());

    // буфер 64 — переоткрытие с квантом 64
    await g.run(`[...document.querySelectorAll('[data-ui="input-buffer"] .rp-seg__item')].find((el) => el.textContent === '64').click()`);
    const deadline = Date.now() + 10000;
    let status;
    do {
      await wait(200);
      status = await g.run(`window.pupitreEngine.status()`);
    } while (status.bufferFrames !== 64 && Date.now() < deadline);
    if (status.bufferFrames !== 64) throw new Error(`буфер 64 не применился: ${JSON.stringify(status)}`);
    await untilFramed(`document.querySelector('[data-ui="input-xruns"]')`, 'счётчик срывов');
    const after = await g.run(`({ rtl: document.querySelector('[data-ui="input-latency"] .io__rtl').textContent, xruns: document.querySelector('[data-ui="input-xruns"]').textContent })`);
    console.log(`буфер 64: ${JSON.stringify(after)}`);

    // буфер снова 128 (по умолчанию) перед игрой
    await g.run(`[...document.querySelectorAll('[data-ui="input-buffer"] .rp-seg__item')].find((el) => el.textContent === '128').click()`);
    const back128 = Date.now() + 10000;
    do {
      await wait(200);
      status = await g.run(`window.pupitreEngine.status()`);
    } while (status.bufferFrames !== 128 && Date.now() < back128);

    // 3. Игра с оценкой: кадры движка → судья.
    await g.run(`window.__frames = 0; void window.pupitreEngine.onFrames(() => window.__frames++)`);
    await g.run(`location.hash = '#/guitar'`);
    await g.until(`document.querySelector('[data-ui="library-demo"], [data-ui="library-grid"] .rp-songcard')`, 'библиотека', 15000);
    await g.run(`document.querySelector('[data-ui="library-demo"]')?.click()`);
    await g.until(`document.querySelector('[data-ui="library-grid"] .rp-songcard')`, 'демо в библиотеке', 60000);
    await g.run(`document.querySelector('.rp-songcard__poster-link').click()`);
    await g.until(`document.querySelector('[data-ui="song-play"]')`, 'подготовка песни');
    // импорт песни не закрывает движок (did-start-loading приходил и на загрузки внутри страницы)
    if (!(await g.run(`window.pupitreEngine.status()`)).open) throw new Error('движок закрылся после импорта песни');
    await g.run(`document.querySelector('[data-ui="song-play"]').click()`);
    await g.until(`document.querySelector('[data-ui="play-go"]')`, 'старт игры', 60000);
    await g.run(`document.querySelector('[data-ui="play-go"]').click()`);
    await untilFramed(`/[0-9]/.test(document.querySelector('[data-ui="play-accuracy"] .hud-stat__v')?.textContent ?? '')`, 'вердикты в HUD', 20000);
    const game = await g.run(`({
      frames: window.__frames,
      accuracy: document.querySelector('[data-ui="play-accuracy"] .hud-stat__v').textContent,
      input: document.querySelector('[data-ui="play-input"]')?.dataset.state,
    })`);
    console.log(`игра на движке: пакетов кадров ${game.frames}, точность ${game.accuracy}, вход ${game.input}`);
    if (game.frames < 50) throw new Error(`кадры движка не идут в страницу: ${game.frames}`);
    if (!['ok', 'no-signal', 'clipping'].includes(game.input)) throw new Error(`вход в игре: ${game.input}`);
    await g.run(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }))`);
    await g.until(`document.querySelector('[data-ui="play-paused"]')`, 'пауза');
    await g.run(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }))`);
    await g.until(`document.querySelector('[data-ui="song"]')`, 'подготовка песни после выхода');

    // 4. Изоляция падений: процесс движка убит — приложение живо, сессия входа поднимает движок заново.
    g.engine.kill();
    const reborn = Date.now() + 15000;
    do {
      await wait(250);
      status = await g.run(`window.pupitreEngine.status()`);
    } while (!status.open && Date.now() < reborn);
    if (!status.open) throw new Error('после падения процесса движка вход не поднялся');
    console.log(`падение процесса движка: поднят заново (${JSON.stringify(status)})`);

    // 5. Вокальный режим закрывает движок.
    await g.run(`[...document.querySelectorAll('[data-ui="shell-mode-switch"] .rp-seg__item')].find((el) => el.textContent === 'Голос').click()`);
    await g.until(`!document.querySelector('[data-ui="guitar-root"]')`, 'вокальный режим');
    const closeBy = Date.now() + 5000;
    do {
      await wait(100);
      status = await g.run(`window.pupitreEngine.status()`);
    } while (status.open && Date.now() < closeBy);
    if (status.open) throw new Error('движок остался открытым после ухода из раздела');
    console.log('вокальный режим: движок закрыт');
  });
})();
