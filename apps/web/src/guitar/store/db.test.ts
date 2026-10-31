// Схема IndexedDB: база прошлой версии (v1, как её создавал раздел до дублей) обновляется до v2 без потерь — появляется
// хранилище дублей, данные v1 на месте; новая база создаётся сразу со всеми хранилищами.
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { DB_VERSION, openGuitarDB, STORES } from './db';

describe('схема pupitre-guitar', () => {
  it('v1 → v2: данные на месте, хранилище дублей с индексом по времени', async () => {
    const name = `db-test-${Math.random()}`;
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        for (const store of ['songs', 'syncs', 'lists', 'tones']) db.createObjectStore(store, { keyPath: 'id' });
        db.createObjectStore('files', { keyPath: 'id' }).createIndex('songId', 'songId');
        db.createObjectStore('arrangements', { keyPath: 'id' }).createIndex('songId', 'songId');
        db.createObjectStore('progress', { keyPath: 'arrId' });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        sessions.createIndex('arrId', 'arrId');
        sessions.createIndex('at', 'at');
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    await v1.put('songs', { id: 's1', title: 'Песня' });
    await v1.put('tones', { id: 'user:1', name: 'Мой звук' });
    v1.close();
    const db = await openGuitarDB(name);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([...STORES].sort());
    expect(await db.get('songs', 's1')).toEqual({ id: 's1', title: 'Песня' });
    expect(await db.get('tones', 'user:1')).toEqual({ id: 'user:1', name: 'Мой звук' });
    expect([...db.transaction('takes').store.indexNames]).toEqual(['at']);
    db.close();
  });

  it('новая база — сразу со всеми хранилищами', async () => {
    const db = await openGuitarDB(`db-test-${Math.random()}`);
    expect([...db.objectStoreNames].sort()).toEqual([...STORES].sort());
    db.close();
  });
});
