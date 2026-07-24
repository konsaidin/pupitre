// E2E нативного захвата (этап 4): скрытое окно Electron с реальными
// preload.js и native-audio.js — устройства → старт → кадры 2 с → задержка.
// Запуск: npx electron e2e/native-audio-main.js (из apps/desktop).
// Результат — строка E2E_RESULT {...} в stdout; код выхода 1 при провале.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { initNativeAudio } = require('../native-audio');

app.whenReady().then(() => {
  const ok = initNativeAudio(ipcMain, false, '');
  if (!ok) {
    console.error('E2E_FAIL: аддон не загрузился (собери packages/native-audio/build.mjs)');
    app.exit(1);
    return;
  }
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      additionalArguments: ['--pupitre-native-audio'],
    },
  });
  win.webContents.on('console-message', (_e, _level, message) => {
    if (message.startsWith('E2E_RESULT')) {
      console.log(message);
      const r = JSON.parse(message.slice('E2E_RESULT'.length));
      const pass = r.devices > 0 && r.framesPerSec > 100 && r.latencyMs < 25;
      console.log(pass ? 'E2E_PASS' : 'E2E_FAIL');
      app.exit(pass ? 0 : 1);
    }
    if (message.startsWith('E2E_ERROR')) {
      console.error(message);
      app.exit(1);
    }
  });
  win.loadFile(path.join(__dirname, 'native-audio-page.html'));
});

setTimeout(() => {
  console.error('E2E_FAIL: таймаут');
  app.exit(1);
}, 20000);
