// Пиано-ролл: canvas с бегущими нотами, окном по диапазону пользователя,
// линией голоса и мини-клавиатурой слева. Рендер — собственный rAF-цикл,
// читающий состояние движка напрямую (без ре-рендеров React).

import { useEffect, useRef } from 'react';
import type { GameEngine } from '../game/engine';
import { isBlackKey, midiToName } from '../lib/music';
import { contourMidiAt } from '../lib/pitchline';

interface Props {
  engine: GameEngine;
  window: { lowMidi: number; highMidi: number };
  /** сколько мс видно на экране справа от линии "сейчас" */
  lookaheadMs?: number;
  /** показывать контур извлечённого вокала (дорожку + шарик-ориентир) */
  showPitchline?: boolean;
}

const KEYBOARD_W = 56;
const NOW_FRAC = 0.3;
const TRAIL_MS = 3000;

const C = {
  bg: '#0d1117',
  rowWhite: 'rgba(255,255,255,0.030)',
  rowLine: 'rgba(255,255,255,0.055)',
  octaveLine: 'rgba(255,255,255,0.16)',
  note: '#3b4c7a',
  noteBorder: '#5a6fa8',
  noteActive: '#5a79c9',
  ghost: 'rgba(160,170,200,0.16)',
  hit: '#2ea86f',
  perfect: '#38d98c',
  good: '#e8c34a',
  miss: '#e05f5f',
  trailHit: '#38d98c',
  trailMiss: 'rgba(200,205,215,0.55)',
  pitch: '#22d3ee',
  pitchDim: 'rgba(34,211,238,0.35)',
  nowLine: 'rgba(255,255,255,0.35)',
  text: 'rgba(230,235,245,0.85)',
  textDim: 'rgba(230,235,245,0.45)',
};

