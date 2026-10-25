// Постер Рампы (ui-spec §9 «Постер»): тёмная генеративная картинка — два цветовых пятна по оттенкам, узор pt-* поверх,
// крупный глиф в углу. В вокальном режиме — вместо иллюстраций старой студии (плитки практики, обзор, библиотека).
import type { CSSProperties, ReactNode } from 'react';
import { GUITAR_PATTERNS, type GuitarPatternName } from '../guitar/ui/GuitarIcon';

const PATTERNS = Object.keys(GUITAR_PATTERNS) as GuitarPatternName[];

/** Оттенки и узор — детерминированно по строке (название песни, упражнение). */
export function posterOf(seed: string): { h1: number; h2: number; pattern: GuitarPatternName } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return { h1: h % 360, h2: (h >>> 9) % 360, pattern: PATTERNS[(h >>> 18) % PATTERNS.length] };
}

interface Props {
  seed: string;
  glyph?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function RampaPoster({ seed, glyph, className = '', children }: Props) {
  const { h1, h2, pattern } = posterOf(seed);
  const art = GUITAR_PATTERNS[pattern];
  return (
    <div className={`rp-poster ${className}`} style={{ '--h1': h1, '--h2': h2 } as CSSProperties}>
      <svg className="rp-poster__art" viewBox={art.viewBox} preserveAspectRatio="xMidYMid slice" aria-hidden="true" dangerouslySetInnerHTML={{ __html: art.markup }} />
      {glyph !== undefined && (
        <span className="rp-poster__glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      {children}
    </div>
  );
}
