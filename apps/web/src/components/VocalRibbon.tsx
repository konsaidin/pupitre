// Лента вокала — главный вид игры (курс 2). Голос рисуется непрерывной лентой:
// вертикальная позиция — сглаженная высота тона, толщина — громкость,
// волнистость — сырой f0 поверх центра (вибрато видно глазом), рваные края и
// тёплый цвет — расщепление. Целевая линия песни — тонкая направляющая под
// лентой, без клавиатуры. Рендер — собственный rAF-цикл, читающий состояние
// движка напрямую (без ре-рендеров React), один canvas.

import { useEffect, useRef } from 'react';
import type { GameEngine } from '../game/engine';
import { t } from '../lib/i18n';
import { midiToName } from '../lib/music';
import { contourMidiAt } from '../lib/pitchline';

interface Props {
  engine: GameEngine;
  window: { lowMidi: number; highMidi: number };
  /** сколько мс видно на экране справа от линии "сейчас" */
  lookaheadMs?: number;
  /** режим «петь по линии»: цель — контур, сегменты нот не рисуются */
  lineMode?: boolean;
}

const NOW_FRAC = 0.3;
const PAD_L = 10;
/** толщина ленты: лог-громкость [-45..-10] dBFS → пиксели */
const LOUD_MIN_DB = -45;
const LOUD_MAX_DB = -10;
const WIDTH_MIN = 3;
const WIDTH_MAX = 22;
/** волнистость: сырой контур поверх центра, кламп защищает от артефактов */
const WIGGLE_CLAMP_SEMIS = 1.5;
/** ступени затухания хвоста по возрасту */
const AGE_BUCKETS = 3;
/** перепад между соседними точками хвоста, при котором ленту рвём:
 *  голос не прыгает на пол-октавы за кадр ~5 мс — это октавный телепорт
 *  свёртки или срыв детектора, тянуть ленту вертикальной «иглой» нельзя */
const TRAIL_BREAK_SEMIS = 6;

const C = {
  bg: '#0d1117',
  octaveLine: 'rgba(255,255,255,0.10)',
  octaveText: 'rgba(230,235,245,0.35)',
  guide: 'rgba(90,111,168,0.9)',
  guideDim: 'rgba(90,111,168,0.45)',
  guideActive: '#5a79c9',
  ghost: 'rgba(160,170,200,0.30)',
  hitFill: '#2ea86f',
  perfect: '#38d98c',
  good: '#e8c34a',
  miss: '#e05f5f',
  contour: 'rgba(34,211,238,0.65)',
  contourDim: 'rgba(34,211,238,0.25)',
  nowLine: 'rgba(255,255,255,0.35)',
  text: 'rgba(230,235,245,0.85)',
  badgeBg: 'rgba(20,26,38,0.85)',
  vibBadge: '#22d3ee',
  distBadge: '#ff9840',
};

/** Цвет ленты: мимо — серо-голубой, в допуске — зелёный, расщепление — тёплый. */
function ribbonColor(inTol: boolean, dist: number): [number, number, number] {
  const base: [number, number, number] = inTol ? [56, 217, 140] : [165, 175, 200];
  const warm: [number, number, number] = [255, 152, 64];
  const k = Math.min(1, dist);
  return [
    Math.round(base[0] + (warm[0] - base[0]) * k),
    Math.round(base[1] + (warm[1] - base[1]) * k),
    Math.round(base[2] + (warm[2] - base[2]) * k),
  ];
}

/** Детерминированный шум для рваных краёв (без Math.random в кадре). */
function jag(i: number): number {
  return (((i * 7919) % 13) / 13 - 0.5) * 2;
}

