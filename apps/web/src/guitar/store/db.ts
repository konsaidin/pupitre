// IndexedDB 'pupitre-guitar' (01-architecture.md §3.6), схема v1 через idb. Рост схемы — только новой версией с
// upgrade и тестом на базе прошлой версии.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GuitarArrangement, GuitarSong, ProgressRecord, SessionRecord, SyncMap } from '../model/types';

export const DB_NAME = 'pupitre-guitar';
export const DB_VERSION = 1;

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
}
export type GuitarDatabase = IDBPDatabase<GuitarDB>;
export const STORES = ['songs', 'files', 'arrangements', 'syncs', 'progress', 'sessions', 'lists', 'tones', 'meta'] as const;

export function openGuitarDB(name = DB_NAME): Promise<GuitarDatabase> {
  return openDB<GuitarDB>(name, DB_VERSION, {
    upgrade(db) {
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
    },
  });
}
