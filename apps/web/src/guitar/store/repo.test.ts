// Библиотека на fake-indexeddb: импорт и чтение, дедупликация, ноты всех дорожек, правка данных, пере-разбор при росте
// версии конвертера с переносом правок, каскадное удаление — 0 записей с удалённым songId во всех хранилищах (N/N).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { gp7Bytes } from '../import/fixtures';
import { handleParse, type ParseRequest } from '../import/scoreWorkerHandlers';
import { CONVERTER_VERSION } from '../model/types';
import { openGuitarDB, STORES, type GuitarDatabase } from './db';
import { createRepo } from './repo';

// Парсер «как через воркер»: запрос и ответ проходят structuredClone.
const parser = { parse: async (req: ParseRequest) => structuredClone(await handleParse(structuredClone(req))) };
let dbCounter = 0;
async function fresh() {
  const db = await openGuitarDB(`test-${++dbCounter}`);
  return { db, repo: createRepo(db, parser) };
}
async function everyRecord(db: GuitarDatabase): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const store of STORES) for (const value of await db.getAll(store)) out.push([store, JSON.stringify(value)]);
  return out;
}

describe('repo', () => {
  it('импорт: песня, аранжировки, оригинал и ноты всех дорожек; чтение после переоткрытия базы', async () => {
    const { db, repo } = await fresh();
    const bytes = gp7Bytes('chords');
    const outcome = await repo.importFile(bytes.slice(), 'Chords.gp');
    expect(outcome.duplicate).toBe(false);
    expect(outcome.song.title).toBe('Chords');
    expect(outcome.song.arrangementIds).toEqual(outcome.arrangements.map((a) => a.id));
    expect(outcome.arrangements[0].events.length).toBe(6);
    const name = db.name;
    db.close();
    const again = createRepo(await openGuitarDB(name), parser);
    expect((await again.allSongs()).map((s) => s.id)).toEqual([outcome.song.id]);
    const file = await again.getFile(outcome.song.scoreFileId);
    expect(new Uint8Array(await file!.blob.arrayBuffer())).toEqual(bytes);
    expect((await again.getScoreNotes(outcome.song.id)).length).toBeGreaterThan(10);
  });

  it('дедупликация: тот же файл второй раз — та же песня, ничего не записано', async () => {
    const { repo } = await fresh();
    const first = await repo.importFile(gp7Bytes('single-notes'), 'a.gp');
    const second = await repo.importFile(gp7Bytes('single-notes'), 'b.gp');
    expect(second.duplicate).toBe(true);
    expect(second.song).toEqual(first.song);
    expect(await repo.allSongs()).toHaveLength(1);
    expect((await repo.importFile(gp7Bytes('drop-d'), 'c.gp')).duplicate).toBe(false);
    expect(await repo.allSongs()).toHaveLength(2);
  });

  it('демо-песня из alphaTex хранится как GP-файл', async () => {
    const { repo } = await fresh();
    const outcome = await repo.importAlphaTex('\\title "Demo"\n\\track "G"\n\\staff {tabs}\n0.6.4 3.6.4 5.6.2', 'demo.alphatex');
    expect(outcome.song.title).toBe('Demo');
    expect((await repo.getFile(outcome.song.scoreFileId))?.type).toBe('application/x-guitar-pro');
  });

  it('правка данных песни сохраняется', async () => {
    const { repo } = await fresh();
    const { song } = await repo.importFile(gp7Bytes('capo2'), 'x.gp');
    await repo.updateSong(song.id, { title: 'Своё название', artist: 'Я' });
    expect(await repo.getSong(song.id)).toMatchObject({ title: 'Своё название', artist: 'Я' });
  });

  it('пере-разбор при росте CONVERTER_VERSION: правка аппликатуры переносится, лишняя — предупреждение', async () => {
    const { db, repo } = await fresh();
    const { song, arrangements } = await repo.importFile(gp7Bytes('single-notes'), 'x.gp');
    expect((await repo.refreshIfStale(song.id)).reparsed).toBe(false);
    const arr = arrangements[0];
    const key = `${arr.events[1].tick}:${arr.events[1].notes[0].midi}`;
    await db.put('arrangements', {
      ...arr, source: { ...arr.source, converterVersion: CONVERTER_VERSION - 1 },
      userEdits: { fingering: { [key]: { string: 1, fret: 0 }, '1:1': { string: 0, fret: 1 } } },
    });
    await repo.updateSong(song.id, { title: 'Не трогать' });
    const r = await repo.refreshIfStale(song.id);
    expect(r.reparsed).toBe(true);
    expect(r.warnings).toContainEqual({ code: 'user-edits-unmatched', detail: expect.any(String), count: 1 });
    const fresh2 = await repo.getArrangement(arr.id);
    expect(fresh2?.source.converterVersion).toBe(CONVERTER_VERSION);
    expect(fresh2?.userEdits?.fingering).toEqual({ [key]: { string: 1, fret: 0 } });
    expect((await repo.getSong(song.id))?.title).toBe('Не трогать');
  });

  it('каскадное удаление: 0 записей с songId во всех хранилищах (N/N), другая песня цела', async () => {
    const { db, repo } = await fresh();
    const gone = await repo.importFile(gp7Bytes('repeats-ds'), 'gone.gp');
    const kept = await repo.importFile(gp7Bytes('bass5'), 'kept.gp');
    const arrId = gone.arrangements[0].id;
    await db.put('syncs', { id: `${gone.song.id}:abc`, sync: { version: 1, scoreSha256: 'x', audioSha256: 'abc', domain: 'browser', offsetMs: 0, playlist: [], anchors: [], source: 'linear' } });
    await db.put('progress', { arrId, levels: { mode: 'max' }, bestScore: 1, bestAccuracy: 1, mastery: 0, masteryPeak: 0, phraseMastery: {}, plays: 1, lastPlayedAt: 1 });
    await db.add('sessions', { arrId, at: 1 } as never);
    await db.add('sessions', { arrId: kept.arrangements[0].id, at: 2 } as never);
    await db.put('lists', { id: 'fav', name: 'Любимые', songIds: [gone.song.id, kept.song.id] });
    await repo.removeSong(gone.song.id);
    const records = await everyRecord(db);
    const leftovers = records.filter(([, json]) => json.includes(gone.song.id));
    expect(leftovers).toEqual([]);
    expect(records.length).toBeGreaterThan(5);
    expect(await repo.getSong(kept.song.id)).toBeDefined();
    expect((await db.get('lists', 'fav'))?.songIds).toEqual([kept.song.id]);
    expect(await db.count('sessions')).toBe(1);
  });
});
