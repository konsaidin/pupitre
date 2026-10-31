// Дубли записи (IndexedDB 'takes', схема v2): список для деки — без чтения сэмплов (Blob читается, только когда дубль
// слушают или выгружают); сырые сэмплы DI — Float32 в Blob; тон — снимок на момент записи. Имя по умолчанию — «Дубль N»
// по следующему свободному номеру.
import { useEffect, useSyncExternalStore } from 'react';
import { toneOf, type ToneShape } from '../../audio/guitar/tone';
import { blobSamples, samplesBlob } from '../../audio/guitar/wav';
import { DB_NAME, openGuitarDB, type GuitarDatabase, type StoredTake } from './db';

export type TakeInfo = Omit<StoredTake, 'dry'>;

interface State {
  takes: TakeInfo[];
  loaded: boolean;
}
let state: State = { takes: [], loaded: false };
let dbName = DB_NAME;
let database: Promise<GuitarDatabase> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
// соединение закрыто ради обновления схемы в другой вкладке — следующее обращение откроет новое
const db = () => (database ??= openGuitarDB(dbName, () => (database = null)));
const NAME_MAX = 60;

function publish(takes: TakeInfo[]) {
  // новые сверху
  state = { takes: [...takes].sort((a, b) => b.at - a.at), loaded: true };
  for (const fn of [...listeners]) fn();
}

const info = ({ dry: _dry, ...rest }: StoredTake): TakeInfo => ({ ...rest, tone: toneOf(rest.tone) });

export function loadTakes(): Promise<void> {
  loading ??= (async () => {
    try {
      publish((await (await db()).getAll('takes')).map(info));
    } catch {
      publish([]);
    }
  })();
  return loading;
}

/** «Дубль N»: следующий номер после самого большого. */
export function nextTakeName(takes: Array<{ name: string }>, word: string): string {
  const re = new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  const top = takes.reduce((n, t) => Math.max(n, Number(re.exec(t.name)?.[1] ?? 0)), 0);
  return `${word} ${top + 1}`;
}

export async function addTake(take: { sampleRate: number; samples: Float32Array<ArrayBuffer>; peak: number; tone: ToneShape; name: string }): Promise<TakeInfo> {
  await loadTakes();
  const at = Date.now();
  const id = `take:${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const record: StoredTake = {
    id, name: take.name.slice(0, NAME_MAX), at, sampleRate: take.sampleRate, frames: take.samples.length,
    peakDb: take.peak > 0 ? 20 * Math.log10(take.peak) : -Infinity, tone: toneOf(take.tone), dry: samplesBlob(take.samples),
  };
  await (await db()).put('takes', record);
  const saved = info(record);
  publish([...state.takes, saved]);
  return saved;
}

export async function renameTake(id: string, name: string): Promise<void> {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (!clean) return;
  const base = await db();
  const record = await base.get('takes', id);
  if (!record) return;
  await base.put('takes', { ...record, name: clean });
  publish(state.takes.map((t) => (t.id === id ? { ...t, name: clean } : t)));
}

export async function deleteTake(id: string): Promise<void> {
  await (await db()).delete('takes', id);
  publish(state.takes.filter((t) => t.id !== id));
}

/** Сырые сэмплы DI дубля; null — его нет. */
export async function takeSamples(id: string): Promise<Float32Array<ArrayBuffer> | null> {
  const record = await (await db()).get('takes', id);
  return record ? blobSamples(record.dry) : null;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function useTakes(): State {
  useEffect(() => void loadTakes(), []);
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const takesNow = (): TakeInfo[] => state.takes;

/** Только для тестов: своя база и пустой кэш. */
export function resetTakes(name = DB_NAME): void {
  dbName = name;
  database = null;
  loading = null;
  state = { takes: [], loaded: false };
  listeners.clear();
}
