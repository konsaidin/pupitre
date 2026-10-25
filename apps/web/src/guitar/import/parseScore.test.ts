// Выбор кодировки названий GP3–5: меньше «�», при равенстве — меньше слов смешанного письма.
import { describe, expect, it } from 'vitest';
import { implausibility } from './parseScore';

const decode = (bytes: number[], encoding: string) => new TextDecoder(encoding).decode(new Uint8Array(bytes));
// «Привет мир» и «Café déjà vu» в однобайтовых кодировках.
const CP1251 = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0];
const CP1252 = [0x43, 0x61, 0x66, 0xe9, 0x20, 0x64, 0xe9, 0x6a, 0xe0, 0x20, 0x76, 0x75];

describe('implausibility', () => {
  it('UTF-8 на однобайтовых строках даёт «�» — повод пробовать другие кодировки', () => {
    expect(implausibility([decode(CP1251, 'utf-8')])[0]).toBeGreaterThan(0);
    expect(implausibility([decode(CP1252, 'utf-8')])[0]).toBeGreaterThan(0);
  });

  it('кириллица: windows-1251 правдоподобнее windows-1252', () => {
    const [a, b] = [implausibility([decode(CP1251, 'windows-1251')]), implausibility([decode(CP1251, 'windows-1252')])];
    expect(a).toEqual([0, 0]);
    expect(b[0] === 0 && b[1] > 0).toBe(true);
  });

  it('латиница с диакритикой: windows-1252 правдоподобнее windows-1251', () => {
    const [a, b] = [implausibility([decode(CP1252, 'windows-1252')]), implausibility([decode(CP1252, 'windows-1251')])];
    expect(a).toEqual([0, 0]);
    expect(b[0] === 0 && b[1] > 0).toBe(true);
  });
});
