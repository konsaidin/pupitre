// Пресеты тона (01-architecture, этап 45): встроенные — для гитары и баса, свои — в IndexedDB 'tones'. Выбранный —
// settings.monitoring.toneId; «изменён» — звучание (toneKey) отличается от сохранённого. Файл обмена — JSON
// { format: 'pupitre-tone-presets', version: 1, presets: [{ name, tone }] }; тон из файла проходит toneOf (поля своего
// типа, ручки в пределах). Питание (tone.on) — не часть пресета: выбор пресета его не трогает.
import { useEffect, useSyncExternalStore } from 'react';
import { toneOf, toneWith, type RigName, type ToneOverride, type ToneShape } from '../../audio/guitar/tone';
import { DB_NAME, openGuitarDB, type GuitarDatabase } from './db';

export interface TonePreset {
  /** factory:… — встроенный, user:… — свой. */
  id: string;
  /** Встроенный — ключ перевода (t), свой — как назвал игрок. */
  name: string;
  tone: ToneShape;
  builtIn: boolean;
  updatedAt: number;
}

const FACTORY: Array<{ id: string; label: string; tone: ToneOverride }> = [
  { id: 'jazz', label: 'Jazz clean', tone: { model: 'clean', gain: 0.3, bass: 0.6, mid: 0.45, treble: 0.4, presence: 0.35, gateOn: false, room: 0.22 } },
  {
    id: 'blues', label: 'Blues crunch',
    tone: { model: 'crunch', gain: 0.4, mid: 0.6, treble: 0.55, screamer: { on: true, drive: 0.25, tone: 0.55, level: 0.65 }, room: 0.2 },
  },
  {
    id: 'rock', label: 'Classic rock',
    tone: { model: 'crunch', gain: 0.75, bass: 0.55, mid: 0.65, treble: 0.6, presence: 0.55, delay: { on: true, mix: 0.16, ms: 380, feedback: 0.22 }, room: 0.16 },
  },
  {
    id: 'metal', label: 'Metal',
    tone: { model: 'high-gain', gain: 0.72, bass: 0.62, mid: 0.38, treble: 0.6, presence: 0.62, gateDb: -52, screamer: { on: true, drive: 0, tone: 0.6, level: 0.8 }, room: 0.1 },
  },
  {
    id: 'lead', label: 'Solo lead',
    tone: {
      model: 'high-gain', gain: 0.58, mid: 0.68, treble: 0.55, boost: { on: true, levels: [0.5, 0.6, 0.6, 0.5] },
      delay: { on: true, mix: 0.24, ms: 430, feedback: 0.35 }, room: 0.22,
    },
  },
  { id: 'grunge', label: 'Fuzz grunge', tone: { model: 'crunch', gain: 0.35, mid: 0.45, fuzz: { on: true, gain: 0.75, tone: 0.45, level: 0.55 }, room: 0.12 } },
  { id: 'surf', label: 'Surf', tone: { model: 'clean', gain: 0.35, bass: 0.45, treble: 0.68, presence: 0.6, gateOn: false, room: 0.62 } },
  {
    id: 'ambient', label: 'Ambient',
    tone: { model: 'clean', gain: 0.25, treble: 0.55, gateOn: false, delay: { on: true, mix: 0.42, ms: 540, feedback: 0.58 }, room: 0.55 },
  },
  { id: 'bass-di', label: 'Clean DI', tone: { rig: 'bass', gateOn: false, room: 0, bassAmp: { model: 'modern', gain: 0.3, comp: 0.3 } } },
  {
    id: 'bass-vintage', label: 'Vintage tube',
    tone: { rig: 'bass', gateOn: false, room: 0, bassAmp: { model: 'vintage', gain: 0.55, bass: 0.6, mid: 0.55, midFreq: 1, treble: 0.45, horn: false, comp: 0.2 } },
  },
  {
    id: 'bass-growl', label: 'Growl',
    tone: { rig: 'bass', gateOn: false, room: 0, bassAmp: { model: 'grit', gain: 0.7, blend: 0.55, mid: 0.62, treble: 0.55, comp: 0.35 } },
  },
  {
    id: 'bass-slap', label: 'Slap',
    tone: { rig: 'bass', gateOn: false, room: 0, bassAmp: { model: 'modern', gain: 0.3, mid: 0.38, midFreq: 1, treble: 0.6, ultraLo: true, ultraHi: true, comp: 0.5 } },
  },
  {
    id: 'bass-fuzz', label: 'Fuzz bass',
    tone: { rig: 'bass', gateOn: false, room: 0, fuzz: { on: true, gain: 0.6, tone: 0.35, level: 0.55 }, bassAmp: { model: 'vintage', gain: 0.35, blend: 0.8, comp: 0.2 } },
  },
];

