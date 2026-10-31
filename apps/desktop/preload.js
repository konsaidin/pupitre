// Мост в рендерер: адрес встроенного бэкенда и события его развёртывания.
// Работает в песочнице — адрес приходит аргументом из main (additionalArguments).

const { contextBridge, ipcRenderer } = require('electron');

const apiArg = process.argv.find((a) => a.startsWith('--pupitre-api='));
const tokenArg = process.argv.find((a) => a.startsWith('--pupitre-api-token='));

contextBridge.exposeInMainWorld('desktop', {
  apiBase: apiArg ? apiArg.slice('--pupitre-api='.length) : 'http://127.0.0.1:8123',
  apiToken: tokenArg ? tokenArg.slice('--pupitre-api-token='.length) : '',
  ensureBackend: () => ipcRenderer.invoke('backend-ensure'),
  onBackendStatus(cb) {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on('backend-status', listener);
    ipcRenderer.send('backend-status-subscribe');
    return () => ipcRenderer.removeListener('backend-status', listener);
  },
  retrySetup() {
    ipcRenderer.send('backend-retry');
  },
});

// Ресурсы страницы, которые под file:// не достать fetch: саундфонт синт-минуса гитары и кит ударных (lib/soundFont.ts)
contextBridge.exposeInMainWorld('pupitreAssets', {
  soundFont: () => ipcRenderer.invoke('assets:soundfont'),
  drumKit: () => ipcRenderer.invoke('assets:drumkit'),
});

// нативный захват (этап 4): мост появляется только когда main загрузил аддон;
// рендерер по наличию window.nativeAudio выбирает бэкенд AudioInput
if (process.argv.includes('--pupitre-native-audio')) {
  contextBridge.exposeInMainWorld('nativeAudio', {
    listDevices: () => ipcRenderer.invoke('native-audio:list'),
    start: (opts) => ipcRenderer.invoke('native-audio:start', opts),
    stop: () => ipcRenderer.invoke('native-audio:stop'),
    setGate: (gateRms, gateClarity) => ipcRenderer.send('native-audio:gate', { gateRms, gateClarity }),
    onFrames(cb) {
      const listener = (_e, batch) => cb(batch);
      ipcRenderer.on('native-audio:frames', listener);
      return () => ipcRenderer.removeListener('native-audio:frames', listener);
    },
  });
}

// нативный звуковой движок (этап 41): мост появляется только когда main загрузил аддон packages/engine; рендерер по
// наличию window.pupitreEngine выбирает захват движка (иначе — браузер). Ошибки — без префикса IPC: код (NO_ENGINE,
// NOT_FOUND, FAILED) в начале сообщения.
if (process.argv.includes('--pupitre-engine')) {
  const invoke = (channel, ...args) =>
    ipcRenderer.invoke(channel, ...args).catch((e) => {
      throw new Error(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
    });
  contextBridge.exposeInMainWorld('pupitreEngine', {
    available: () => invoke('engine:available'),
    listDevices: () => invoke('engine:list'),
    open: (options) => invoke('engine:open', options),
    close: () => invoke('engine:close'),
    set: (options) => ipcRenderer.send('engine:set', options),
    measureRtl: (clicks) => invoke('engine:rtl', clicks),
    status: () => invoke('engine:status'),
    capabilities: () => invoke('engine:capabilities'),
    onMeters(cb) {
      const listener = (_e, meters) => cb(meters);
      ipcRenderer.on('engine:meters', listener);
      return () => ipcRenderer.removeListener('engine:meters', listener);
    },
    onEvent(cb) {
      const listener = (_e, event) => cb(event);
      ipcRenderer.on('engine:event', listener);
      return () => ipcRenderer.removeListener('engine:event', listener);
    },
    onFrames(cb) {
      const listener = (_e, frames) => cb(frames);
      ipcRenderer.on('engine:frames', listener);
      return () => ipcRenderer.removeListener('engine:frames', listener);
    },
    onAudio(cb) {
      const listener = (_e, audio) => cb(audio);
      ipcRenderer.on('engine:audio', listener);
      return () => ipcRenderer.removeListener('engine:audio', listener);
    },
  });
}
