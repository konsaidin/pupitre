// Протокол воркера разбора — без alphaTab: его берут и главный поток (репозиторий, клиент), и воркер. alphaTab живёт
// только в воркере (scoreWorkerHandlers.ts), чтобы не попасть в чанк раздела.
import type { GuitarArrangement, ImportWarning, ScoreFormat, ScoreNote } from '../model/types';
import type { ScoreEncoding } from './parseScore';
import type { SniffError } from './sniff';
import type { StereoPcm } from '../backing/render';

/**
 * Поле cmd каждого сообщения протокола. Без него воркер падает: обработчик alphaSynth, который alphaTab ставит при
 * импорте внутри воркера, после своего switch вызывает data.cmd.startsWith(…) без проверки (alphaTab.core.mjs 1.8.4).
 */
export const SCORE_CMD = 'pupitre.score';

/** Байты файла: обычный буфер (не SharedArrayBuffer) — его можно передать воркеру и положить в Blob. */
export type Bytes = Uint8Array<ArrayBuffer>;

export type ImportErrorCode = SniffError | 'parse-failed' | 'no-arrangements' | 'timeout' | 'worker-failed';

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'ImportError';
  }
}

export interface ParseRequest {
  /** Файл партитуры; передаётся воркеру без копии (transfer). */
  bytes?: Bytes;
  /** Демо-песня и фикстуры: текст alphaTex вместо файла. */
  alphaTex?: string;
  name: string;
  /** Ручной выбор кодировки названий GP3–5 (окно импорта, этап 12b). */
  encoding?: ScoreEncoding;
}

export interface ParseResult {
  songId: string;
  fileSha256: string;
  format: ScoreFormat;
  encoding: ScoreEncoding;
  name: string;
  /** Байты оригинала (для alphaTex — экспорт GP7): репозиторий хранит их как файл партитуры. */
  score: Bytes;
  title: string;
  artist: string;
  album?: string;
  arrangements: GuitarArrangement[];
  scoreNotes: ScoreNote[];
  warnings: ImportWarning[];
}

export async function sha256Hex(bytes: Bytes): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Синт-минус (этап 11): партитура → минус (партия игрока заглушена) и гайд (она же соло). */
export interface RenderRequest {
  bytes: Bytes;
  /** Ключ кэша разбора в воркере: перерендер на другой скорости не разбирает файл заново. */
  fileSha256: string;
  encoding?: ScoreEncoding;
  trackIndex: number;
  sampleRate: number;
  speed: number;
  /** Саундфонт (MuseScore General); нет — встроенный SONiVOX. Копия, не передача: главный поток держит свою. */
  soundFont?: Uint8Array;
  /** Кит ударных (AVL Black Pearl); нет — ударные саундфонта. Копия, как и саундфонт. */
  drumKit?: Uint8Array;
}
export interface RenderResult {
  sampleRate: number;
  minus: StereoPcm;
  guide: StereoPcm;
}
