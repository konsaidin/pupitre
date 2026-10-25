// Формат партитуры — по содержимому, а не по имени файла (02-stages.md, этап 6a). Zip (GP7/8, MXL) проверяется по
// центральному каталогу через fflate без распаковки: лимиты числа записей, размеров и коэффициента сжатия режут
// zip-бомбы до того, как что-либо распаковано.
import { unzipSync, type UnzipFileInfo } from 'fflate';
import type { ScoreFormat } from '../model/types';

export const SNIFF_LIMITS = {
  /** Партитура целиком. */
  fileBytes: 20 * 1024 * 1024,
  zipEntries: 2000,
  /** Одна запись zip, распакованная. */
  entryBytes: 50 * 1024 * 1024,
  /** Сумма распакованных записей. */
  totalBytes: 100 * 1024 * 1024,
  /** Распакованный ÷ сжатый, по записи. */
  ratio: 200,
} as const;

export type SniffError = 'too-large' | 'zip-too-large' | 'unknown-format' | 'midi-not-yet' | 'damaged';
export type SniffResult = { ok: true; format: ScoreFormat } | { ok: false; error: SniffError; detail: string };

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
const startsWith = (bytes: Uint8Array, magic: string) => bytes.length >= magic.length && ascii(bytes, 0, magic.length) === magic;

export function sniff(bytes: Uint8Array): SniffResult {
  if (bytes.length > SNIFF_LIMITS.fileBytes)
    return { ok: false, error: 'too-large', detail: `${bytes.length} Б > ${SNIFF_LIMITS.fileBytes} Б` };
  // GP3–5: первый байт — длина строки версии, затем «FICHIER GUITAR PRO v5.00» (у старых — «GUITARE»).
  if (bytes.length > 31) {
    const version = /^FICHIER GUITARE? PRO v([345])\.\d\d/.exec(ascii(bytes, 1, 1 + Math.min(bytes[0], 30)));
    if (version) return { ok: true, format: `gp${version[1]}` as ScoreFormat };
  }
  if (startsWith(bytes, 'BCFZ') || startsWith(bytes, 'BCFS')) return { ok: true, format: 'gpx' };
  if (startsWith(bytes, 'PK\x03\x04')) return sniffZip(bytes);
  if (startsWith(bytes, 'MThd')) return { ok: false, error: 'midi-not-yet', detail: 'MIDI-файлы — на этапе 22' };
  // MusicXML: корень score-partwise/score-timewise в начале текста (BOM и пролог XML пропускаются).
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 64 * 1024)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<') && /<score-(?:partwise|timewise)[\s>]/.test(head)) return { ok: true, format: 'musicxml' };
  return { ok: false, error: 'unknown-format', detail: 'не Guitar Pro, не MusicXML' };
}

function sniffZip(bytes: Uint8Array): SniffResult {
  const entries: UnzipFileInfo[] = [];
  let total = 0;
  let problem: string | null = null;
  try {
    // filter вызывается на каждую запись каталога; false — запись не распаковывается.
    unzipSync(bytes, {
      filter: (file) => {
        if (problem) return false;
        entries.push(file);
        total += file.originalSize;
        if (entries.length > SNIFF_LIMITS.zipEntries) problem = `записей больше ${SNIFF_LIMITS.zipEntries}`;
        else if (file.originalSize > SNIFF_LIMITS.entryBytes) problem = `${file.name}: ${file.originalSize} Б распакованных`;
        else if (total > SNIFF_LIMITS.totalBytes) problem = `сумма распакованных больше ${SNIFF_LIMITS.totalBytes} Б`;
        else if (file.originalSize > SNIFF_LIMITS.ratio * Math.max(1, file.size)) problem = `${file.name}: сжатие больше ${SNIFF_LIMITS.ratio}×`;
        return false;
      },
    });
  } catch (e) {
    return { ok: false, error: 'damaged', detail: `zip не читается: ${(e as Error).message}` };
  }
  if (problem) return { ok: false, error: 'zip-too-large', detail: problem };
  const names = new Set(entries.map((e) => e.name));
  if (names.has('Content/score.gpif')) {
    // GP7 и GP8 различаются версией в самом score.gpif; запись уже прошла лимиты — её можно распаковать.
    const gpif = unzipSync(bytes, { filter: (f) => f.name === 'Content/score.gpif' })['Content/score.gpif'];
    const major = /<GPVersion>\s*(\d+)/.exec(new TextDecoder('utf-8').decode(gpif.subarray(0, 64 * 1024)))?.[1];
    return { ok: true, format: major === '8' ? 'gp8' : 'gp7' };
  }
  if (names.has('META-INF/container.xml')) return { ok: true, format: 'mxl' };
  return { ok: false, error: 'unknown-format', detail: 'zip без Content/score.gpif и META-INF/container.xml' };
}
