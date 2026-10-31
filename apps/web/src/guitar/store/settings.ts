// Настройки гитарного раздела (§3.5 GuitarSettings): единственный модуль чтения и записи 'pupitre.guitar.v1'.
// Чтение и запись — в try/catch (приватное окно, запрет хранилища — работаем на дефолтах без ошибки); слияние с
// дефолтами, как lib/profile.ts; неизвестные ключи сохраняются (их могла записать более новая версия); миграция по
// version. useGuitarSettings — подписка: одно уведомление на запись, другие вкладки — событие storage.
import { useSyncExternalStore } from 'react';
import { DEFAULT_TONE } from '../../audio/guitar/tone';
import type { GuitarSettings } from '../model/types';

export const SETTINGS_KEY = 'pupitre.guitar.v1';

export const DEFAULT_SETTINGS: GuitarSettings = {
  version: 1,
  instrument: { default: 'guitar', leftHanded: false },
  input: { deviceId: null, channel: -1, type: 'di', backend: 'auto' },
  latency: {},
  visualOffsetMs: 0,
  reference: { a4Hz: 440 },
  // Нижняя струна сверху — «как смотришь на гитару», как в fretfall и Rocksmith; табулатурный порядок — high-top.
  view: { mode: '3d', stringOrder: 'low-top', palette: 'default', gemLabel: 'fret', noteSpeed: 1, timingHint: false },
  strictness: 'normal',
  learn: false,
  dd: { enabled: true, startLevel: 'max', overrideToMax: {} },
  // гайд — партия игрока соло под минусом, тихо (ui-spec: −18 дБ ≈ 0.125); мониторинг себя — тихий (§8.9: ≈ −10 дБ)
  mix: { backing: 1, reference: 1, metronome: 0.6, guide: 0.125, monitor: 0.3 },
  monitoring: { mode: 'off' },
  tone: DEFAULT_TONE,
  features: { ddSuggestions: false, autoLevel: false },
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

// Глубокое слияние: значения сохранённого объекта поверх дефолтов, тип листа — как у дефолта (иначе дефолт);
// ключи, которых нет в дефолтах, сохраняются как есть. Словари (latency, overrideToMax) — целиком из сохранённого.
const FREE_MAPS = new Set(['latency', 'overrideToMax']);
function merge(base: unknown, saved: unknown, key = ''): unknown {
  if (FREE_MAPS.has(key)) return isObject(saved) ? saved : base;
  if (isObject(base)) {
    if (!isObject(saved)) return base;
    const out: Json = { ...saved };
    for (const [k, v] of Object.entries(base)) out[k] = merge(v, saved[k], k);
    return out;
  }
  if (saved === undefined) return base;
  if (base === null || base === undefined) return saved;
  return typeof saved === typeof base ? saved : base;
}

/** Миграции по version: version N → N + 1. Пока одна версия. */
const MIGRATIONS: Record<number, (s: Json) => Json> = {};

export function parseSettings(raw: string | null): GuitarSettings {
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
  if (!isObject(data)) return structuredClone(DEFAULT_SETTINGS);
  let version = typeof data.version === 'number' ? data.version : 1;
  while (MIGRATIONS[version]) data = MIGRATIONS[version++](data as Json);
  const merged = merge(DEFAULT_SETTINGS, data) as GuitarSettings;
  // Версия новее известной — читаем общие поля и не понижаем номер при записи.
  return { ...merged, version: Math.max(version, DEFAULT_SETTINGS.version) as 1 };
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let cache: GuitarSettings | null = null;
const listeners = new Set<() => void>();

export function loadGuitarSettings(): GuitarSettings {
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(SETTINGS_KEY) ?? null;
  } catch {
    raw = null;
  }
  cache = parseSettings(raw);
  return cache;
}

/** Запись: функция получает текущие настройки и возвращает новые; одно уведомление подписчикам. */
export function updateGuitarSettings(update: (s: GuitarSettings) => GuitarSettings): GuitarSettings {
  const next = update(loadGuitarSettings());
  cache = next;
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // запрет хранилища: живём на значениях в памяти до перезагрузки
  }
  for (const listener of listeners) listener();
  return next;
}

/** Сброс кэша — для тестов и после события storage из другой вкладки. */
export function reloadGuitarSettings(): GuitarSettings {
  cache = null;
  const next = loadGuitarSettings();
  for (const listener of listeners) listener();
  return next;
}

// Один обработчик storage на все подписки: ставится с первой, снимается с последней.
function onStorage(e: StorageEvent) {
  if (e.key === SETTINGS_KEY) reloadGuitarSettings();
}
/** Подписка на запись настроек вне React (дека записи следит за тоном при прослушивании). */
export function subscribeGuitarSettings(listener: () => void): () => void {
  return subscribe(listener);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) globalThis.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) globalThis.removeEventListener?.('storage', onStorage);
  };
}

export function useGuitarSettings(): [GuitarSettings, typeof updateGuitarSettings] {
  return [useSyncExternalStore(subscribe, loadGuitarSettings, loadGuitarSettings), updateGuitarSettings];
}
