// Дека записи без звука: прослушивание, запись и выгрузка на подменённых модулях. Выбрали другой дубль, пока грузился
// первый, — играет второй, первый ничего не трогает; запись без единого куска — ошибка «нет звука»; вход закрылся посреди
// записи — дубль сохранён; выгрузки — по одной.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  return {
    deferred,
    samples: new Map<string, ReturnType<typeof deferred<Float32Array | null>>>(),
    played: [] as string[],
    stopped: [] as string[],
    inputState: 'ok' as string,
    inputListeners: new Set<() => void>(),
    recordingSeconds: 0,
    added: [] as Array<{ name: string; frames: number }>,
    renders: [] as Array<ReturnType<typeof deferred<Float32Array>>>,
  };
});

vi.mock('../../audio/instrument/session', () => ({
  getInputSnapshot: () => ({ state: h.inputState }),
  subscribeInput: (fn: () => void) => {
    h.inputListeners.add(fn);
    return () => h.inputListeners.delete(fn);
  },
}));
vi.mock('../../audio/guitar/recorder', () => ({
  inputRecordable: () => true,
  startRecording: () => ({
    seconds: () => h.recordingSeconds,
    levelDb: () => -20,
    peak: () => 0.5,
    stop: () => (h.recordingSeconds ? { sampleRate: 48000, samples: new Float32Array(Math.round(h.recordingSeconds * 48000)), peak: 0.5 } : null),
  }),
}));
vi.mock('../../audio/guitar/takePlayer', () => ({
  playTake: async (samples: Float32Array & { tag?: string }) => {
    const tag = samples.tag ?? '?';
    h.played.push(tag);
    return { duration: 1, position: () => 0, levelDb: () => -30, setTone: () => {}, stop: () => h.stopped.push(tag), onEnded: null };
  },
}));
vi.mock('../../audio/guitar/toneRender', () => ({
  renderTone: () => {
    const d = h.deferred<Float32Array>();
    h.renders.push(d);
    return d.promise;
  },
}));
vi.mock('./takes', () => ({
  takesNow: () => [
    { id: 'A', name: 'Дубль 1', at: 2, sampleRate: 48000, frames: 48000, peakDb: -6, tone: {} },
    { id: 'B', name: 'Дубль 2', at: 1, sampleRate: 48000, frames: 48000, peakDb: -6, tone: {} },
  ],
  takeSamples: (id: string) => {
    let d = h.samples.get(id);
    if (!d) {
      d = h.deferred<Float32Array | null>();
      h.samples.set(id, d);
    }
    return d.promise;
  },
  nextTakeName: () => 'Дубль 3',
  addTake: async (take: { name: string; samples: Float32Array }) => {
    h.added.push({ name: take.name, frames: take.samples.length });
    return { id: 'C' };
  },
}));

const deck = await import('./deck');
const tagged = (tag: string) => Object.assign(new Float32Array(48), { tag });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('дека записи', () => {
  beforeEach(() => {
    h.samples.clear();
    h.played.length = h.stopped.length = h.added.length = h.renders.length = 0;
    h.inputState = 'ok';
    h.recordingSeconds = 0;
  });
  afterEach(async () => {
    await deck.deckStop();
    vi.useRealTimers();
  });

  it('другой дубль выбран, пока первый грузился: играет второй, первый ничего не трогает', async () => {
    void deck.deckPlay('A');
    expect(deck.deckNow()).toMatchObject({ phase: 'loading', takeId: 'A' });
    deck.deckSelect('B');
    expect(deck.deckNow()).toMatchObject({ phase: 'loading', takeId: 'B' });
    h.samples.get('A')!.resolve(tagged('A'));
    await flush();
    expect(deck.deckNow()).toMatchObject({ phase: 'loading', takeId: 'B' });
    h.samples.get('B')!.resolve(tagged('B'));
    await flush();
    expect(deck.deckNow()).toMatchObject({ phase: 'playing', takeId: 'B', error: '' });
    expect(h.played).toEqual(['B']);
  });

  it('за 1,5 с ни одного куска записи — ошибка «нет звука», а не пустой дубль', async () => {
    vi.useFakeTimers();
    deck.deckRecord('Дубль');
    expect(deck.deckNow().phase).toBe('recording');
    vi.advanceTimersByTime(1600);
    expect(deck.deckNow()).toMatchObject({ phase: 'idle', error: 'no-audio' });
  });

  it('вход закрылся посреди записи — дубль сохранён тем, что успели', async () => {
    deck.deckRecord('Дубль');
    h.recordingSeconds = 2;
    h.inputState = 'device-lost';
    for (const fn of [...h.inputListeners]) fn();
    await flush();
    expect(h.added).toEqual([{ name: 'Дубль 3', frames: 96000 }]);
    expect(deck.deckNow()).toMatchObject({ phase: 'idle', takeId: 'C' });
    expect(h.inputListeners.size).toBe(0);
  });

  it('выгрузки — по одной: вторая, пока идёт первая, не начинается', async () => {
    const first = deck.deckRender('A', 'current');
    h.samples.get('A')!.resolve(tagged('A'));
    await flush();
    expect(deck.deckNow().rendering?.takeId).toBe('A');
    expect(await deck.deckRender('B', 'current')).toBeNull();
    h.renders[0].resolve(new Float32Array(10));
    expect(await first).toBeInstanceOf(Blob);
    expect(deck.deckNow().rendering).toBeNull();
  });
});
