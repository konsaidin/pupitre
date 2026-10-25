// ELECTRON: «Вход и звук» на поддельном захвате Chromium из своего WAV (file://, production-сборка): слева синус 220 Гц
// −12 dBFS, справа тишина. Доступ и выбор устройства — вход открыт, выбор в настройках; шкала показывает точный пик
// по каналу: «Оба» — −18 (сведение (L + R) / 2), «Вход 1» — −12, «Вход 2» — тишина; оценка задержки есть (Chromium
// сообщает задержку входа); перезагрузка — выбранный вход открывается сам, мини-уровень пилюли живой; снимок — в отчёт.
// 0 ошибок консоли.
// Запуск: node apps/desktop/e2e/run-electron.mjs apps/desktop/e2e/guitar-input-main.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { guitarApp } = require('./lib/guitar-app');

const OUT = path.join(os.homedir(), '.cache/pupitre/e2e/electron');
const TONE = path.join(OUT, 'fake-input-220hz-left.wav');
const OPEN = `['ok', 'no-signal', 'clipping'].includes(document.querySelector('[data-ui="shell-input-pill"]')?.dataset.state)`;
const PEAK = `document.querySelector('[data-ui="input-peak"]')?.textContent`;
const BAR = `Number(document.querySelector('[data-ui="input-meter"] .rp-meter')?.style.getPropertyValue('--v'))`;

// Стерео-WAV 16 бит 48 кГц: 2 с — целое число периодов 220 Гц, петля без щелчка.
function writeTone(file) {
  const rate = 48000;
  const frames = rate * 2;
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(0.25 * 32767 * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 4);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

// Поддельный захват из файла и автоответ на запрос доступа — до готовности приложения.
writeTone(TONE);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', TONE);
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

(async () => {
  const g = await guitarApp({ timeoutMs: 90000 });
  // Скрытое окно само почти не крутит кадры анимации (шкалы обновляются по ним): каждый опрос — перерисовка и кадр.
  const untilFramed = async (js, what, ms = 20000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      g.win.webContents.invalidate();
      if (await g.run(`new Promise((resolve) => requestAnimationFrame(() => resolve(Boolean(${js}))))`)) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Не дождались: ${what} (пик «${await g.run(PEAK)}», --v ${await g.run(BAR)})`);
  };
  const channel = (label) =>
    g.run(`[...document.querySelectorAll('[data-ui="input-channel"] .rp-seg__item')].find((el) => el.textContent === ${JSON.stringify(label)}).click()`);

  await g.scenario(async () => {
    await g.run(`localStorage.setItem('pupitre.lang.v1', 'ru'); localStorage.setItem('pupitre.profile.v1', '{}'); location.reload()`);
    await g.until(`document.querySelector('.screen.home')`, 'вокальная главная');
    await g.run(`location.hash = '#/guitar/input'`);
    await g.until(`document.querySelector('[data-ui="input-allow"], [data-ui="input-devices"]')`, 'карточка входа');
    const how = await g.run(`(() => {
      const allow = document.querySelector('[data-ui="input-allow"]');
      (allow ?? document.querySelector('[data-ui="input-devices"] .io__device')).click();
      return allow ? 'кнопка «Разрешить доступ»' : 'выбор из списка';
    })()`);
    console.log(`доступ: ${how}`);
    await g.until(OPEN, 'вход открыт', 15000);
    await g.until(`document.querySelector('[data-ui="input-devices"] .io__device[aria-checked="true"]')`, 'выбранное устройство в списке');

    // Каналы: смесь по умолчанию, затем левый и правый.
    await untilFramed(`${PEAK} === 'пик −18 дБFS'`, '«Оба»: пик −18 дБFS');
    await channel('Вход 1');
    await untilFramed(`${PEAK} === 'пик −12 дБFS'`, '«Вход 1»: пик −12 дБFS');
    await channel('Вход 2');
    await untilFramed(`${BAR} < 0.05`, '«Вход 2»: тишина');
    await channel('Оба');
    await untilFramed(`${PEAK} === 'пик −18 дБFS'`, 'снова «Оба»: пик −18 дБFS');
    console.log('каналы: «Оба» −18, «Вход 1» −12, «Вход 2» тишина');

    const state = await g.run(`({
      protocol: location.protocol,
      devices: [...document.querySelectorAll('[data-ui="input-devices"] .io__device')].map((el) => el.textContent + (el.getAttribute('aria-checked') === 'true' ? ' ✓' : '')),
      hint: document.querySelector('.rp-field__hint')?.textContent,
      rtl: document.querySelector('[data-ui="input-latency"] .io__rtl').textContent,
      advice: document.querySelector('[data-ui="input-advice"]').dataset.advice,
      saved: JSON.parse(localStorage.getItem('pupitre.guitar.v1')).input,
    })`);
    console.log(`ELECTRON ${process.versions.electron}: ${JSON.stringify(state)}`);
    if (state.protocol !== 'file:') throw new Error(`Протокол ${state.protocol}, ожидался file:`);
    if (!state.saved.deviceId || !state.saved.deviceLabel) throw new Error('Выбор устройства не записан в настройки');
    if (state.saved.channel !== -1) throw new Error(`Канал в настройках ${state.saved.channel}, ожидалась смесь`);
    if (state.advice !== 'good') throw new Error(`Совет по уровню ${state.advice} при пике −18 дБFS`);
    if (!/^≈ \d+,\d мс$/.test(state.rtl)) throw new Error(`Нет оценки задержки: ${state.rtl}`);
    fs.writeFileSync(path.join(OUT, 'input-1440x900.png'), await g.shot());

    await g.run(`location.hash = '#/guitar'; location.reload()`);
    await g.until(`document.querySelector('[data-ui="shell-input-pill"]')`, 'оболочка после перезагрузки', 15000);
    await g.until(OPEN, 'выбранный вход открылся сам', 15000);
    await untilFramed(`document.querySelectorAll('[data-ui="shell-input-pill"] .rp-mini-meter i.on').length === 3`, 'мини-уровень пилюли: при −18 дБFS — 3 деления из 5');
    console.log(`после перезагрузки: ${await g.run(`document.querySelector('[data-ui="shell-input-pill"]').dataset.state`)}`);
  });
})();
