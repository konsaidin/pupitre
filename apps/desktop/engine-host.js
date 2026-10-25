// Процесс нативного движка (utilityProcess, 01-architecture §8.1 — перенос из главного процесса): аддон packages/engine
// живёт отдельно от главного процесса Electron. Своё окружение — PIPEWIRE_LATENCY (квант клиента JACK) меняется только
// здесь, вокальный захват главного процесса (cpal → ALSA-плагин PipeWire читает ту же переменную) её не видит. Падение
// pipewire-jack (например, при остановке PipeWire) роняет только этот процесс: главный увидит выход и поднимет его снова.
// Протокол с главным процессом: { id, method, args } → { id, ok, value | error }; метры, события и кадры —
// { kind: 'meters' | 'event' | 'frames', value }.

const port = process.parentPort;
let addon = null;
let loadError = '';
try {
  addon = require(process.argv[2]);
} catch (e) {
  loadError = `NO_ENGINE: аддон движка не загрузился: ${e.message}`;
}

if (addon) {
  addon.onMeters((value) => port.postMessage({ kind: 'meters', value }));
  addon.onEvent((value) => port.postMessage({ kind: 'event', value }));
  addon.onFrames((value) => port.postMessage({ kind: 'frames', value }));
}

const METHODS = new Set(['available', 'listDevices', 'open', 'close', 'status', 'measureRtl', 'set']);

port.on('message', async ({ data }) => {
  const { id, method, args } = data ?? {};
  try {
    if (!addon) throw new Error(loadError);
    if (!METHODS.has(method)) throw new Error(`FAILED: неизвестный вызов ${method}`);
    const value = await addon[method](...(Array.isArray(args) ? args : []));
    if (id !== undefined) port.postMessage({ id, ok: true, value });
  } catch (e) {
    if (id !== undefined) port.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
});
