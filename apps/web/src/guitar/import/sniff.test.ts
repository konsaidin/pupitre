// Формат — по содержимому: реестр входов с НЕВЕРНЫМИ расширениями → ожидаемый формат, N/N; zip-бомбы отвергаются по
// каталогу, без распаковки.
import * as alphaTab from '@coderline/alphatab';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { sniff, SNIFF_LIMITS } from './sniff';

const gpHeader = (version: string) => {
  const text = `FICHIER GUITAR PRO ${version}`;
  const bytes = new Uint8Array(64);
  bytes[0] = text.length;
  bytes.set(strToU8(text), 1);
  return bytes;
};
const gp7 = () => {
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex('\\track "G"\n\\staff {tabs}\n3.6.4 0.5.4 r.2', new alphaTab.Settings());
  return new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
};
const gpifZip = (version: string) =>
  zipSync({ 'VERSION': strToU8('7.0'), 'Content/score.gpif': strToU8(`<?xml version="1.0"?><GPIF><GPVersion>${version}</GPVersion></GPIF>`) });
const MUSICXML = '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "x">\n<score-partwise version="4.0"><part-list/></score-partwise>';

// Реестр входов: имя (расширение намеренно неверное) → содержимое → ожидаемый исход.
const REGISTRY: Array<[string, () => Uint8Array, string]> = [
  ['song.xml', () => gpHeader('v3.00'), 'gp3'],
  ['song.gp5', () => gpHeader('v4.06'), 'gp4'],
  ['song.gp3', () => gpHeader('v5.10'), 'gp5'],
  ['song.gp', () => strToU8('BCFZ\0\0\0\0'), 'gpx'],
  ['song.gpx', () => strToU8('BCFS\0\0\0\0'), 'gpx'],
  // Gp7Exporter alphaTab пишет GPVersion 8.1.3 — по содержимому это GP8.
  ['song.mxl', gp7, 'gp8'],
  ['song.gp8', () => gpifZip('7.6.0'), 'gp7'],
  ['song.gp7', () => gpifZip('8.1.3'), 'gp8'],
  ['song.gp8', () => zipSync({ 'META-INF/container.xml': strToU8('<container/>'), 'score.xml': strToU8('<score-partwise/>') }), 'mxl'],
  ['song.gp', () => strToU8(MUSICXML), 'musicxml'],
  ['song.musicxml', () => strToU8('<score-timewise version="3.1"></score-timewise>'), 'musicxml'],
  ['song.gp5', () => strToU8('MThd\0\0\0\x06\0\x01\0\x02\x01\xE0'), 'midi-not-yet'],
  ['song.gp5', () => strToU8('<html><body>не партитура</body></html>'), 'unknown-format'],
  ['song.gp7', () => zipSync({ 'readme.txt': strToU8('zip без партитуры') }), 'unknown-format'],
  ['song.gp', () => new Uint8Array(SNIFF_LIMITS.fileBytes + 1), 'too-large'],
];

describe('sniff — формат по содержимому', () => {
  it(`реестр ${REGISTRY.length}/${REGISTRY.length}: каждый вход распознан ожидаемо, имя файла не влияет`, () => {
    const got = REGISTRY.map(([name, bytes]) => {
      const r = sniff(bytes());
      return [name, r.ok ? r.format : r.error];
    });
    expect(got).toEqual(REGISTRY.map(([name, , want]) => [name, want]));
  });
});

// Подмена размеров записи в центральном каталоге zip (как у бомбы), без самих данных.
function claimSizes(zip: Uint8Array, originalSize: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++) if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, originalSize, true);
  return out;
}

describe('sniff — лимиты zip без распаковки', () => {
  it('10 000 записей → zip-too-large', () => {
    const files: Record<string, Uint8Array> = { 'Content/score.gpif': strToU8('<GPIF/>') };
    for (let i = 0; i < 10_000; i++) files[`Content/pad/${i}.bin`] = new Uint8Array(1);
    const r = sniff(zipSync(files, { level: 0 }));
    expect(r).toMatchObject({ ok: false, error: 'zip-too-large' });
  });

  it('1 ГБ распакованного по каталогу → отвергнуто за миллисекунды, без распаковки', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 20; i++) files[`Content/part${i}.bin`] = new Uint8Array(64);
    const bomb = claimSizes(zipSync(files), 50 * 1024 * 1024); // 20 × 50 МБ = 1 ГБ
    const t0 = performance.now();
    const r = sniff(bomb);
    expect(r).toMatchObject({ ok: false, error: 'zip-too-large' });
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('коэффициент сжатия больше 200 → отвергнуто', () => {
    const zip = claimSizes(zipSync({ 'Content/score.gpif': new Uint8Array(1000) }), 10 * 1024 * 1024);
    expect(sniff(zip)).toMatchObject({ ok: false, error: 'zip-too-large', detail: expect.stringContaining('сжатие') });
  });

  it('битый zip → damaged, а не исключение', () => {
    const zip = zipSync({ 'Content/score.gpif': strToU8('<GPIF/>') });
    expect(sniff(zip.slice(0, zip.length - 10))).toMatchObject({ ok: false, error: 'damaged' });
  });
});