export const FACTORY_PRESETS: TonePreset[] = FACTORY.map((f) => ({
  id: `factory:${f.id}`, name: f.label, tone: toneWith({ ...f.tone, on: true }), builtIn: true, updatedAt: 0,
}));

export const PRESETS_FORMAT = 'pupitre-tone-presets';
const NAME_MAX = 60;
/** Сколько пресетов берётся из одного файла. */
const IMPORT_MAX = 200;

const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const byName = (a: TonePreset, b: TonePreset) => a.name.localeCompare(b.name);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Имя без повтора среди занятых: «Мой звук», «Мой звук (2)»… */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = cleanName(name) || 'Preset';
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const next = `${base} (${n})`;
    if (!used.has(next)) return next;
  }
}

/** Файл обмена: тон без питания, нормализованный. */
export function presetsFile(presets: Array<{ name: string; tone: ToneShape }>): string {
  return JSON.stringify({ format: PRESETS_FORMAT, version: 1, presets: presets.map((p) => ({ name: cleanName(p.name), tone: toneOf({ ...p.tone, on: true }) })) }, null, 2);
}

/** Пресеты из файла обмена; не тот формат — ошибка. */
export function parsePresetsFile(text: string): Array<{ name: string; tone: ToneShape }> {
  const data: unknown = JSON.parse(text);
  if (!isObject(data) || data.format !== PRESETS_FORMAT || !Array.isArray(data.presets)) throw new Error('not a Pupitre presets file');
  return data.presets
    .filter((p): p is Record<string, unknown> => isObject(p) && typeof p.name === 'string' && cleanName(p.name).length > 0)
    .slice(0, IMPORT_MAX)
    .map((p) => ({ name: cleanName(p.name as string), tone: toneOf({ ...(isObject(p.tone) ? p.tone : {}), on: true }) }));
}

// ——— свои пресеты: IndexedDB 'tones', кэш на вкладку ———

interface State {
  user: TonePreset[];
  loaded: boolean;
}
let state: State = { user: [], loaded: false };
let dbName = DB_NAME;
let database: Promise<GuitarDatabase> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
// соединение закрыто ради обновления схемы в другой вкладке — следующее обращение откроет новое
const db = () => (database ??= openGuitarDB(dbName, () => (database = null)));

function publish(user: TonePreset[]) {
  state = { user: [...user].sort(byName), loaded: true };
  for (const fn of [...listeners]) fn();
}

function fromRow(row: Record<string, unknown>): TonePreset | null {
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  return { id: row.id, name: cleanName(row.name), tone: toneOf({ ...(isObject(row.tone) ? row.tone : {}), on: true }), builtIn: false, updatedAt: Number(row.updatedAt) || 0 };
}

export function loadUserPresets(): Promise<void> {
  loading ??= (async () => {
    try {
      const rows = await (await db()).getAll('tones');
      publish(rows.map(fromRow).filter((p): p is TonePreset => p !== null));
    } catch {
      // база недоступна (приватное окно, запрет) — только встроенные
      publish([]);
    }
  })();
  return loading;
}

function newId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `user:${random}`;
}

/** Сохранить свой пресет (новый — без id); вернёт сохранённый. */
export async function saveTonePreset(input: { id?: string; name: string; tone: ToneShape }): Promise<TonePreset> {
  await loadUserPresets();
  const preset: TonePreset = {
    id: input.id ?? newId(), name: cleanName(input.name) || 'Preset', tone: toneOf({ ...input.tone, on: true }), builtIn: false, updatedAt: Date.now(),
  };
  await (await db()).put('tones', { id: preset.id, name: preset.name, tone: preset.tone, updatedAt: preset.updatedAt });
  publish([...state.user.filter((p) => p.id !== preset.id), preset]);
  return preset;
}

export async function deleteTonePreset(id: string): Promise<void> {
  await loadUserPresets();
  await (await db()).delete('tones', id);
  publish(state.user.filter((p) => p.id !== id));
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Встроенные и свои пресеты; свои грузятся при первом использовании. */
export function useTonePresets(): State {
  useEffect(() => void loadUserPresets(), []);
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const presetsOfRig = (presets: TonePreset[], rig: RigName) => presets.filter((p) => p.tone.rig === rig);

/** Свои пресеты сейчас (кэш вкладки). */
export const userPresets = (): TonePreset[] => state.user;

/** Только для тестов: своя база и пустой кэш. */
export function resetTonePresets(name = DB_NAME): void {
  dbName = name;
  database = null;
  loading = null;
  state = { user: [], loaded: false };
  listeners.clear();
}
