// Дубли записи в IndexedDB: сохранить (тон — снимок, сэмплы — как были), переименовать, удалить, перечитать с нуля;
// имя по умолчанию — следующий номер.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TONE } from '../../audio/guitar/tone';
import { addTake, deleteTake, loadTakes, nextTakeName, renameTake, resetTakes, takeSamples, takesNow } from './takes';

describe('дубли записи', () => {
  beforeEach(() => resetTakes(`takes-${Math.random()}`));

  it('сохранить, переименовать, удалить; список — новые сверху, без сэмплов', async () => {
    const name = `takes-${Math.random()}`;
    resetTakes(name);
    const samples = Float32Array.from([0.1, -0.2, 0.3]);
    const a = await addTake({ sampleRate: 48000, samples, peak: 0.3, tone: { ...DEFAULT_TONE, gain: 0.9 }, name: 'Дубль 1' });
    await new Promise((r) => setTimeout(r, 2));
    const b = await addTake({ sampleRate: 44100, samples: Float32Array.from([0.5]), peak: 0.5, tone: DEFAULT_TONE, name: 'Дубль 2' });
    expect(takesNow().map((t) => t.id)).toEqual([b.id, a.id]);
    expect(a).toMatchObject({ frames: 3, sampleRate: 48000 });
    expect(a.peakDb).toBeCloseTo(20 * Math.log10(0.3), 5);
    expect('dry' in a).toBe(false);
    await renameTake(a.id, '  Соло   в ми ');
    await deleteTake(b.id);
    resetTakes(name);
    await loadTakes();
    expect(takesNow().map((t) => [t.name, t.tone.gain])).toEqual([['Соло в ми', 0.9]]);
    expect(await takeSamples(a.id)).toEqual(samples);
    expect(await takeSamples(b.id)).toBeNull();
  });

  it('имя по умолчанию — следующий номер', () => {
    expect(nextTakeName([], 'Дубль')).toBe('Дубль 1');
    expect(nextTakeName([{ name: 'Дубль 3' }, { name: 'Соло' }, { name: 'Дубль 10' }], 'Дубль')).toBe('Дубль 11');
  });
});
