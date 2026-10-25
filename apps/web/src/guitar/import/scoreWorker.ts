// Воркер разбора партитур (?worker&inline — под file:// воркер из блоба, инв. 20). alphaTab при импорте внутри
// воркера ставит свои обработчики сообщений (alphaTab.mjs → Environment.initializeWorker): они отвечают только на
// сообщения со своим cmd; наш протокол — { cmd: SCORE_CMD, id, op, payload } (без cmd обработчик alphaSynth падает),
// чужие сообщения пропускаются.
import { SCORE_CMD } from './protocol';
import { handleRequest, ImportError, transferablesOf } from './scoreWorkerHandlers';

interface WorkerScope {
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.addEventListener('message', async (e) => {
  const msg = e.data as { cmd?: unknown; id?: unknown; op?: unknown; payload?: unknown } | null;
  if (msg?.cmd !== SCORE_CMD || typeof msg.id !== 'number' || typeof msg.op !== 'string') return;
  try {
    const result = await handleRequest(msg.op, msg.payload);
    scope.postMessage({ cmd: SCORE_CMD, id: msg.id, ok: true, result }, transferablesOf(result));
  } catch (error) {
    const code = error instanceof ImportError ? error.code : 'parse-failed';
    scope.postMessage({ cmd: SCORE_CMD, id: msg.id, ok: false, error: { code, message: String((error as Error)?.message ?? error) } }, []);
  }
});
