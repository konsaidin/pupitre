// Dev-стенд дорожки (#/guitar/_dev/highway, только DEV): синтетическая карта devMap на 2000 событий, свои часы.
// Space — пауза, T — 3D ↔ табулатура, ←/→ — ±5 с, L — левша. Для бенчей и взгляда на тему Рампы до экрана игры.
import { useEffect, useMemo, useRef, useState } from 'react';
import { devMap } from '../model/devMap';
import { adaptMap } from '../highway/adapter';
import { GuitarHighway, type HighwayView } from '../highway/GuitarHighway';

export function HighwayDev() {
  const adapted = useMemo(() => adaptMap(devMap({ events: 2000 })), []);
  const clock = useRef({ base: 0, startedAt: performance.now(), playing: true });
  const [view, setView] = useState<HighwayView>({ mode: '3d', stringOrder: 'low-top', noteSpeed: 1, gemLabel: 'fret', leftHanded: false });
  const songMs = () => {
    const c = clock.current;
    return c.playing ? c.base + performance.now() - c.startedAt : c.base;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = clock.current;
      const now = songMs();
      if (e.code === 'Space') {
        e.preventDefault();
        Object.assign(c, { base: now, startedAt: performance.now(), playing: !c.playing });
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        Object.assign(c, { base: Math.max(0, now + (e.key === 'ArrowLeft' ? -5000 : 5000)), startedAt: performance.now() });
      } else if (e.key === 't' || e.key === 'T') setView((v) => ({ ...v, mode: v.mode === '3d' ? 'tab' : '3d' }));
      else if (e.key === 'l' || e.key === 'L') setView((v) => ({ ...v, leftHanded: !v.leftHanded }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0 }} data-ui="dev-highway">
      <GuitarHighway adapted={adapted} songMs={songMs} visualOffsetMs={0} view={view} />
    </div>
  );
}
