// Помощник тестов импорта: свои alphaTex-фикстуры (__fixtures__/*.alphatex, MIT) и тот же материал в байтах GP7
// (alphaTex → Score → Gp7Exporter), чтобы проверить путь разбора бинарного формата.
import * as alphaTab from '@coderline/alphatab';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createConverter, type FfScoreNote } from '../vendor/fretfall/fromScore.js';
import { convertScore, type ConvertedScore } from './toArrangement';
import { buildTimeline } from './timeline';
import { parseScore } from './parseScore';
import { sniff } from './sniff';

const DIR = new URL('./__fixtures__/', import.meta.url);
export const FIXTURES = readdirSync(DIR).filter((f) => f.endsWith('.alphatex')).map((f) => f.replace(/\.alphatex$/, '')).sort();
export const fixtureTex = (name: string) => readFileSync(new URL(`${name}.alphatex`, DIR), 'utf8');
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** alphaTex-путь: текст → Score → модель. */
export function convertTex(name: string): ConvertedScore {
  const tex = fixtureTex(name);
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings);
  return convertScore({ score, settings, encoding: 'utf-8', warnings: [] }, { format: 'gp7', fileSha256: sha256(tex) });
}

/** Ноты конвертера fretfall как есть (для реестра R-tech): все поля, которые он реально пишет. */
export function converterNotes(name: string): FfScoreNote[] {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(fixtureTex(name), settings);
  const converter = createConverter(alphaTab);
  converter.prepareScore(score);
  return converter.songFromScore(score, buildTimeline(score, settings).tickLookup).arrangements.flatMap((a) => a.notes);
}

/** Байты GP7 из фикстуры (Gp7Exporter alphaTab пишет GPVersion 8 — sniff видит gp8). */
export function gp7Bytes(name: string): Uint8Array<ArrayBuffer> {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(fixtureTex(name), settings);
  return new alphaTab.exporter.Gp7Exporter().export(score, settings) as Uint8Array<ArrayBuffer>;
}

/** Путь бинарного файла: байты → sniff → parseScore → модель. */
export function convertBytes(bytes: Uint8Array): ConvertedScore {
  const sniffed = sniff(bytes);
  if (!sniffed.ok) throw Error(`sniff: ${sniffed.error} ${sniffed.detail}`);
  return convertScore(parseScore(bytes, sniffed.format), { format: sniffed.format, fileSha256: sha256(bytes) });
}
