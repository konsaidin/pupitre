// Ресурсы страницы, которые под file:// не достать fetch: саундфонт синт-минуса гитары (MuseScore General, ≈ 40 МБ) и
// кит ударных (AVL Black Pearl, ≈ 19 МБ) — лежат в asar рядом со страницей. Нет файла — null, страница остаётся на
// встроенном SONiVOX и ударных саундфонта (apps/web/src/lib/soundFont.ts).
const fs = require('node:fs');
const path = require('node:path');

const read = (name) =>
  fs.promises.readFile(path.join(__dirname, 'dist-web', 'soundfonts', name)).then((b) => new Uint8Array(b), () => null);

function initAssets(ipcMain) {
  ipcMain.handle('assets:soundfont', () => read('MuseScore_General.sf3'));
  ipcMain.handle('assets:drumkit', () => read('Black_Pearl_4_LV2.sf2'));
}

module.exports = { initAssets };
