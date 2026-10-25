// Операции воркера (node) и клиент воркера на подделке: разбор GP-байтов и alphaTex, коды ошибок, клонируемость ответа;
// таймаут 30 с → ошибка и замена воркера; падение воркера — ошибка всем ожидающим; чужие сообщения (alphaTab cmd)
// не мешают.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gp7Bytes } from './fixtures';
import { handleParse, handleRequest, ImportError, transferablesOf } from './scoreWorkerHandlers';
import { createScoreClient, importErrorText, type WorkerLike } from './workerClient';

describe('handleParse', () => {
  it('GP-байты → песня; ответ клонируется; байты оригинала отдаются без копии', async () => {
    const bytes = gp7Bytes('techniques');
    const r = await handleParse({ bytes, name: 'techniques.gp' });
    expect(r.format).toBe('gp8');
    expect(r.songId).toBe(r.fileSha256.slice(0, 16));
    expect(r.arrangements).toHaveLength(1);
    expect(structuredClone(r)).toEqual(r);
    expect(transferablesOf(r)).toEqual([r.score.buffer]);
  });

  it('alphaTex демо-песни → GP7 → тот же путь', async () => {
    const r = await handleParse({ alphaTex: '\\title "Demo"\n\\track "G"\n\\staff {tabs}\n0.6.4 3.6.4', name: 'demo' });
    expect([r.title, r.format, r.arrangements[0].events.length]).toEqual(['Demo', 'gp8', 2]);
  });

  it('коды ошибок: не партитура, MIDI, без струнных партий, неизвестная операция', async () => {
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: ImportError) => e.code);
    expect(await code(handleParse({ bytes: new TextEncoder().encode('<html/>') as Uint8Array<ArrayBuffer>, name: 'x' }))).toBe('unknown-format');
    expect(await code(handleParse({ bytes: new TextEncoder().encode('MThd\0\0\0\x06') as Uint8Array<ArrayBuffer>, name: 'x' }))).toBe('midi-not-yet');
    expect(await code(handleParse({ alphaTex: '\\track "Piano"\n\\staff {score}\n\\instrument 0\nC4.4 D4.4 E4.4 F4.4', name: 'x' }))).toBe('no-arrangements');
    expect(await code(handleRequest('digest', {}))).toBe('worker-failed');
  });
});

// Подделка воркера: обработчик сообщений и ручное управление ответами.
function fakeWorker(respond: (msg: { id: number; op: string; payload: unknown }, w: FakeWorker) => void) {
  const made: FakeWorker[] = [];
  const make = () => {
    const w = new FakeWorker(respond);
    made.push(w);
    return w;
  };
  return { made, make };
}
class FakeWorker implements WorkerLike {
  listeners: { message: ((e: MessageEvent) => void)[]; error: ((e: Event) => void)[] } = { message: [], error: [] };
  terminated = false;
  constructor(private respond: (msg: { id: number; op: string; payload: unknown }, w: FakeWorker) => void) {}
  addEventListener(type: 'message' | 'error', listener: (e: never) => void) {
    this.listeners[type].push(listener as never);
  }
  postMessage(message: unknown) {
    queueMicrotask(() => this.respond(message as { id: number; op: string; payload: unknown }, this));
  }
  emit(data: unknown) {
    for (const l of this.listeners.message) l({ data } as MessageEvent);
  }
  crash() {
    for (const l of this.listeners.error) l(new Event('error'));
  }
  terminate() {
    this.terminated = true;
  }
}

describe('createScoreClient', () => {
  afterEach(() => vi.useRealTimers());

  it('ответ по id; чужие сообщения alphaTab игнорируются', async () => {
    const { make } = fakeWorker((msg, w) => {
      w.emit({ cmd: 'alphaSynth.ready' });
      w.emit({ id: msg.id, ok: true, result: { echo: msg.payload } });
    });
    const client = createScoreClient(make);
    await expect(client.parse({ name: 'a' })).resolves.toEqual({ echo: { name: 'a' } });
  });

  it('ошибка воркера приходит как ImportError с кодом', async () => {
    const { make } = fakeWorker((msg, w) => w.emit({ id: msg.id, ok: false, error: { code: 'zip-too-large', message: 'много' } }));
    await expect(createScoreClient(make).parse({ name: 'a' })).rejects.toMatchObject({ code: 'zip-too-large' });
  });

  it('таймаут: запрос отвергнут, воркер завершён, следующий запрос — в новом воркере', async () => {
    vi.useFakeTimers();
    let answer = false;
    const { made, make } = fakeWorker((msg, w) => answer && w.emit({ id: msg.id, ok: true, result: 'ok' }));
    const client = createScoreClient(make, 30_000);
    const stuck = client.parse({ name: 'slow' });
    const check = expect(stuck).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_001);
    await check;
    expect(made[0].terminated).toBe(true);
    answer = true;
    const next = client.parse({ name: 'fast' });
    await vi.advanceTimersByTimeAsync(1);
    await expect(next).resolves.toBe('ok');
    expect(made).toHaveLength(2);
  });

  it('падение воркера — ошибка всем ожидающим', async () => {
    const { made, make } = fakeWorker(() => {});
    const client = createScoreClient(make);
    const a = client.parse({ name: 'a' });
    const b = client.parse({ name: 'b' });
    await Promise.resolve();
    made[0].crash();
    await expect(a).rejects.toMatchObject({ code: 'worker-failed' });
    await expect(b).rejects.toMatchObject({ code: 'worker-failed' });
  });

  it('тексты ошибок для пользователя', () => {
    expect(importErrorText(new ImportError('timeout', ''))).toBe('The file is too complex or damaged');
    expect(importErrorText(new ImportError('too-large', ''))).toBe('The file is larger than 20 MB');
    expect(importErrorText(new Error('что-то'))).toBe('Something went wrong: что-то');
    expect(importErrorText(Object.assign(new Error('full'), { name: 'QuotaExceededError' }))).toBe('Not enough space on this computer to store the song');
  });
});
