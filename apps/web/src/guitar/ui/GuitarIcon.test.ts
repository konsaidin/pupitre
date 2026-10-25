// Сгенерированный набор иконок Рампы: у каждой есть разметка, залитые рисуются заливкой, подпись — только по запросу.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GUITAR_ICON_NAMES, GUITAR_PATTERNS, GuitarIcon } from './GuitarIcon';

describe('GuitarIcon', () => {
  it('138 иконок Tabler (121 контурная + 17 залитых) и 13 своих c-*', () => {
    expect(GUITAR_ICON_NAMES).toHaveLength(151);
    expect(GUITAR_ICON_NAMES.filter((n) => n.endsWith('-filled'))).toHaveLength(17);
    expect(GUITAR_ICON_NAMES.filter((n) => n.startsWith('c-'))).toHaveLength(13);
  });

  it('каждая иконка рисует фигуры; залитые — с .rp-i--fill, контурные — без', () => {
    for (const name of GUITAR_ICON_NAMES) {
      const html = renderToStaticMarkup(createElement(GuitarIcon, { name }));
      expect(html, name).toMatch(/^<svg class="rp-i( rp-i--fill)?" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><(path|circle|rect|line|polyline|polygon|ellipse|g)\b/);
      expect(html.includes('rp-i--fill'), name).toBe(name.endsWith('-filled'));
    }
  });

  it('размер и подпись: label делает иконку смысловой (role=img), без него — декоративная', () => {
    const labelled = renderToStaticMarkup(createElement(GuitarIcon, { name: 'metronome', size: 'lg', label: 'Метроном' }));
    expect(labelled).toContain('class="rp-i rp-i--lg"');
    expect(labelled).toContain('role="img" aria-label="Метроном"');
    expect(labelled).not.toContain('aria-hidden');
  });

  it('узоры постеров: 4 штуки, своё поле 160×100', () => {
    expect(Object.keys(GUITAR_PATTERNS).sort()).toEqual(['pt-beams', 'pt-horizon', 'pt-rings', 'pt-strings']);
    for (const p of Object.values(GUITAR_PATTERNS)) expect(p.viewBox).toBe('0 0 160 100');
  });
});
