import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getExternalApiToken, instrumentalUrl, listSongs, saveMap, setApiBase, setExternalApiToken } from './api';

const fetchMock = vi.fn();
const ensureBackend = vi.fn(async () => {});

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', {status: 200}));
  ensureBackend.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { desktop: {apiBase: 'http://127.0.0.1:8123', apiToken: 'session-secret', ensureBackend} });
});

afterEach(() => vi.unstubAllGlobals());

describe('доступ к встроенному серверу', () => {
  it('добавляет токен к собственным запросам и URL аудио', async () => {
    await apiFetch('http://127.0.0.1:8123/api/songs');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer session-secret');
    expect(instrumentalUrl('abc')).toBe('http://127.0.0.1:8123/api/songs/abc/instrumental?token=session-secret');
  });

  it('не передаёт токен внешнему серверу или похожему адресу', async () => {
    setApiBase('https://external.invalid');
    expect(instrumentalUrl('abc')).not.toContain('secret');
    await apiFetch('http://127.0.0.1:8123.evil.invalid/api/songs');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(ensureBackend).not.toHaveBeenCalled();
  });

  it('тихая проверка на главной не запускает установку сервера', async () => {
    await listSongs(false);
    expect(ensureBackend).not.toHaveBeenCalled();
  });

  it('использует отдельный ключ внешнего сервера и сбрасывает его при смене адреса', async () => {
    setApiBase('https://external.invalid');
    setExternalApiToken('external-key');
    await apiFetch('https://external.invalid/api/songs');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer external-key');
    expect(instrumentalUrl('abc')).toContain('token=external-key');
    expect(instrumentalUrl('abc')).not.toContain('session-secret');
    setApiBase('https://second.invalid');
    expect(getExternalApiToken()).toBe('');
    await apiFetch('https://second.invalid/api/songs');
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has('Authorization')).toBe(false);
  });

  it('сохраняет метки и параметры техники в запросе редактора', async () => {
    const note = { startMs: 0, durMs: 2000, midi: 60, vibrato: true, tech: 'vibrato' as const, techWarmupMs: 1200 };
    await saveMap('abc', [note]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({notes: [note]});
  });
});
