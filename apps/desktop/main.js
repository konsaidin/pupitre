// Десктопный Pupitre: окно Chromium с фронтом + встроенный бэкенд.
// При первом запуске бэкенд сам докачивает Python-окружение и ffmpeg
// (см. backend.js) — приложение полноценно из одного установщика.

const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const { Backend, PORT } = require('./backend');
const { initNativeAudio } = require('./native-audio');

let backend = null;
let nativeAudioReady = false;
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
    show: false, // показываем уже развёрнутым — без прыжка размера
    backgroundColor: '#0a0a0d',
    autoHideMenuBar: true,
    title: 'Пюпитр',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [
        `--pupitre-api=http://127.0.0.1:${PORT}`,
        ...(nativeAudioReady ? ['--pupitre-native-audio'] : []),
      ],
    },
  });
  // как в браузере: на весь экран (обычное развёрнутое окно, не kiosk)
  win.maximize();
  win.show();
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

  nativeAudioReady = initNativeAudio(ipcMain, app.isPackaged, process.resourcesPath);

  ipcMain.on('backend-status-subscribe', (e) => {
    statusSubscribers.add(e.sender);
    e.sender.send('backend-status', lastStatus);
  });

  // повторить развёртывание после ошибки (сеть моргнула и т.п.) — без перезапуска
  ipcMain.on('backend-retry', () => {
    if (backend && lastStatus.stage === 'error') void backend.start();
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
