// Десктопный Slopsician: окно Chromium с фронтом + встроенный бэкенд.
// При первом запуске бэкенд сам докачивает Python-окружение и ffmpeg
// (см. backend.js) — приложение полноценно из одного установщика.

const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const { Backend, PORT } = require('./backend');

let backend = null;
let lastStatus = { stage: 'starting' };
const statusSubscribers = new Set();

function broadcastStatus(status) {
  lastStatus = status;
  for (const wc of statusSubscribers) {
    if (!wc.isDestroyed()) wc.send('backend-status', status);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: '#08080f',
    autoHideMenuBar: true,
    title: 'Slopsician',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--slopsician-api=http://127.0.0.1:${PORT}`],
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, 'dist-web', 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  ipcMain.on('backend-status-subscribe', (e) => {
    statusSubscribers.add(e.sender);
    e.sender.send('backend-status', lastStatus);
  });

  // код бэкенда: в собранном приложении лежит в resources/api,
  // при разработке — из репозитория
  const apiDir = app.isPackaged
    ? path.join(process.resourcesPath, 'api')
    : path.join(__dirname, '..', '..', 'services', 'api');
  backend = new Backend(app.getPath('userData'), apiDir, broadcastStatus);
  void backend.start();

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('quit', () => backend?.stop());
