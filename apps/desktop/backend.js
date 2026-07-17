// Развёртывание и запуск встроенного бэкенда обработки песен.
//
// При первом запуске в профиль пользователя (userData) докачиваются:
//   1) uv — менеджер Python-окружений (один статический бинарник);
//   2) сам Python 3.11 + виртуальное окружение с зависимостями
//      (fastapi/librosa/torch-cpu/demucs, ~2.5 ГБ);
//   3) ffmpeg (на Linux используется системный, если есть).
// Дальше приложение поднимает uvicorn на локальном порту и фронт работает
// с ним как с обычным сервером. Повторные запуски ничего не качают.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const PORT = 8123;
const UV_VERSION = '0.7.13';

const IS_WIN = process.platform === 'win32';

function urls() {
  if (IS_WIN) {
    return {
      uv: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`,
      ffmpeg: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    };
  }
  return {
    uv: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz`,
    ffmpeg: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
  };
}

async function download(url, dest, onProgress) {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} при скачивании ${url}`);
  const total = Number(resp.headers.get('content-length')) || 0;
  let done = 0;
  const counter = new (require('node:stream').Transform)({
    transform(chunk, _enc, cb) {
      done += chunk.length;
      if (total && onProgress) onProgress(Math.round((done / total) * 100));
      cb(null, chunk);
    },
  });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(resp.body), counter, fs.createWriteStream(dest));
}

async function extract(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (archive.endsWith('.zip')) {
    // чистый JS: системные распаковщики ненадёжны (wine, например, подсовывает
    // заглушку powershell.exe, которая «успешно» ничего не делает)
    await require('extract-zip')(archive, { dir: destDir });
  } else {
    // .tar.gz / .tar.xz — системный tar есть и на Linux, и на Windows 10+
    const r = spawnSync('tar', ['-xf', archive, '-C', destDir], { stdio: 'pipe' });
    if (r.status !== 0) throw new Error(`tar: ${String(r.stderr || r.error || r.status)}`);
  }
  if (fs.readdirSync(destDir).length === 0) {
    throw new Error(`архив ${path.basename(archive)} распаковался пустым`);
  }
}

/** Рекурсивный поиск бинарника в распакованном архиве. */
function findBin(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBin(p, name);
      if (found) return found;
    } else if (entry.name === name) {
      return p;
    }
  }
  return null;
}

class Backend {
  /**
   * @param {string} userData каталог профиля (app.getPath('userData'))
   * @param {string} apiDir каталог с кодом бэкенда (resources/api)
   * @param {(status: {stage: string, detail?: string, progress?: number}) => void} onStatus
   */
  constructor(userData, apiDir, onStatus) {
    this.root = path.join(userData, 'backend');
    this.apiDir = apiDir;
    this.onStatus = onStatus;
    this.proc = null;
    this.exitCode = null;
    this.exitTail = '';
    this.busy = false;
  }

  get port() {
    return PORT;
  }

  async ensureUv() {
    const uvBin = path.join(this.root, 'bin', IS_WIN ? 'uv.exe' : 'uv');
    if (fs.existsSync(uvBin)) return uvBin;
    this.onStatus({ stage: 'download-uv' });
    const archive = path.join(this.root, 'tmp', path.basename(urls().uv));
    await download(urls().uv, archive, (p) => this.onStatus({ stage: 'download-uv', progress: p }));
    const tmpDir = path.join(this.root, 'tmp', 'uv');
    await extract(archive, tmpDir);
    const found = findBin(tmpDir, IS_WIN ? 'uv.exe' : 'uv');
    if (!found) throw new Error('uv не найден в архиве');
    fs.mkdirSync(path.dirname(uvBin), { recursive: true });
    fs.copyFileSync(found, uvBin);
    if (!IS_WIN) fs.chmodSync(uvBin, 0o755);
    return uvBin;
  }

  async ensureFfmpeg() {
    // системный ffmpeg подходит (типично для Linux)
    if (spawnSync(IS_WIN ? 'where' : 'which', ['ffmpeg'], { stdio: 'ignore' }).status === 0) return null;
    const ffBin = path.join(this.root, 'bin', IS_WIN ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(ffBin)) return path.dirname(ffBin);
    fs.mkdirSync(path.dirname(ffBin), { recursive: true });
    this.onStatus({ stage: 'download-ffmpeg' });
    const archive = path.join(this.root, 'tmp', path.basename(urls().ffmpeg));
    await download(urls().ffmpeg, archive, (p) => this.onStatus({ stage: 'download-ffmpeg', progress: p }));
    const tmpDir = path.join(this.root, 'tmp', 'ffmpeg');
    await extract(archive, tmpDir);
    const found = findBin(tmpDir, IS_WIN ? 'ffmpeg.exe' : 'ffmpeg');
    if (!found) throw new Error('ffmpeg не найден в архиве');
    fs.copyFileSync(found, ffBin);
    if (!IS_WIN) fs.chmodSync(ffBin, 0o755);
    return path.dirname(ffBin);
  }

  runUv(uvBin, args, stage) {
    return new Promise((resolve, reject) => {
      const p = spawn(uvBin, args, {
        windowsHide: true,
        env: {
          ...process.env,
          UV_PYTHON_INSTALL_DIR: path.join(this.root, 'python'),
          // Свой Python, а не найденный в системе: на Windows в PATH обычно
          // висит заглушка из Microsoft Store, которая не годится под venv.
          UV_PYTHON_PREFERENCE: 'only-managed',
        },
      });
      let tail = '';
      const onData = (buf) => {
        const line = buf.toString().trim().split('\n').pop() ?? '';
        if (line) {
          tail = line.slice(0, 160);
          this.onStatus({ stage, detail: tail });
        }
      };
      p.stdout.on('data', onData);
      p.stderr.on('data', onData);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`uv ${args[0]} завершился с кодом ${code}: ${tail}`))));
      p.on('error', reject);
    });
  }

  async ensureEnv(uvBin) {
    const venv = path.join(this.root, 'venv');
    const marker = path.join(this.root, 'deps-ok');
    const pythonBin = IS_WIN ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
    if (fs.existsSync(marker) && fs.existsSync(pythonBin)) return pythonBin;

    this.onStatus({ stage: 'install-python' });
    await this.runUv(uvBin, ['venv', '--python', '3.11', venv], 'install-python');

    this.onStatus({ stage: 'install-deps' });
    await this.runUv(
      uvBin,
      ['pip', 'install', '--python', pythonBin,
        '-r', path.join(this.apiDir, 'requirements.txt'),
        '--extra-index-url', 'https://download.pytorch.org/whl/cpu',
        '--index-strategy', 'unsafe-best-match'],
      'install-deps',
    );
    fs.writeFileSync(marker, new Date().toISOString());
    return pythonBin;
  }

  // Первый старт долгий: uvicorn импортирует torch/demucs/librosa, на холодном
  // диске это заметно больше полуминуты, а на Windows Defender ещё и сканирует
  // каждую DLL torch при первом импорте — закладываем 5 минут.
  async waitHealthy(timeoutMs = 300000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.exitCode != null) throw new Error(`uvicorn упал с кодом ${this.exitCode}: ${this.exitTail}`);
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (r.ok) return;
      } catch {
        // ещё поднимается
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('бэкенд не ответил на /api/health');
  }

  async start() {
    // повторный вызов (ретрай из UI), пока идёт развёртывание — игнорируем
    if (this.busy) return;
    this.busy = true;
    try {
      // уже кем-то запущен (например, dev-uvicorn) — просто используем
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (r.ok) {
          this.onStatus({ stage: 'ready' });
          return;
        }
      } catch {
        // порт свободен — разворачиваем свой
      }

      const uvBin = await this.ensureUv();
      const pythonBin = await this.ensureEnv(uvBin);
      const ffDir = await this.ensureFfmpeg();

      this.onStatus({ stage: 'starting' });
      const env = {
        ...process.env,
        SLOPSICIAN_DATA: path.join(this.root, 'data'),
        // resources/api и каталог portable-exe могут быть только для чтения —
        // __pycache__ туда не пишем
        PYTHONDONTWRITEBYTECODE: '1',
      };
      if (ffDir) {
        // На Windows переменная называется Path; добавив второй ключ PATH,
        // мы бы отдали дочернему процессу два разных значения одной переменной.
        const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
        env[key] = ffDir + path.delimiter + (env[key] ?? '');
      }
      this.exitCode = null;
      this.exitTail = '';
      this.proc = spawn(pythonBin, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], {
        cwd: this.apiDir,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.proc.stderr.on('data', (b) => {
        const s = b.toString().trim();
        this.exitTail = s.slice(-300);
        console.log('[api]', s);
      });
      this.proc.on('close', (code) => {
        this.proc = null;
        if (code !== null && code !== 0) {
          this.exitCode = code;
          this.onStatus({ stage: 'error', detail: `uvicorn exited ${code}: ${this.exitTail}` });
        }
      });
      // без обработчика ошибка спауна (нет python.exe, битое окружение) роняет
      // main-процесс; с ним — waitHealthy падает сразу с внятным текстом
      this.proc.on('error', (err) => {
        this.proc = null;
        this.exitCode = -1;
        this.exitTail = String(err.message || err);
      });
      await this.waitHealthy();
      this.onStatus({ stage: 'ready' });
      fs.rmSync(path.join(this.root, 'tmp'), { recursive: true, force: true });
    } catch (e) {
      this.onStatus({ stage: 'error', detail: String(e && e.message ? e.message : e).slice(0, 300) });
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
  }
}

module.exports = { Backend, PORT };
