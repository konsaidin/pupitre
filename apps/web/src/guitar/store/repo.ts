// Библиотека раздела поверх IndexedDB (§3.6): импорт файла через воркер разбора → песня + аранжировки + оригинал и
// ноты всех дорожек; дедупликация по SHA-256 файла (id песни — его первые 16 hex); список, чтение, правка данных
// песни; каскадное удаление по всем хранилищам; пере-разбор из оригинала при росте CONVERTER_VERSION с переносом правок
// пользователя. persist() — при первом импорте. Парсер внедряется: в приложении — воркер, в тестах — прямой вызов.
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { CONVERTER_VERSION, type GuitarArrangement, type GuitarSong, type ImportWarning, type ScoreFormat, type ScoreNote } from '../model/types';
import type { ScoreEncoding } from '../import/parseScore';
import { sha256Hex, type Bytes, type ParseRequest, type ParseResult } from '../import/protocol';
import { transferUserEdits } from '../import/userEdits';
import type { GuitarDatabase, StoredFile } from './db';

export interface Parser {
  parse(req: ParseRequest): Promise<ParseResult>;
}

export interface ImportOutcome {
  song: GuitarSong;
  arrangements: GuitarArrangement[];
  warnings: ImportWarning[];
  /** Этот файл уже был в библиотеке — ничего не записано. */
  duplicate: boolean;
}

const MIME: Record<ScoreFormat, string> = {
  gp3: 'application/x-guitar-pro', gp4: 'application/x-guitar-pro', gp5: 'application/x-guitar-pro',
  gpx: 'application/x-guitar-pro', gp7: 'application/x-guitar-pro', gp8: 'application/x-guitar-pro',
  musicxml: 'application/vnd.recordare.musicxml+xml', mxl: 'application/vnd.recordare.musicxml', midi: 'audio/midi',
};
const titleFromName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || name;

