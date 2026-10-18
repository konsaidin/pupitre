// Полоска перемотки под роллом: клик/перетаскивание мотает песню, при
// наведении всплывает мини-превью нот вокруг точки, куда мотаем.

import { useEffect, useRef, useState } from 'react';
import type { GameEngine } from '../game/engine';

interface SeekBarProps {
  engine: GameEngine;
  window: { lowMidi: number; highMidi: number };
  /** A/B-луп: точка A (b=null) или активный интервал — рисуем маркеры */
  loop?: { a: number; b: number | null } | null;
  onSeek: (ms: number) => void;
}

const PREVIEW_W = 260;
const PREVIEW_H = 84;
const PREVIEW_SPAN_MS = 6000; // сколько песни видно в превью

export function SeekBar({ engine, window: win, loop = null, onSeek }: SeekBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);
  const dragging = useRef(false);

  // позиция обновляется напрямую в DOM собственным циклом — без ре-рендеров
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const frac = Math.min(1, Math.max(0, engine.songMs() / engine.map.durationMs));
      if (fillRef.current) fillRef.current.style.width = `${frac * 100}%`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // мини-превью нот вокруг точки наведения
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || hoverFrac === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = PREVIEW_W * dpr;
    canvas.height = PREVIEW_H * dpr;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, PREVIEW_W, PREVIEW_H);

    const centerMs = hoverFrac * engine.map.durationMs;
    const leftMs = centerMs - PREVIEW_SPAN_MS / 2;
    const pxPerMs = PREVIEW_W / PREVIEW_SPAN_MS;
    const semis = win.highMidi - win.lowMidi + 1;
    const rowH = PREVIEW_H / semis;
    const midiToY = (m: number) => PREVIEW_H - (m - win.lowMidi + 0.5) * rowH;

    // контур, если есть (в режиме линии он и есть цель)
    const line = engine.map.pitchline;
    if (line && line.midi.length > 0) {
      g.strokeStyle = 'rgba(185,172,205,0.8)';
      g.lineWidth = 1.5;
      g.beginPath();
      let pen = false;
      const i0 = Math.max(0, Math.floor(leftMs / line.hopMs));
      const i1 = Math.min(line.midi.length - 1, Math.ceil((leftMs + PREVIEW_SPAN_MS) / line.hopMs));
      for (let i = i0; i <= i1; i++) {
        const m = line.midi[i];
        if (m === null) {
          pen = false;
          continue;
        }
        const x = (i * line.hopMs - leftMs) * pxPerMs;
        const y = midiToY(m);
        if (!pen) {
          g.moveTo(x, y);
          pen = true;
        } else g.lineTo(x, y);
      }
      g.stroke();
    }

    g.fillStyle = 'rgba(185,165,207,0.9)';
    for (const n of engine.map.notes) {
      const x1 = (n.startMs - leftMs) * pxPerMs;
      const x2 = (n.startMs + n.durMs - leftMs) * pxPerMs;
      if (x2 < 0) continue;
      if (x1 > PREVIEW_W) break;
      const y = midiToY(n.midi);
      g.fillRect(Math.max(0, x1), y - Math.max(1.5, rowH * 0.35), Math.max(2, x2 - x1), Math.max(3, rowH * 0.7));
    }

    // точка, куда мотаем
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(PREVIEW_W / 2, 0);
    g.lineTo(PREVIEW_W / 2, PREVIEW_H);
    g.stroke();
    g.setLineDash([]);
  }, [hoverFrac, engine, win.lowMidi, win.highMidi]);

  const fracFromEvent = (e: React.PointerEvent): number => {
    const rect = barRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const hoverMs = hoverFrac !== null ? hoverFrac * engine.map.durationMs : 0;
  // прижимаем превью к краям, чтобы не вылезало за полоску
  const previewLeft =
    hoverFrac !== null
      ? `clamp(${PREVIEW_W / 2}px, ${hoverFrac * 100}%, calc(100% - ${PREVIEW_W / 2}px))`
      : '0';

  return (
    <div className="seekbar-wrap">
      {hoverFrac !== null && (
        <div className="seekbar-preview" style={{ left: previewLeft }}>
          <canvas ref={previewRef} style={{ width: PREVIEW_W, height: PREVIEW_H }} />
          <span className="mono small">{fmtMs(hoverMs)}</span>
        </div>
      )}
      <div
        ref={barRef}
        className="seekbar"
        onPointerDown={(e) => {
          dragging.current = true;
          barRef.current!.setPointerCapture(e.pointerId);
          setHoverFrac(fracFromEvent(e));
        }}
        onPointerMove={(e) => setHoverFrac(fracFromEvent(e))}
        onPointerUp={(e) => {
          if (dragging.current) {
            dragging.current = false;
            onSeek(fracFromEvent(e) * engine.map.durationMs);
          }
        }}
        onPointerLeave={() => {
          if (!dragging.current) setHoverFrac(null);
        }}
      >
        <div ref={fillRef} className="seekbar-fill" />
        {loop && (
          <div
            className="seekbar-loop"
            style={{
              left: `${(loop.a / engine.map.durationMs) * 100}%`,
              width: loop.b !== null ? `${((loop.b - loop.a) / engine.map.durationMs) * 100}%` : undefined,
            }}
          />
        )}
      </div>
    </div>
  );
}

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
