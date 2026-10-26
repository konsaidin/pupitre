// Ресурсы страницы, которые под file:// не достать fetch: саундфонт синт-минуса гитары (MuseScore General, ≈ 40 МБ,
// лежит в asar рядом со страницей). Нет файла — null, страница остаётся на встроенном SONiVOX (apps/web/src/lib/soundFont.ts).
const fs = require('node:fs');
const path = require('node:path');

function initAssets(ipcMain) {
  ipcMain.handle('assets:soundfont', () =>
    fs.promises.readFile(path.join(__dirname, 'dist-web', 'soundfonts', 'MuseScore_General.sf3')).then((b) => new Uint8Array(b), () => null),
  );
}

module.exports = { initAssets };
