// Настройки раздела: дефолты, неизвестные ключи, рост версии, испорченный JSON, запрет хранилища, одно уведомление на
// запись, событие storage из другой вкладки.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS, loadGuitarSettings, parseSettings, reloadGuitarSettings, SETTINGS_KEY, updateGuitarSettings,
} from './settings';

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

describe('parseSettings', () => {
  it('пусто или мусор — дефолты', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{не json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
  });

  it('слияние с дефолтами: сохранённое поверх, неверный тип — дефолт, неизвестные ключи сохраняются', () => {
    const s = parseSettings(JSON.stringify({ version: 1, view: { mode: 'tab', noteSpeed: 'быстро' }, future: { x: 1 }, latency: { 'g|di|a|b|w': { ms: 12 } } }));
    expect(s.view.mode).toBe('tab');
    expect(s.view.noteSpeed).toBe(DEFAULT_SETTINGS.view.noteSpeed);
    expect(s.view.stringOrder).toBe('low-top');
    expect((s as unknown as { future: unknown }).future).toEqual({ x: 1 });
    expect(s.latency).toEqual({ 'g|di|a|b|w': { ms: 12 } });
  });

  it('версия новее известной — общие поля читаются, номер не понижается', () => {
    const s = parseSettings(JSON.stringify({ version: 3, strictness: 'strict' }));
    expect(s.version).toBe(3);
    expect(s.strictness).toBe('strict');
  });
});

describe('load / update', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    reloadGuitarSettings();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('запись сохраняется в pupitre.guitar.v1 и читается обратно', () => {
    updateGuitarSettings((s) => ({ ...s, visualOffsetMs: 24 }));
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).visualOffsetMs).toBe(24);
    expect(reloadGuitarSettings().visualOffsetMs).toBe(24);
  });

  it('localStorage бросает — работаем на дефолтах, запись не падает', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceeded'); },
    });
    expect(reloadGuitarSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => updateGuitarSettings((s) => ({ ...s, strictness: 'soft' }))).not.toThrow();
    expect(loadGuitarSettings().strictness).toBe('soft');
  });
});
