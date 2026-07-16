// Нативный захват звука (этап 4): загрузка N-API-аддона packages/native-audio
// и IPC-мост кадров анализа в рендерер. Если аддона нет (не собран, чужая
// платформа) — мост не регистрируется, рендерер остаётся на AudioWorklet.

const path = require('node:path');

/** Ищет и грузит .node-аддон; null, если не найден/не загрузился. */
function loadAddon(isPackaged, resourcesPath) {
  const file = `slopsician-native-audio.${process.platform}-${process.arch}.node`;
  const candidates = isPackaged
    ? [path.join(resourcesPath, 'native', file)]
    : [path.join(__dirname, '..', '..', 'packages', 'native-audio', file)];
  for (const p of candidates) {
    try {
      return require(p);
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') console.warn('[native-audio] не загрузился', p, e.message);
    }
  }
  return null;
}

/**
 * Регистрирует IPC нативного захвата. Возвращает true, если аддон доступен —
 * main пробрасывает это в preload аргументом.
 */
function initNativeAudio(ipcMain, isPackaged, resourcesPath) {
  const addon = loadAddon(isPackaged, resourcesPath);
  if (!addon) return false;

  let consumer = null; // webContents, получающий кадры (окно одно)

  ipcMain.handle('native-audio:list', () => addon.listDevices());
  ipcMain.handle('native-audio:start', (e, opts) => {
    consumer = e.sender;
    consumer.once('destroyed', () => {
      if (consumer === e.sender) {
        addon.stop();
        consumer = null;
      }
    });
    return addon.start(opts.deviceId ?? null, opts.gateRms, opts.gateClarity, (batch) => {
      if (consumer && !consumer.isDestroyed()) consumer.send('native-audio:frames', batch);
    });
  });
  ipcMain.handle('native-audio:stop', () => {
    addon.stop();
    consumer = null;
  });
  ipcMain.on('native-audio:gate', (_e, { gateRms, gateClarity }) => addon.setGate(gateRms, gateClarity));
  return true;
}

module.exports = { initNativeAudio };
