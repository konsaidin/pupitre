// Dev-стенд дорожки (#/guitar/_dev/highway, только DEV): синтетическая карта devMap на 2000 событий, свои часы.
// Space — пауза, T — 3D ↔ табулатура, ←/→ — ±5 с, L — левша, V — имитация судьи (?verdicts=1 — сразу): события по кругу
// получают попадание, «рано −38», «поздно +52», «не та» (на полутон выше) и промах — в те же моменты, что настоящий
// судья (попадание — через 30 мс после удара, не та — по концу окна высоты, промах — после окна). Для бенчей и взгляда на
// тему Рампы и отклик дорожки до экрана игры, без гитары.
import { useEffect, useMemo, useRef, useState } from 'react';
import { devMap } from '../model/devMap';
import { adaptMap, setVerdict } from '../highway/adapter';
import { GuitarHighway, type HighwayView } from '../highway/GuitarHighway';
import { STATUS } from '../vendor/fretfall/highway.js';

/** Вердикт по кругу: код, смещение удара, когда он ясен (мс от начала события). */
const SIM = [
  { code: STATUS.hit, offset: 6, at: 36 },
  { code: STATUS.early, offset: -38, at: -8 },
  { code: STATUS.hit, offset: -12, at: 18 },
  { code: STATUS.late, offset: 52, at: 82 },
  { code: STATUS.wrong, offset: 4, at: 155 },
  { code: STATUS.missed, offset: NaN, at: 330 },
] as const;

export function HighwayDev() {
  const { map, adapted } = useMemo(() => {
    const m = devMap({ events: 2000 });
    return { map: m, adapted: adaptMap(m) };
  }, []);
  const [sim, setSim] = useState(() => /[?&]verdicts=1/.test(location.hash));
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
      else if (e.key === 'v' || e.key === 'V') setSim((on) => !on);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    // статус каждого события у часов — функция времени: перемотка назад сама возвращает «ждёт»
    const apply = (on: boolean) => {
      const now = songMs();
      map.notes.forEach((e, i) => {
        if (e.startMs < now - 3000 || e.startMs > now + 500 || e.judge === 'none' || e.judge === 'tie') return;
        const v = SIM[i % SIM.length];
        const code = on && now >= e.startMs + v.at ? v.code : STATUS.none;
        if (adapted.arr.status[adapted.ffOfEvent[i][0]] === code) return;
        setVerdict(adapted, i, code, v.offset, v.code === STATUS.wrong ? e.notes[0].midi + 1 : NaN);
      });
    };
    // e2e (guitar-verdicts.mjs): партия со статусами и часы стенда — снять вспышку и серую ноту в нужный кадр
    Object.assign(window, { __pupitreDevHighway: { arr: adapted.arr, now: () => songMs() / 1000 } });
    if (!sim) {
      apply(false);
      return;
    }
    const timer = setInterval(() => apply(true), 20);
    return () => clearInterval(timer);
  }, [sim, map, adapted]);
  return (
    <div style={{ position: 'fixed', inset: 0 }} data-ui="dev-highway" data-verdicts={sim ? 'on' : 'off'}>
      <GuitarHighway adapted={adapted} songMs={songMs} visualOffsetMs={0} view={view} />
    </div>
  );
}