export function VocalRibbon({ engine, window: win, lookaheadMs = 4000, lineMode = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx2d = canvas.getContext('2d')!;
    let raf = 0;
    let W = 0;
    let H = 0;
    let dpr = 1;

    const semis = win.highMidi - win.lowMidi + 1;
    const midiToY = (midi: number) => H - ((midi - win.lowMidi + 0.5) * H) / semis;

    // статичный слой: только октавные ориентиры (C-линии) с подписями
    const staticLayer = document.createElement('canvas');
    const renderStatic = () => {
      staticLayer.width = canvas.width;
      staticLayer.height = canvas.height;
      const s = staticLayer.getContext('2d')!;
      s.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.fillStyle = C.bg;
      s.fillRect(0, 0, W, H);
      s.font = '11px system-ui, sans-serif';
      s.textBaseline = 'bottom';
      for (let m = win.lowMidi; m <= win.highMidi; m++) {
        if (m % 12 !== 0) continue;
        const y = midiToY(m);
        s.strokeStyle = C.octaveLine;
        s.beginPath();
        s.moveTo(PAD_L, y);
        s.lineTo(W, y);
        s.stroke();
        s.fillStyle = C.octaveText;
        s.fillText(midiToName(m), PAD_L, y - 2);
      }
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      renderStatic();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const loudToW = (db: number) => {
      const k = Math.min(1, Math.max(0, (db - LOUD_MIN_DB) / (LOUD_MAX_DB - LOUD_MIN_DB)));
      return WIDTH_MIN + (WIDTH_MAX - WIDTH_MIN) * k;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      engine.tick();
      const songMs = engine.songMs();
      const nowX = PAD_L + (W - PAD_L) * NOW_FRAC;
      const pxPerMs = (W - nowX) / lookaheadMs;
      const msToX = (ms: number) => nowX + (ms - songMs) * pxPerMs;
      const trailMs = (nowX - PAD_L) / pxPerMs; // сколько истории помещается слева

      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.drawImage(staticLayer, 0, 0);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

      // призрачные сегменты (что играет синт в упражнениях на слух)
      if (engine.map.guideEvents) {
        ctx2d.strokeStyle = C.ghost;
        ctx2d.lineWidth = 2;
        ctx2d.setLineDash([4, 4]);
        for (const g of engine.map.guideEvents) {
          const x1 = msToX(g.startMs);
          const x2 = msToX(g.startMs + g.durMs);
          if (x2 < PAD_L || x1 > W) continue;
          const y = midiToY(g.midi);
          ctx2d.beginPath();
          ctx2d.moveTo(Math.max(x1, PAD_L), y);
          ctx2d.lineTo(x2, y);
          ctx2d.stroke();
        }
        ctx2d.setLineDash([]);
      }

      // направляющая: тонкие сегменты нот (в режиме линии — контур вокала)
      const notes = engine.map.notes;
      if (!lineMode) {
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          const x1 = msToX(n.startMs);
          const x2 = msToX(n.startMs + n.durMs);
          if (x2 < PAD_L || x1 > W) continue;
          const y = midiToY(n.midi);
          const active = songMs >= n.startMs && songMs < n.startMs + n.durMs;
          const res = engine.results[i];
          let color = active ? C.guideActive : x2 < nowX ? C.guideDim : C.guide;
          if (res) color = res.judgement === 'perfect' ? C.perfect : res.judgement === 'good' ? C.good : C.miss;
          ctx2d.strokeStyle = color;
          ctx2d.lineWidth = active ? 4 : 3;
          ctx2d.lineCap = 'round';
          ctx2d.beginPath();
          ctx2d.moveTo(Math.max(x1, PAD_L), y);
          ctx2d.lineTo(x2, y);
          ctx2d.stroke();
          // заливка прогресса попадания на активной ноте
          if (active) {
            const hit = engine.noteHitRatio(i);
            if (hit > 0) {
              ctx2d.strokeStyle = C.hitFill;
              ctx2d.lineWidth = 6;
              ctx2d.beginPath();
              ctx2d.moveTo(Math.max(x1, PAD_L), y);
              ctx2d.lineTo(Math.max(x1, PAD_L) + (x2 - Math.max(x1, PAD_L)) * hit, y);
              ctx2d.stroke();
            }
          }
          const label = n.vibrato && !n.lyric?.includes('〜') ? `${n.lyric ?? ''}〜` : n.lyric;
          if (label && x2 - x1 > 20) {
            ctx2d.fillStyle = C.text;
            ctx2d.font = '12px system-ui, sans-serif';
            ctx2d.textBaseline = 'top';
            ctx2d.fillText(label, Math.max(x1, PAD_L) + 2, y + 7);
          }
        }
        ctx2d.lineWidth = 1;
      }

      // контур извлечённого вокала (режим линии: он и есть цель)
      const line = engine.map.pitchline;
      if (lineMode && line && line.midi.length > 0) {
        const leftMs = songMs - trailMs;
        const rightMs = songMs + lookaheadMs;
        const i0 = Math.max(0, Math.floor(leftMs / line.hopMs) - 1);
        const i1 = Math.min(line.midi.length - 1, Math.ceil(rightMs / line.hopMs) + 1);
        const path = new Path2D();
        let pen = false;
        let prevM = 0;
        for (let i = i0; i <= i1; i++) {
          const m = line.midi[i];
          if (m === null) {
            pen = false;
            continue;
          }
          const x = msToX(i * line.hopMs);
          const y = midiToY(m);
          // октавный срыв в данных контура — рвём, как и ленту
          if (!pen || Math.abs(m - prevM) >= TRAIL_BREAK_SEMIS) {
            path.moveTo(x, y);
            pen = true;
          } else {
            path.lineTo(x, y);
          }
          prevM = m;
        }
        ctx2d.lineCap = 'round';
        ctx2d.lineJoin = 'round';
        ctx2d.strokeStyle = C.contourDim;
        ctx2d.lineWidth = 5;
        ctx2d.stroke(path);
        ctx2d.strokeStyle = C.contour;
        ctx2d.lineWidth = 2;
        ctx2d.stroke(path);
        ctx2d.lineWidth = 1;

        // шарик-ориентир на линии «сейчас»
        const cm = contourMidiAt(line, Math.max(0, songMs));
        if (cm !== null) {
          const y = midiToY(cm);
          if (y >= -4 && y <= H + 4) {
            ctx2d.fillStyle = C.contour;
            ctx2d.beginPath();
            ctx2d.arc(nowX, y, 5, 0, Math.PI * 2);
            ctx2d.fill();
          }
        }
      }

      // ЛЕНТА: полигоны-квады между соседними точками хвоста, сгруппированные
      // в бакеты (возраст × попадание × расщепление) — по fill() на бакет,
      // а не на сегмент; аллокаций в кадре — только Path2D бакетов
      const trail = engine.trail;
      const ribbonPaths: (Path2D | undefined)[] = [];
      let px = 0;
      let py = 0;
      let pw = 0;
      let pj = 0;
      let pMidi = 0;
      let hasPrev = false;
      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i];
        const age = songMs - p.songMs;
        if (age > trailMs) break;
        const x = msToX(p.songMs);
        if (x < PAD_L) break;
        const wiggle = Math.max(-WIGGLE_CLAMP_SEMIS, Math.min(WIGGLE_CLAMP_SEMIS, p.rawOffset));
        const y = midiToY(p.midi + wiggle);
        const w = loudToW(p.loudDb);
        const j = p.distortion > 0.25 ? jag(i) * (2 + 4 * p.distortion) : 0;
        if (hasPrev && Math.abs(px - x) < 40 && Math.abs(pMidi - p.midi) < TRAIL_BREAK_SEMIS) {
          const ageB = Math.min(AGE_BUCKETS - 1, Math.floor((age / trailMs) * AGE_BUCKETS));
          const bucket =
            ageB + (p.inTolerance ? AGE_BUCKETS : 0) + (p.distortion > 0.4 ? AGE_BUCKETS * 2 : 0);
          const path = (ribbonPaths[bucket] ??= new Path2D());
          path.moveTo(px, py - pw / 2 + pj);
          path.lineTo(x, y - w / 2 + j);
          path.lineTo(x, y + w / 2 - j);
          path.lineTo(px, py + pw / 2 - pj);
          path.closePath();
        }
        px = x;
        py = y;
        pw = w;
        pj = j;
        pMidi = p.midi;
        hasPrev = true;
      }
      for (let b = 0; b < AGE_BUCKETS * 4; b++) {
        const path = ribbonPaths[b];
        if (!path) continue;
        const inTol = Math.floor(b / AGE_BUCKETS) % 2 === 1;
        const dist = b >= AGE_BUCKETS * 2 ? 0.8 : 0;
        const [r, g, bl] = ribbonColor(inTol, dist);
        const alpha = 0.9 - (b % AGE_BUCKETS) * 0.28;
        ctx2d.fillStyle = `rgba(${r},${g},${bl},${alpha})`;
        ctx2d.fill(path);
      }

      // линия «сейчас»
      ctx2d.strokeStyle = C.nowLine;
      ctx2d.setLineDash([6, 4]);
      ctx2d.beginPath();
      ctx2d.moveTo(nowX, 0);
      ctx2d.lineTo(nowX, H);
      ctx2d.stroke();
      ctx2d.setLineDash([]);

      // голова ленты: кружок с радиусом от громкости
      const lf = engine.lastFrame;
      const la = engine.lastAnalysis;
      if (lf && lf.voiced && !Number.isNaN(lf.midi)) {
        const y = midiToY(lf.midi);
        if (y < -4) drawArrow(ctx2d, nowX, 14, 'up');
        else if (y > H + 4) drawArrow(ctx2d, nowX, H - 14, 'down');
        else {
          const rad = la ? Math.max(4, loudToW(la.loudDb) / 2 + 2) : 6;
          const [r, g, bl] = ribbonColor(
            lf.cents !== null && Math.abs(lf.cents) <= 100,
            la?.distortion.score ?? 0,
          );
          ctx2d.fillStyle = `rgb(${r},${g},${bl})`;
          ctx2d.beginPath();
          ctx2d.arc(nowX, y, rad, 0, Math.PI * 2);
          ctx2d.fill();
        }
      }

      // бейджи техник над лентой у линии «сейчас»
      if (la && lf?.voiced) {
        let badgeY = 12;
        if (la.vibrato.active) {
          badgeY = drawBadge(
            ctx2d,
            nowX + 12,
            badgeY,
            `〜 ${t('vibrato')} ${la.vibrato.rateHz.toFixed(1)} ${t('Hz')} · ${Math.round(la.vibrato.depthCents)}¢`,
            C.vibBadge,
          );
        }
        if (la.distortion.active) {
          drawBadge(ctx2d, nowX + 12, badgeY, `⚡ ${t('rasp')}`, C.distBadge);
        }
      }

      // всплывающие вердикты (без slice — аллокаций в кадре быть не должно)
      const js = engine.judgements;
      for (let k = Math.max(0, js.length - 6); k < js.length; k++) {
        const jd = js[k];
        const age = songMs - jd.atMs;
        if (age < 0 || age > 800) continue;
        const n = notes[jd.noteIndex];
        const x = msToX(n.startMs + n.durMs);
        const y = midiToY(n.midi) - 14 - (age / 800) * 22;
        ctx2d.globalAlpha = 1 - age / 800;
        ctx2d.font = 'bold 14px system-ui, sans-serif';
        ctx2d.fillStyle = jd.judgement === 'perfect' ? C.perfect : jd.judgement === 'good' ? C.good : C.miss;
        const label = jd.judgement === 'perfect' ? 'Perfect!' : jd.judgement === 'good' ? 'Good' : 'Miss';
        ctx2d.fillText(jd.points > 0 ? `${label} +${jd.points}` : label, x, y);
        ctx2d.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [engine, win.lowMidi, win.highMidi, lookaheadMs, lineMode]);

  return (
    <div ref={wrapRef} className="pianoroll-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}

/** Бейдж техники; возвращает y для следующего бейджа. */
function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string): number {
  ctx.font = '12px system-ui, sans-serif';
  const w = ctx.measureText(label).width + 14;
  const h = 20;
  ctx.fillStyle = 'rgba(20,26,38,0.85)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 7, y + h / 2 + 0.5);
  return y + h + 6;
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 'up' | 'down') {
  ctx.fillStyle = '#e8c34a';
  ctx.beginPath();
  const s = dir === 'up' ? -1 : 1;
  ctx.moveTo(x, y + 8 * s);
  ctx.lineTo(x - 7, y - 6 * s);
  ctx.lineTo(x + 7, y - 6 * s);
  ctx.closePath();
  ctx.fill();
}
