// Нативный звуковой движок (этап 41): аддон packages/engine в отдельном процессе (engine-host.js, utilityProcess) и
// IPC-мост в рендерер. Аддона нет (не собран, чужая платформа) — мост не регистрируется, рендерер остаётся на захвате
// браузера. Процесс движка поднимается при первом вызове и заново после выхода (падение pipewire-jack, остановка
// PipeWire): рендерер получает событие shutdown, сессия входа делает пробу — открытие поднимает процесс снова.
// Метры, события и кадры уходят окну, открывшему движок; окно закрылось, рендерер упал или страница сменила документ
// (перезагрузка) — движок закрывается (мониторинг себя не должен звучать без интерфейса, 01-architecture §8.9).

const path = require('node:path');
const fs = require('node:fs');
const { utilityProcess } = require('electron');

/** Путь к .node-аддону или null (не собран, чужая платформа). */
function addonPath(isPackaged, resourcesPath) {
  const file = `pupitre-engine.${process.platform}-${process.arch}.node`;
  const candidates = isPackaged
    ? [path.join(resourcesPath, 'engine', file)]
    : [path.join(__dirname, '..', '..', 'packages', 'engine', file)];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

// null из рендерера → undefined: N-API принимает необязательную строку только как undefined
const opt = (value) => (value === null ? undefined : value);
const finite = (value, lo, hi, fallback) => (Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback);
const channelOf = (value) => (Number.isInteger(value) && value >= -1 && value <= 1 ? value : -1);
const nameOf = (value) => (typeof value === 'string' && value.length > 0 && value.length < 512 ? value : undefined);

/**
 * Регистрирует IPC движка. Возвращает { close } (main закрывает движок при выходе) или null — тогда main не передаёт
 * preload флаг --pupitre-engine.
 */
function initEngine(ipcMain, isPackaged, resourcesPath) {
  const file = addonPath(isPackaged, resourcesPath);
  if (!file) return null;

  let child = null;
  let nextId = 1;
  const pending = new Map();
  let consumer = null; // webContents, получающий метры (окно одно)
  const adopted = new WeakSet();
  const send = (channel, payload) => {
    if (consumer && !consumer.isDestroyed()) consumer.send(channel, payload);
  };

  const spawn = () => {
    if (child) return child;
    // квант клиента JACK — переменная есть с запуска процесса движка (там движок только меняет её значение)
    const env = { ...process.env, PIPEWIRE_LATENCY: process.env.PIPEWIRE_LATENCY || '128/48000' };
    const proc = utilityProcess.fork(path.join(__dirname, 'engine-host.js'), [file], { serviceName: 'Pupitre audio engine', env });
    proc.on('message', (msg) => {
      if (msg?.kind === 'meters') send('engine:meters', msg.value);
      else if (msg?.kind === 'event') send('engine:event', msg.value);
      else if (msg?.kind === 'frames') send('engine:frames', msg.value);
      else if (msg?.id !== undefined) {
        const call = pending.get(msg.id);
        pending.delete(msg.id);
        if (call) msg.ok ? call.resolve(msg.value) : call.reject(new Error(msg.error));
      }
    });
    proc.on('exit', (code) => {
      if (child === proc) child = null;
      for (const call of pending.values()) call.reject(new Error(`FAILED: процесс движка завершился (${code})`));
      pending.clear();
      if (code !== 0) send('engine:event', { kind: 'shutdown', reason: `процесс движка завершился (${code})` });
    });
    child = proc;
    return proc;
  };

  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      spawn().postMessage({ id, method, args });
    });

  const close = () => (child ? call('close').catch(() => {}) : Promise.resolve());

  const adopt = (sender) => {
    consumer = sender;
    if (adopted.has(sender)) return;
    adopted.add(sender);
    const release = () => {
      if (consumer !== sender) return;
      consumer = null;
      void close();
    };
    sender.once('destroyed', release);
    sender.on('render-process-gone', release);
    // Только смена документа главного фрейма (перезагрузка, переход): did-start-loading приходит и на загрузки внутри
    // страницы (воркер импорта песни) — движок закрывался молча. Переходы по # — тот же документ.
    sender.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
      const main = details?.isMainFrame ?? isMainFrame;
      const sameDocument = details?.isSameDocument ?? isInPlace;
      if (main && !sameDocument) release();
    });
  };

  // параметры процессора — плоские пары «номер, значение» (packages/dsp/src/tone.rs), не больше 32 пар
  const toneOf = (t) =>
    Array.isArray(t) && t.length % 2 === 0 && t.length <= 64 && t.every((v) => typeof v === 'number' && Number.isFinite(v)) ? t : undefined;

  ipcMain.handle('engine:available', () => call('available'));
  ipcMain.handle('engine:list', () => call('listDevices'));
  ipcMain.handle('engine:open', (e, o) => {
    adopt(e.sender);
    return call('open', {
      capture: nameOf(opt(o?.capture)),
      playback: nameOf(opt(o?.playback)),
      channel: channelOf(o?.channel),
      bufferFrames: [64, 128, 256, 512].includes(o?.bufferFrames) ? o.bufferFrames : 128,
      // громкость себя — не выше 0 дБ
      monitorGain: finite(o?.monitorGain, 0, 1, 0),
      mute: o?.mute === true,
      loopback: o?.loopback === true,
      tone: toneOf(o?.tone),
    });
  });
  ipcMain.handle('engine:close', () => close());
  ipcMain.on('engine:set', (_e, o) => {
    if (!o || typeof o !== 'object' || !child) return;
    void call('set', {
      channel: o.channel === undefined ? undefined : channelOf(o.channel),
      monitorGain: o.monitorGain === undefined ? undefined : finite(o.monitorGain, 0, 1, 0),
      mute: typeof o.mute === 'boolean' ? o.mute : undefined,
      tone: toneOf(o.tone),
    }).catch(() => {});
  });
  ipcMain.handle('engine:rtl', (_e, clicks) => call('measureRtl', finite(clicks, 1, 32, 8)));
  ipcMain.handle('engine:status', () => (child ? call('status') : { open: false, bufferFrames: 0, captureId: '' }));
  return {
    close: () => close().then(() => child?.kill()),
    /** Убить процесс движка (проверка изоляции падений в e2e). */
    kill: () => child?.kill(),
  };
}

module.exports = { initEngine };
