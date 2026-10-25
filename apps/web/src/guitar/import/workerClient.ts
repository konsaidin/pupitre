// Клиент воркера разбора: id запросов, передача байтов без копии, таймаут операции 30 с (зависший разбор не прервать
// изнутри — воркер завершается и создаётся заново при следующем запросе), падение воркера — ошибка всем ожидающим.
import { t } from '../../lib/i18n';
import { ImportError, SCORE_CMD, type ImportErrorCode, type ParseRequest, type ParseResult, type RenderRequest, type RenderResult } from './protocol';

export const OP_TIMEOUT_MS = 30_000;

export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (e: Event) => void): void;
  terminate(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ScoreClient {
  parse(req: ParseRequest): Promise<ParseResult>;
  render(req: RenderRequest): Promise<RenderResult>;
  dispose(): void;
}

/** make — фабрика воркера (в приложении — ?worker&inline, в тестах — подделка). */
export function createScoreClient(make: () => WorkerLike, timeoutMs = OP_TIMEOUT_MS): ScoreClient {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (error: ImportError) => {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(id);
      p.reject(error);
    }
  };
  const reset = () => {
    worker?.terminate();
    worker = null;
  };
  const ensure = (): WorkerLike => {
    if (worker) return worker;
    const w = make();
    w.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as { id?: unknown; ok?: boolean; result?: unknown; error?: { code: ImportErrorCode; message: string } } | null;
      if (!msg || typeof msg.id !== 'number') return;
      const p = pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new ImportError(msg.error?.code ?? 'worker-failed', msg.error?.message ?? 'ошибка воркера'));
    });
    w.addEventListener('error', () => {
      reset();
      failAll(new ImportError('worker-failed', 'воркер разбора упал'));
    });
    worker = w;
    return w;
  };

  const call = <T>(op: string, payload: unknown, transfer: Transferable[], limitMs = timeoutMs) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new ImportError('timeout', `операция ${op} дольше ${limitMs} мс`));
        // Зависший воркер не освободится сам: заменяем, остальным ожидающим — та же беда.
        reset();
        failAll(new ImportError('worker-failed', 'воркер разбора перезапущен после таймаута'));
      }, limitMs);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ensure().postMessage({ cmd: SCORE_CMD, id, op, payload }, transfer);
    });

  return {
    parse: (req) => call<ParseResult>('parse', req, req.bytes ? [req.bytes.buffer] : []),
    // Рендер минуса длинной песни — дольше разбора: свой предел, вчетверо больше.
    render: (req) => call<RenderResult>('render', req, [req.bytes.buffer], timeoutMs * 4),
    dispose: () => {
      reset();
      failAll(new ImportError('worker-failed', 'клиент закрыт'));
    },
  };
}

/** Текст ошибки импорта для пользователя (окно импорта, этап 12b). Не ошибка разбора — своим текстом. */
export function importErrorText(error: unknown): string {
  if (!(error instanceof ImportError)) {
    if ((error as { name?: string })?.name === 'QuotaExceededError') return t('Not enough space on this computer to store the song');
    return `${t('Something went wrong')}: ${(error as Error)?.message ?? String(error)}`;
  }
  switch (error.code) {
    case 'too-large':
      return t('The file is larger than 20 MB');
    case 'zip-too-large':
      return t('The archive is too large or suspicious');
    case 'unknown-format':
      return t('Not a Guitar Pro or MusicXML file');
    case 'midi-not-yet':
      return t('MIDI files will be supported later');
    case 'no-arrangements':
      return t('The file has no parts with strings');
    case 'timeout':
    case 'damaged':
    case 'parse-failed':
    case 'worker-failed':
      return t('The file is too complex or damaged');
  }
}