export function PianoRoll({ engine, window: win, lookaheadMs = 4000, showPitchline = true }: Props) {
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

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const semis = win.highMidi - win.lowMidi + 1;
    const midiToY = (midi: number) => {
      const rowH = H / semis;
      return H - (midi - win.lowMidi + 0.5) * rowH;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      engine.tick();
      const songMs = engine.songMs();
      const rowH = H / semis;
      const nowX = KEYBOARD_W + (W - KEYBOARD_W) * NOW_FRAC;
      const pxPerMs = (W - nowX) / lookaheadMs;
      const msToX = (ms: number) => nowX + (ms - songMs) * pxPerMs;

      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.fillStyle = C.bg;
      ctx2d.fillRect(0, 0, W, H);

      // фон строк и клавиатура
      for (let m = win.lowMidi; m <= win.highMidi; m++) {
        const y = midiToY(m) - rowH / 2;
        if (!isBlackKey(m)) {
          ctx2d.fillStyle = C.rowWhite;
          ctx2d.fillRect(KEYBOARD_W, y, W - KEYBOARD_W, rowH);
        }
        ctx2d.strokeStyle = m % 12 === 0 ? C.octaveLine : C.rowLine;
        ctx2d.beginPath();
        ctx2d.moveTo(KEYBOARD_W, y + rowH);
        ctx2d.lineTo(W, y + rowH);
        ctx2d.stroke();
        // клавиша
        ctx2d.fillStyle = isBlackKey(m) ? '#1a1f2b' : '#e8eaf0';
        ctx2d.fillRect(0, y + 0.5, KEYBOARD_W - 6, rowH - 1);
        if (m % 12 === 0 || rowH > 16) {
          ctx2d.fillStyle = isBlackKey(m) ? C.textDim : '#333a4d';
          ctx2d.font = `${Math.min(11, rowH - 3)}px system-ui, sans-serif`;
          ctx2d.textBaseline = 'middle';
          ctx2d.fillText(midiToName(m), 4, y + rowH / 2 + 0.5);
        }
      }

      // призрачные плашки (что играет синт в упражнениях на слух)
      if (engine.map.guideEvents) {
        for (const g of engine.map.guideEvents) {
          const x1 = msToX(g.startMs);
          const x2 = msToX(g.startMs + g.durMs);
          if (x2 < KEYBOARD_W || x1 > W) continue;
          const y = midiToY(g.midi);
          ctx2d.fillStyle = C.ghost;
          roundRect(ctx2d, Math.max(x1, KEYBOARD_W), y - rowH * 0.38, Math.max(2, x2 - x1), rowH * 0.76, 4);
          ctx2d.fill();
        }
      }

      // ноты
      const notes = engine.map.notes;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const x1 = msToX(n.startMs);
        const x2 = msToX(n.startMs + n.durMs);
        if (x2 < KEYBOARD_W || x1 > W) continue;
        const y = midiToY(n.midi);
        const h = Math.max(6, rowH * 0.72);
        const active = songMs >= n.startMs && songMs < n.startMs + n.durMs;
        const res = engine.results[i];

        let fill = active ? C.noteActive : C.note;
        let border = C.noteBorder;
        if (res) {
          border = res.judgement === 'perfect' ? C.perfect : res.judgement === 'good' ? C.good : C.miss;
          fill = res.judgement === 'miss' ? 'rgba(224,95,95,0.25)' : 'rgba(46,168,111,0.35)';
        }
        ctx2d.fillStyle = fill;
        roundRect(ctx2d, Math.max(x1, KEYBOARD_W), y - h / 2, Math.max(3, x2 - x1), h, 5);
        ctx2d.fill();
        ctx2d.strokeStyle = border;
        ctx2d.lineWidth = active ? 2 : 1;
        ctx2d.stroke();
        ctx2d.lineWidth = 1;

        // заливка прогресса попадания на активной ноте
        if (active) {
          const hit = engine.noteHitRatio(i);
          if (hit > 0) {
            ctx2d.fillStyle = C.hit;
            roundRect(ctx2d, Math.max(x1, KEYBOARD_W), y - h / 2, Math.max(3, (x2 - x1) * hit), h, 5);
            ctx2d.fill();
          }
        }

        if (n.lyric && x2 - x1 > 20) {
          ctx2d.fillStyle = C.text;
          ctx2d.font = '12px system-ui, sans-serif';
          ctx2d.textBaseline = 'top';
          ctx2d.fillText(n.lyric, Math.max(x1, KEYBOARD_W) + 4, y + h / 2 + 3);
        }
      }

      // контур извлечённого вокала — «дорожка», по которой едет шарик-ориентир
      const line = engine.map.pitchline;
      if (showPitchline && line && line.midi.length > 0) {
        const leftMs = songMs + (KEYBOARD_W - nowX) / pxPerMs;
        const rightMs = songMs + lookaheadMs;
        const i0 = Math.max(0, Math.floor(leftMs / line.hopMs) - 1);
        const i1 = Math.min(line.midi.length - 1, Math.ceil(rightMs / line.hopMs) + 1);
        ctx2d.lineWidth = 2.5;
        ctx2d.lineCap = 'round';
        ctx2d.lineJoin = 'round';
        ctx2d.strokeStyle = C.pitch;
        ctx2d.shadowColor = C.pitch;
        ctx2d.shadowBlur = 6;
        ctx2d.beginPath();
        let pen = false;
        for (let i = i0; i <= i1; i++) {
          const m = line.midi[i];
          if (m === null) {
            pen = false;
            continue;
          }
          const x = msToX(i * line.hopMs);
          const y = midiToY(m);
          if (!pen) {
            ctx2d.moveTo(x, y);
            pen = true;
          } else {
            ctx2d.lineTo(x, y);
          }
        }
        ctx2d.stroke();
        ctx2d.shadowBlur = 0;
        ctx2d.lineWidth = 1;

        // шарик-ориентир на линии «сейчас»
        const cm = contourMidiAt(line, Math.max(0, songMs));
        if (cm !== null) {
          const y = midiToY(cm);
          if (y >= -4 && y <= H + 4) {
            ctx2d.fillStyle = C.pitch;
            ctx2d.shadowColor = C.pitch;
            ctx2d.shadowBlur = 12;
            ctx2d.beginPath();
            ctx2d.arc(nowX, y, 5, 0, Math.PI * 2);
            ctx2d.fill();
            ctx2d.shadowBlur = 0;
          }
        }
      }

      // линия голоса (хвост)
      const trail = engine.trail;
      ctx2d.lineWidth = 2.5;
      ctx2d.lineCap = 'round';
      let prev: { x: number; y: number; hit: boolean } | null = null;
      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i];
        if (songMs - p.songMs > TRAIL_MS) break;
        const x = msToX(p.songMs);
        if (x < KEYBOARD_W) break;
        const y = midiToY(p.midi);
        if (prev && Math.abs(prev.x - x) < 40) {
          ctx2d.strokeStyle = p.inTolerance ? C.trailHit : C.trailMiss;
          ctx2d.globalAlpha = Math.max(0.15, 1 - (songMs - p.songMs) / TRAIL_MS);
          ctx2d.beginPath();
          ctx2d.moveTo(prev.x, prev.y);
          ctx2d.lineTo(x, y);
          ctx2d.stroke();
        }
        prev = { x, y, hit: p.inTolerance };
      }
      ctx2d.globalAlpha = 1;
      ctx2d.lineWidth = 1;

      // линия «сейчас» и текущая точка голоса
      ctx2d.strokeStyle = C.nowLine;
      ctx2d.setLineDash([6, 4]);
      ctx2d.beginPath();
      ctx2d.moveTo(nowX, 0);
      ctx2d.lineTo(nowX, H);
      ctx2d.stroke();
      ctx2d.setLineDash([]);

      const lf = engine.lastFrame;
      if (lf && lf.voiced && !Number.isNaN(lf.midi)) {
        const y = midiToY(lf.midi);
        if (y < -4) drawArrow(ctx2d, nowX, 14, 'up');
        else if (y > H + 4) drawArrow(ctx2d, nowX, H - 14, 'down');
        else {
          ctx2d.fillStyle = lf.cents !== null && Math.abs(lf.cents) <= 100 ? C.trailHit : '#e8eaf0';
          ctx2d.beginPath();
          ctx2d.arc(nowX, y, 6, 0, Math.PI * 2);
          ctx2d.fill();
        }
      }

      // всплывающие вердикты
      for (const j of engine.judgements.slice(-6)) {
        const age = songMs - j.atMs;
        if (age < 0 || age > 800) continue;
        const n = notes[j.noteIndex];
        const x = msToX(n.startMs + n.durMs);
        const y = midiToY(n.midi) - 14 - (age / 800) * 22;
        ctx2d.globalAlpha = 1 - age / 800;
        ctx2d.font = 'bold 14px system-ui, sans-serif';
        ctx2d.fillStyle = j.judgement === 'perfect' ? C.perfect : j.judgement === 'good' ? C.good : C.miss;
        const label = j.judgement === 'perfect' ? 'Perfect!' : j.judgement === 'good' ? 'Good' : 'Miss';
        ctx2d.fillText(j.points > 0 ? `${label} +${j.points}` : label, x, y);
        ctx2d.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [engine, win.lowMidi, win.highMidi, lookaheadMs]);

  return (
    <div ref={wrapRef} className="pianoroll-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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