export function createRepo(db: GuitarDatabase, parser: Parser) {
  async function store(result: ParseResult, existingSong?: GuitarSong): Promise<ImportOutcome> {
    const songId = result.songId;
    const now = Date.now();
    const scoreFile: StoredFile = {
      id: `${songId}:score`, songId, kind: 'score', name: result.name, type: MIME[result.format], bytes: result.score.byteLength,
      blob: new Blob([result.score], { type: MIME[result.format] }),
    };
    const notes = gzipSync(strToU8(JSON.stringify(result.scoreNotes)));
    const notesFile: StoredFile = {
      id: `${songId}:scoreNotes`, songId, kind: 'scoreNotes', name: 'score-notes.json.gz', type: 'application/gzip', bytes: notes.byteLength,
      blob: new Blob([notes], { type: 'application/gzip' }),
    };
    const song: GuitarSong = {
      ...existingSong,
      id: songId,
      title: existingSong?.title ?? (result.title || titleFromName(result.name)),
      artist: existingSong?.artist ?? result.artist,
      ...(existingSong?.album ?? result.album ? { album: existingSong?.album ?? result.album } : {}),
      scoreFileId: scoreFile.id,
      scoreNotesFileId: notesFile.id,
      arrangementIds: result.arrangements.map((a) => a.id),
      createdAt: existingSong?.createdAt ?? now,
      updatedAt: now,
    };
    const tx = db.transaction(['songs', 'files', 'arrangements'], 'readwrite');
    await Promise.all([
      tx.objectStore('files').put(scoreFile),
      tx.objectStore('files').put(notesFile),
      ...result.arrangements.map((a) => tx.objectStore('arrangements').put(a)),
      tx.objectStore('songs').put(song),
      tx.done,
    ]);
    return { song, arrangements: result.arrangements, warnings: result.warnings, duplicate: false };
  }

  // Индекс отдаёт по первичному ключу-строке («…:10:0» раньше «…:2:0») — порядок партий как в файле.
  async function arrangementsOf(songId: string): Promise<GuitarArrangement[]> {
    const list = await db.getAllFromIndex('arrangements', 'songId', songId);
    return list.sort((a, b) => a.trackIndex - b.trackIndex || a.staffIndex - b.staffIndex);
  }

  return {
    async importFile(bytes: Bytes, name: string, opts: { encoding?: ScoreEncoding } = {}): Promise<ImportOutcome> {
      const sha = await sha256Hex(bytes);
      const existing = await db.get('songs', sha.slice(0, 16));
      if (existing) return { song: existing, arrangements: await arrangementsOf(existing.id), warnings: [], duplicate: true };
      const first = (await db.count('songs')) === 0;
      // Байты уходят воркеру без копии; оригинал возвращается в ответе (result.score).
      const result = await parser.parse({ bytes, name, ...opts });
      const outcome = await store(result);
      if (first) await navigator.storage?.persist?.().catch(() => false);
      return outcome;
    },

    /** Демо-песня и dev-стенды: alphaTex конвертируется в GP7 в воркере и хранится как файл. */
    async importAlphaTex(alphaTex: string, name: string): Promise<ImportOutcome> {
      const result = await parser.parse({ alphaTex, name });
      const existing = await db.get('songs', result.songId);
      if (existing) return { song: existing, arrangements: await arrangementsOf(existing.id), warnings: [], duplicate: true };
      return store(result);
    },

    allSongs: () => db.getAll('songs'),
    getSong: (id: string) => db.get('songs', id),
    getArrangements: arrangementsOf,
    getArrangement: (id: string) => db.get('arrangements', id),
    getFile: (id: string) => db.get('files', id),

    async getScoreNotes(songId: string): Promise<ScoreNote[]> {
      const file = await db.get('files', `${songId}:scoreNotes`);
      if (!file) return [];
      return JSON.parse(strFromU8(gunzipSync(new Uint8Array(await file.blob.arrayBuffer())))) as ScoreNote[];
    },

    /** «Изменить данные» карточки (этап 12a). */
    async updateSong(id: string, patch: Partial<Pick<GuitarSong, 'title' | 'artist' | 'album' | 'lastPlayedAt'>>): Promise<GuitarSong> {
      const song = await db.get('songs', id);
      if (!song) throw Error(`Нет песни ${id}`);
      const next = { ...song, ...patch, updatedAt: Date.now() };
      await db.put('songs', next);
      return next;
    },

    /** Каскад: песня, её файлы, аранжировки, синхронизации, прогресс, сессии; ссылки из списков. */
    async removeSong(songId: string): Promise<void> {
      const arrIds = (await arrangementsOf(songId)).map((a) => a.id);
      const tx = db.transaction(['songs', 'files', 'arrangements', 'syncs', 'progress', 'sessions', 'lists'], 'readwrite');
      const ops: Promise<unknown>[] = [tx.objectStore('songs').delete(songId)];
      for (const key of await tx.objectStore('files').index('songId').getAllKeys(songId)) ops.push(tx.objectStore('files').delete(key));
      for (const id of arrIds) {
        ops.push(tx.objectStore('arrangements').delete(id), tx.objectStore('progress').delete(id));
        for (const key of await tx.objectStore('sessions').index('arrId').getAllKeys(id)) ops.push(tx.objectStore('sessions').delete(key));
      }
      ops.push(tx.objectStore('syncs').delete(IDBKeyRange.bound(`${songId}:`, `${songId}:￿`)));
      for (const list of await tx.objectStore('lists').getAll()) {
        if (list.songIds.includes(songId)) ops.push(tx.objectStore('lists').put({ ...list, songIds: list.songIds.filter((s) => s !== songId) }));
      }
      await Promise.all([...ops, tx.done]);
    },

    /**
     * Пере-разбор из оригинала, если хоть одна аранжировка собрана старой версией конвертера; правки аппликатуры
     * переносятся на новую разметку (transferUserEdits), неперенесённые — предупреждение.
     */
    async refreshIfStale(songId: string): Promise<{ reparsed: boolean; warnings: ImportWarning[] }> {
      const song = await db.get('songs', songId);
      const old = await arrangementsOf(songId);
      if (!song || !old.some((a) => a.source.converterVersion < CONVERTER_VERSION)) return { reparsed: false, warnings: [] };
      const file = await db.get('files', song.scoreFileId);
      if (!file) throw Error(`Нет оригинала партитуры ${song.scoreFileId}`);
      const encoding = old.find((a) => a.source.encoding)?.source.encoding as ScoreEncoding | undefined;
      const result = await parser.parse({ bytes: new Uint8Array(await file.blob.arrayBuffer()), name: file.name, ...(encoding ? { encoding } : {}) });
      const byId = new Map(old.map((a) => [a.id, a]));
      const warnings: ImportWarning[] = [...result.warnings];
      const arrangements = result.arrangements.map((next) => {
        const prev = byId.get(next.id);
        if (!prev) return next;
        const moved = transferUserEdits(prev, next);
        if (moved.warning) warnings.push(moved.warning);
        return moved.arrangement;
      });
      const tx = db.transaction('arrangements', 'readwrite');
      const gone = old.filter((a) => !arrangements.some((n) => n.id === a.id));
      await Promise.all([...gone.map((a) => tx.store.delete(a.id)), tx.done]);
      await store({ ...result, arrangements }, song);
      return { reparsed: true, warnings };
    },
  };
}

export type GuitarRepo = ReturnType<typeof createRepo>;
