// Десктопная обёртка Slopsician: окно Chromium с собранным фронтом.
// Микрофон и AudioWorklet работают как в браузере; бэкенд обработки песен —
// отдельный процесс (адрес настраивается в приложении, по умолчанию
// http://localhost:8000).

const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: '#08080f',
    autoHideMenuBar: true,
    title: 'Slopsician',
  });
  // внешние ссылки — в системный браузер, не в наше окно
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, 'dist-web', 'index.html'));
}

app.whenReady().then(() => {
  // единственное нужное разрешение — микрофон
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
