// Операции воркера разбора — чистый модуль (тестируется в node): parse (сейчас), render (этап 11), digest (этап 34).
// parse: байты партитуры (или alphaTex демо-песни — сначала в GP7 через Gp7Exporter: хранится всегда оригинал файла)
// → sniff → parseScore → convertScore. Ответ — только клонируемые данные: tickLookup/MidiFile (built) не отдаются.
import * as alphaTab from '@coderline/alphatab';
import { parseScore } from './parseScore';
import { renderSong, setDrumKit, setSoundFont, voicesOf, type TrackVoice } from '../backing/render';
import { createConverter } from '../vendor/fretfall/fromScore.js';
import { ImportError, sha256Hex, type Bytes, type ParseRequest, type ParseResult, type RenderRequest, type RenderResult } from './protocol';
import { buildTimeline } from './timeline';
import { sniff } from './sniff';
import { convertScore } from './toArrangement';

export { ImportError, sha256Hex } from './protocol';
export type { Bytes, ImportErrorCode, ParseRequest, ParseResult, RenderRequest, RenderResult } from './protocol';

export async function handleParse(req: ParseRequest): Promise<ParseResult> {
  let bytes = req.bytes;
  if (req.alphaTex !== undefined) {
    const settings = new alphaTab.Settings();
    try {
      bytes = new alphaTab.exporter.Gp7Exporter().export(alphaTab.importer.ScoreLoader.loadAlphaTex(req.alphaTex, settings), settings) as Bytes;
    } catch (e) {
      throw new ImportError('parse-failed', `alphaTex: ${(e as Error).message}`);
    }
  }
  if (!bytes?.length) throw new ImportError('unknown-format', 'пустой файл');
  const sniffed = sniff(bytes);
  if (!sniffed.ok) throw new ImportError(sniffed.error, sniffed.detail);
  const fileSha256 = await sha256Hex(bytes);
  let parsed;
  try {
    parsed = parseScore(bytes, sniffed.format, { encoding: req.encoding });
  } catch (e) {
    throw new ImportError('parse-failed', (e as Error).message);
  }
  const { built, ...converted } = convertScore(parsed, { format: sniffed.format, fileSha256 });
  if (!converted.arrangements.length) throw new ImportError('no-arrangements', 'в файле нет партий со струнами');
  return { ...converted, fileSha256, format: sniffed.format, encoding: parsed.encoding, name: req.name, score: bytes };
}

// Последняя разобранная для рендера партитура: смена скорости не разбирает файл заново.
let rendered: { key: string; score: alphaTab.model.Score; midiFile: alphaTab.midi.MidiFile; voices: TrackVoice[] } | null = null;

export function handleRender(req: RenderRequest): RenderResult {
  const key = `${req.fileSha256}|${req.encoding ?? ''}`;
  if (rendered?.key !== key) {
    const sniffed = sniff(req.bytes);
    if (!sniffed.ok) throw new ImportError(sniffed.error, sniffed.detail);
    const { score, settings } = parseScore(req.bytes, sniffed.format, { encoding: req.encoding });
    createConverter(alphaTab).prepareScore(score);
    rendered = { key, score, midiFile: buildTimeline(score, settings).midiFile, voices: voicesOf(score) };
  }
  if (req.soundFont && req.soundFont.byteLength !== soundFontSize) {
    setSoundFont(req.soundFont);
    soundFontSize = req.soundFont.byteLength;
  }
  if (req.drumKit && req.drumKit.byteLength !== drumKitSize) {
    setDrumKit(req.drumKit);
    drumKitSize = req.drumKit.byteLength;
  }
  if (!rendered.score.tracks[req.trackIndex]) throw new ImportError('parse-failed', `нет дорожки ${req.trackIndex}`);
  return { sampleRate: req.sampleRate, ...renderSong(rendered.midiFile, rendered.voices, req.trackIndex, req.sampleRate, req.speed) };
}

/** Размеры переданных саундфонта и кита: те же — не перезагружаем. */
let soundFontSize = 0;
let drumKitSize = 0;

export type WorkerOp = 'parse' | 'render';

export async function handleRequest(op: string, payload: unknown): Promise<unknown> {
  switch (op) {
    case 'parse':
      return handleParse(payload as ParseRequest);
    case 'render':
      return handleRender(payload as RenderRequest);
    default:
      throw new ImportError('worker-failed', `неизвестная операция ${op}`);
  }
}

/** Что отдать без копии: буфер байтов оригинала, PCM минуса и гайда. */
export function transferablesOf(result: unknown): Transferable[] {
  const r = result as (Partial<ParseResult> & Partial<RenderResult>) | null;
  if (r?.score instanceof Uint8Array) return [r.score.buffer];
  if (r?.minus && r.guide) return [r.minus.left.buffer, r.minus.right.buffer, r.guide.left.buffer, r.guide.right.buffer];
  return [];
}
