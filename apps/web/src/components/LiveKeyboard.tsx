// Вертикальная клавиатура с живой меткой голоса (для визарда диапазона).
// Читает текущую высоту из ref, чтобы не дёргать React каждые 10 мс.

import { useEffect, useRef, type MutableRefObject } from 'react';
import { isBlackKey, midiToName } from '../lib/music';

interface Props {
  lowMidi: number; // нижняя видимая нота
  highMidi: number; // верхняя видимая нота
  liveMidiRef: MutableRefObject<number>; // NaN, если голоса нет
  markLow?: number | null; // достигнутая нижняя граница
  markHigh?: number | null; // достигнутая верхняя граница
  holdProgressRef?: MutableRefObject<number>; // 0..1 прогресс удержания ноты
}

export function LiveKeyboard({ lowMidi, highMidi, liveMidiRef, markLow, markHigh, holdProgressRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const g = canvas.getContext('2d')!;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (canvas.width !== W * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const semis = highMidi - lowMidi + 1;
      const rowH = H / semis;
      const keyW = Math.min(90, W * 0.4);
      const midiToY = (m: number) => H - (m - lowMidi + 0.5) * rowH;

      for (let m = lowMidi; m <= highMidi; m++) {
        const y = midiToY(m) - rowH / 2;
        const inRange = markLow != null && markHigh != null && m >= markLow && m <= markHigh;
        g.fillStyle = isBlackKey(m) ? '#282832' : '#f0ece6';
        g.fillRect(0, y + 0.5, keyW, rowH - 1);
        if (inRange) {
          g.fillStyle = 'rgba(185,172,205,0.12)';
          g.fillRect(keyW + 2, y + 0.5, W - keyW - 2, rowH - 1);
        }
        if (m % 12 === 0) {
          g.fillStyle = isBlackKey(m) ? '#aab' : '#4f4751';
          g.font = `${Math.min(12, rowH)}px system-ui, sans-serif`;
          g.textBaseline = 'middle';
          g.fillText(midiToName(m), 4, y + rowH / 2);
        }
      }

      // границы
      for (const [mark, color] of [
        [markLow, '#ddc091'],
        [markHigh, '#b2d2bb'],
      ] as const) {
        if (mark == null) continue;
        const y = midiToY(mark);
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
        g.fillStyle = color;
        g.font = 'bold 12px system-ui, sans-serif';
        g.fillText(midiToName(mark), W - 34, y - 7);
      }

      // живой голос
      const live = liveMidiRef.current;
      if (!Number.isNaN(live) && live >= lowMidi - 1 && live <= highMidi + 1) {
        const y = midiToY(live);
        g.fillStyle = '#b9a5cf';
        g.strokeStyle = '#d2c2df';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(keyW + 24, y, 9, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        // кольцо прогресса удержания
        const hold = holdProgressRef?.current ?? 0;
        if (hold > 0) {
          g.strokeStyle = '#b2d2bb';
          g.lineWidth = 3;
          g.beginPath();
          g.arc(keyW + 24, y, 14, -Math.PI / 2, -Math.PI / 2 + hold * Math.PI * 2);
          g.stroke();
        }
        g.fillStyle = '#f0ece6';
        g.font = 'bold 13px system-ui, sans-serif';
        g.fillText(midiToName(live), keyW + 44, y + 4);
      }
      g.lineWidth = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [lowMidi, highMidi, liveMidiRef, markLow, markHigh, holdProgressRef]);

  return (
    <div ref={wrapRef} className="livekeyboard-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}
