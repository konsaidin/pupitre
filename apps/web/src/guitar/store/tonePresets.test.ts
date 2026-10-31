// Пресеты тона: встроенные — нормальные тона обоих комплектов, все звучат по-разному; свои — в IndexedDB 'tones'
// (сохранить, переименовать тем же id, удалить, перечитать с нуля); файл обмена — туда и обратно, чужое — отвергается.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TONE, toneKey, toneOf } from '../../audio/guitar/tone';
import {
  deleteTonePreset, FACTORY_PRESETS, loadUserPresets, parsePresetsFile, presetsFile, presetsOfRig, resetTonePresets, saveTonePreset, uniqueName,
  userPresets,
} from './tonePresets';

describe('пресеты тона', () => {
  beforeEach(() => resetTonePresets(`presets-${Math.random()}`));

  it('встроенные: оба комплекта, тона нормальные и все разные', () => {
    expect(presetsOfRig(FACTORY_PRESETS, 'guitar').length).toBeGreaterThanOrEqual(6);
    expect(presetsOfRig(FACTORY_PRESETS, 'bass').length).toBeGreaterThanOrEqual(4);
    for (const p of FACTORY_PRESETS) {
      expect(p.builtIn).toBe(true);
      expect(toneOf(p.tone)).toEqual(p.tone);
    }
    expect(new Set(FACTORY_PRESETS.map((p) => toneKey(p.tone))).size).toBe(FACTORY_PRESETS.length);
    expect(new Set(FACTORY_PRESETS.map((p) => p.id)).size).toBe(FACTORY_PRESETS.length);
  });

  it('свои: сохранить, перезаписать тем же id, удалить; после перезагрузки — из базы', async () => {
    const name = `presets-${Math.random()}`;
    resetTonePresets(name);
    const a = await saveTonePreset({ name: '  Мой   звук ', tone: { ...DEFAULT_TONE, gain: 0.8, on: false } });
    expect(a.name).toBe('Мой звук');
    expect(a.tone.on).toBe(true);
    const b = await saveTonePreset({ name: 'Бас', tone: { ...DEFAULT_TONE, rig: 'bass' } });
    await saveTonePreset({ id: a.id, name: 'Мой звук 2', tone: { ...DEFAULT_TONE, gain: 0.9 } });
    // та же база, кэш с нуля: список — из IndexedDB
    resetTonePresets(name);
    await loadUserPresets();
    expect(userPresets().map((p) => [p.name, p.tone.gain, p.tone.rig])).toEqual([['Бас', 0.5, 'bass'], ['Мой звук 2', 0.9, 'guitar']]);
    await deleteTonePreset(b.id);
    resetTonePresets(name);
    await loadUserPresets();
    expect(userPresets().map((p) => p.id)).toEqual([a.id]);
  });

  it('файл обмена: туда и обратно; не тот формат — ошибка; мусор в тоне — в пределах', () => {
    const file = presetsFile([{ name: 'Соло', tone: { ...DEFAULT_TONE, gain: 0.7 } }]);
    expect(parsePresetsFile(file)).toEqual([{ name: 'Соло', tone: { ...DEFAULT_TONE, gain: 0.7 } }]);
    expect(() => parsePresetsFile('{"presets": []}')).toThrow();
    expect(() => parsePresetsFile('не json')).toThrow();
    const odd = parsePresetsFile(JSON.stringify({ format: 'pupitre-tone-presets', version: 1, presets: [{ name: 'X', tone: { gain: 40 } }, { name: '' }, 5] }));
    expect(odd).toHaveLength(1);
    expect(odd[0].tone.gain).toBe(1);
  });

  it('имена без повторов', () => {
    expect(uniqueName('Звук', [])).toBe('Звук');
    expect(uniqueName('Звук', ['Звук', 'Звук (2)'])).toBe('Звук (3)');
  });
});
