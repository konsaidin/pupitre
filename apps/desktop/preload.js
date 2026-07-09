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
