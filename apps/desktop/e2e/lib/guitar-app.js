// Запускать из Electron, до app.whenReady(): профиль всегда временный.
// Строгий журнал: ошибка консоли (level ≥ 3) проваливает сценарий, кроме явно разрешённых сообщений allow
// ({ match: строка|RegExp, why }); предупреждения (level 2) только печатаются.
// Каталог веба — webDir, иначе PUPITRE_WEB_DIR (так его передаёт run-electron.mjs), иначе dist-web пакета.
// engine — нативный движок как в приложении: IPC из apps/desktop/engine.js и флаг --pupitre-engine для preload.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function guitarApp({ scaleFactor = 1, width = 1440, height = 900, timeoutMs = 30000, webDir, allow = [], engine = false } = {}) {
  if (app.isReady()) throw new Error('guitarApp нужно вызвать до app.whenReady()');
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) throw new Error('Некорректный scaleFactor');
  for (const a of allow) if (!a || !a.match || !a.why) throw new Error('Разрешённое сообщение требует match и why');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pupitre-guitar-'));
  app.setPath('userData', userData);
  app.commandLine.appendSwitch('force-device-scale-factor', String(scaleFactor));
  const dir = webDir ?? process.env.PUPITRE_WEB_DIR ?? path.join(__dirname, '../../dist-web');
  const errors = [];
  const warnings = [];
  let finished = false;
  const allowed = message => allow.find(a => (typeof a.match === 'string' ? message.includes(a.match) : a.match.test(message)));
  const finish = error => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    // Ошибка консоли, не попавшая в allow, проваливает даже сценарий без исключения.
    const unexpected = errors.filter(message => !allowed(message));
    const failure = error ?? (unexpected.length ? new Error(`Ошибки консоли (${unexpected.length}): ${unexpected.join(' | ')}`) : null);
    for (const message of errors) {
      const a = allowed(message);
      console.error(a ? `ALLOWED (${a.why}): ${message}` : `ERROR: ${message}`);
    }
    for (const message of warnings) console.error(`WARN: ${message}`);
    console.log(failure ? `E2E_FAIL: ${String(failure.message ?? failure).replaceAll('\n', ' ')}` : 'E2E_PASS');
    app.exit(failure ? 1 : 0);
  };
  const timer = setTimeout(() => finish(new Error('Таймаут Electron-сценария')), timeoutMs);
  try {
    await app.whenReady();
    require('../../assets').initAssets(require('electron').ipcMain);
    const addon = engine ? require('../../engine').initEngine(require('electron').ipcMain, false, '') : null;
    if (engine && !addon) throw new Error('аддона движка нет — node packages/engine/build.mjs');
    const win = new BrowserWindow({ show: false, width, height, useContentSize: true,
      // Скрытое окно иначе не перерисовывается, и capturePage отдаёт старый кадр.
      webPreferences: { preload: path.join(__dirname, '../../preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
        additionalArguments: addon ? ['--pupitre-engine'] : [] },
    });
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) errors.push(message);
      else if (level === 2) warnings.push(message);
    });
    win.webContents.on('render-process-gone', (_event, details) => finish(new Error(details.reason)));
    await win.loadFile(path.join(dir, 'index.html'));
    // Ждёт, пока выражение в странице станет истинным (опрос, без sleep в сценарии).
    const until = async (js, what, ms = 10000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (await win.webContents.executeJavaScript(`Boolean(${js})`)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Не дождались: ${what}`);
    };
    // Снимок текущего кадра: перерисовка и два кадра rAF до capturePage.
    const shot = async () => {
      win.webContents.invalidate();
      await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      return (await win.webContents.capturePage()).toPNG();
    };
    return { win, userData, dir, errors, engine: addon, run: js => win.webContents.executeJavaScript(js), until, shot,
      pass: () => finish(), fail: finish,
      // Исключение сценария становится E2E_FAIL; ошибки консоли — тоже (см. finish).
      scenario: async callback => { try { await callback(); finish(); } catch (error) { finish(error); } },
    };
  } catch (error) { finish(error); throw error; }
}

module.exports = { guitarApp };
