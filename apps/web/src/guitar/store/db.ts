// IndexedDB 'pupitre-guitar' (01-architecture.md §3.6) через idb. Рост схемы — только новой версией с upgrade и тестом на
// базе прошлой версии (db.test.ts). v2 — дубли записи (takes). Соединение закрывается само, когда другая вкладка просит
// обновления (иначе обновление ждёт его закрытия): onClosed — владелец забывает соединение и откроет новое. Обновление
// ждёт вкладку старой версии — событие DB_BLOCKED_EVENT (оболочка просит закрыть другие вкладки).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ToneShape } from '../../audio/guitar/tone';
import type { GuitarArrangement, GuitarSong, ProgressRecord, SessionRecord, SyncMap } from '../model/types';

export const DB_NAME = 'pupitre-guitar';
export const DB_VERSION = 2;
export const DB_BLOCKED_EVENT = 'pupitre:db-blocked';

export type FileKind = 'score' | 'scoreNotes' | 'recording' | 'stem' | 'ir' | 'model';
export interface StoredFile {
  id: string;
  songId: string;
  kind: FileKind;
  name: string;
  type: string;
  bytes: number;
  blob: Blob;
}
/** id — `${songId}:${audioSha256}`; журнал правок — этап 24. */
export interface StoredSync {
  id: string;
  sync: SyncMap;
}
export interface SongList {
  id: string;
  name: string;
  songIds: string[];
}

/** Дубль записи: сухой DI (моно Float32, little-endian) и тон, с которым он звучал. */
export interface StoredTake {
  id: string;
  name: string;
  /** Когда записан (Date.now). */
  at: number;
  sampleRate: number;
  frames: number;
  peakDb: number;
  tone: ToneShape;
  dry: Blob;
}

export interface GuitarDB extends DBSchema {
  songs: { key: string; value: GuitarSong };
  files: { key: string; value: StoredFile; indexes: { songId: string } };
  arrangements: { key: string; value: GuitarArrangement; indexes: { songId: string } };
  syncs: { key: string; value: StoredSync };
  progress: { key: string; value: ProgressRecord };
  sessions: { key: number; value: SessionRecord; indexes: { arrId: string; at: number } };
  lists: { key: string; value: SongList };
  tones: { key: string; value: { id: string } & Record<string, unknown> };
  meta: { key: string; value: { key: string; value: unknown } };
  takes: { key: string; value: StoredTake; indexes: { at: number } };
}
export type GuitarDatabase = IDBPDatabase<GuitarDB>;
export const STORES = ['songs', 'files', 'arrangements', 'syncs', 'progress', 'sessions', 'lists', 'tones', 'meta', 'takes'] as const;

export function openGuitarDB(name = DB_NAME, onClosed?: () => void): Promise<GuitarDatabase> {
  return openDB<GuitarDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('songs', { keyPath: 'id' });
        db.createObjectStore('files', { keyPath: 'id' }).createIndex('songId', 'songId');
        db.createObjectStore('arrangements', { keyPath: 'id' }).createIndex('songId', 'songId');
        db.createObjectStore('syncs', { keyPath: 'id' });
        db.createObjectStore('progress', { keyPath: 'arrId' });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        sessions.createIndex('arrId', 'arrId');
        sessions.createIndex('at', 'at');
        db.createObjectStore('lists', { keyPath: 'id' });
        db.createObjectStore('tones', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (oldVersion < 2) db.createObjectStore('takes', { keyPath: 'id' }).createIndex('at', 'at');
    },
    blocking(_current, _next, event) {
      (event.target as IDBDatabase | null)?.close();
      onClosed?.();
    },
    blocked() {
      globalThis.dispatchEvent?.(new Event(DB_BLOCKED_EVENT));
    },
    terminated() {
      onClosed?.();
    },
  });
}
