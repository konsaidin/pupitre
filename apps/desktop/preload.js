// Мост в рендерер: адрес встроенного бэкенда и события его развёртывания.
// Работает в песочнице — адрес приходит аргументом из main (additionalArguments).

const { contextBridge, ipcRenderer } = require('electron');

const apiArg = process.argv.find((a) => a.startsWith('--slopsician-api='));

contextBridge.exposeInMainWorld('desktop', {
  apiBase: apiArg ? apiArg.slice('--slopsician-api='.length) : 'http://127.0.0.1:8123',
  onBackendStatus(cb) {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on('backend-status', listener);
    ipcRenderer.send('backend-status-subscribe');
    return () => ipcRenderer.removeListener('backend-status', listener);
  },
});

// нативный захват (этап 4): мост появляется только когда main загрузил аддон;
// рендерер по наличию window.nativeAudio выбирает бэкенд AudioInput
if (process.argv.includes('--slopsician-native-audio')) {
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
