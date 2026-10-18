// Редактор нот песни: канвас-пиано-ролл, где ноты можно двигать, тянуть,
// добавлять и удалять, сверяясь с контуром извлечённого вокала и слушая его.
//
// Работает в ИСХОДНЫХ (несдвинутых) координатах карты: контур и vocal.mp3 — в
// оригинальной октаве, игровой октавный сдвиг сюда не проникает.

import { useCallback, useEffect, useRef, useState } from 'react';
import { isBlackKey, midiToName } from '../lib/music';
import { t } from '../lib/i18n';
import { contourMidiAt } from '../lib/pitchline';
import type { MapNote, SongMap } from '../lib/songMap';

interface Props {
  map: SongMap;
  window: { lowMidi: number; highMidi: number };
  /** превью извлечённого вокала; null — недоступно */
  vocalUrl: string | null;
  onSave: (notes: MapNote[]) => Promise<void>;
  onClose: () => void;
}

interface ENote extends MapNote {
  id: number;
}

type DragMode = 'none' | 'move' | 'resize' | 'seek' | 'range';

const KEYBOARD_W = 56;
const PLAYHEAD_FRAC = 0.3;
const VIEW_MS = 8000;
const MIN_DUR_MS = 60;
const EDGE_PX = 7;
const NEW_NOTE_MS = 400;
/** Полоса-линейка сверху: только по ней перематываем, иначе перемотка
 *  уводила бы вид из-под курсора и двойной клик добавлял ноту не туда. */
const RULER_H = 18;

const C = {
  bg: '#1d1f25',
  rowWhite: 'rgba(255,255,255,0.030)',
  rowLine: 'rgba(255,255,255,0.055)',
  octaveLine: 'rgba(255,255,255,0.16)',
  note: '#776a8b',
  noteBorder: '#a99ab9',
  noteSel: '#6d8ad4',
  noteSelBorder: '#a9c0ff',
  pitch: '#b9accd',
  selRange: 'rgba(251,191,36,0.10)',
  selRangeEdge: 'rgba(251,191,36,0.6)',
  playhead: 'rgba(255,255,255,0.5)',
  ruler: '#151a24',
  rulerLine: 'rgba(255,255,255,0.2)',
  text: 'rgba(230,235,245,0.85)',
  textDim: 'rgba(230,235,245,0.45)',
};

export function SongEditor({ map, window: win, vocalUrl, onSave, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // ноты живут в ref (канвас читает каждый кадр), version — чтобы обновлять UI
  const notesRef = useRef<ENote[]>(map.notes.map((n, i) => {
    const startMs = Math.max(0, Math.min(n.startMs, map.durationMs - 1));
    return { ...n, id: i, startMs, durMs: Math.max(1, Math.min(n.durMs, map.durationMs - startMs)) };
  }));
  const nextId = useRef(map.notes.length);
  const centerMsRef = useRef(0);
  const selectedRef = useRef<number | null>(null);
  const dragRef = useRef<{ mode: DragMode; id: number; grabMs: number; grabMidi: number }>({
    mode: 'none',
    id: -1,
    grabMs: 0,
    grabMidi: 0,
  });

  // выделение по времени (Shift+drag) — для октавного транспонирования фраз
  const selRangeRef = useRef<{ aMs: number; bMs: number } | null>(null);

  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [selected, setSelected] = useState<number | null>(null);
  const [selRange, setSelRange] = useState<{ aMs: number; bMs: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [vocalOk, setVocalOk] = useState(Boolean(vocalUrl));
  const [centerMs, setCenterMs] = useState(0);

  const select = useCallback((id: number | null) => {
    selectedRef.current = id;
    setSelected(id);
  }, []);

  const setRange = useCallback((r: { aMs: number; bMs: number } | null) => {
    selRangeRef.current = r;
    setSelRange(r);
  }, []);

  /**
   * Транспонирование ±12: ноты внутри выделения (пересечение по времени),
   * без выделения — выбранная нота. За пределы окна ролла не выводим —
   * операция целиком отменяется, чтобы не ломать интервалы клампом.
   */
  const transpose = useCallback(
    (d: number) => {
      const r = selRangeRef.current;
      const targets = r
        ? notesRef.current.filter((n) => n.startMs < r.bMs && n.startMs + n.durMs > r.aMs)
        : notesRef.current.filter((n) => n.id === selectedRef.current);
      if (targets.length === 0) return;
      if (targets.some((n) => n.midi + d < win.lowMidi || n.midi + d > win.highMidi)) {
        setNotice(t('Shift would leave the roll window — nothing changed.'));
        return;
      }
      for (const n of targets) n.midi += d;
      setNotice(null);
      setDirty(true);
      bump();
    },
    [bump, win.lowMidi, win.highMidi],
  );

  const seekTo = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(map.durationMs, ms));
    centerMsRef.current = clamped;
    setCenterMs(clamped);
    const a = audioRef.current;
    if (a && Number.isFinite(a.duration)) a.currentTime = clamped / 1000;
  }, [map.durationMs]);

  const deleteSelected = useCallback(() => {
    const id = selectedRef.current;
    if (id === null) return;
    notesRef.current = notesRef.current.filter((n) => n.id !== id);
    select(null);
    setDirty(true);
    bump();
  }, [bump, select]);

  // Delete/Backspace удаляют выбранную ноту; Shift+↑/↓ — октава; Esc снимает выделение, потом закрывает
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRef.current !== null) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        transpose(e.key === 'ArrowUp' ? 12 : -12);
      } else if (e.key === 'Escape') {
        if (selRangeRef.current) setRange(null);
        else onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deleteSelected, onClose, transpose, setRange]);

  // рендер-цикл
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

    const draw = () => {
      raf = requestAnimationFrame(draw);

      // во время проигрывания позицию ведёт аудио
      const a = audioRef.current;
      if (a && !a.paused) {
        centerMsRef.current = a.currentTime * 1000;
      }
      const center = centerMsRef.current;
      const rowH = H / semis;
      const pxPerMs = (W - KEYBOARD_W) / VIEW_MS;
      const viewLeft = center - VIEW_MS * PLAYHEAD_FRAC;
      const msToX = (ms: number) => KEYBOARD_W + (ms - viewLeft) * pxPerMs;
      const midiToY = (m: number) => H - (m - win.lowMidi + 0.5) * rowH;

      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.fillStyle = C.bg;
      ctx2d.fillRect(0, 0, W, H);

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
        ctx2d.fillStyle = isBlackKey(m) ? '#282832' : '#f0ece6';
        ctx2d.fillRect(0, y + 0.5, KEYBOARD_W - 6, rowH - 1);
        if (m % 12 === 0 || rowH > 16) {
          ctx2d.fillStyle = isBlackKey(m) ? C.textDim : '#4f4751';
          ctx2d.font = `${Math.min(11, rowH - 3)}px system-ui, sans-serif`;
          ctx2d.textBaseline = 'middle';
          ctx2d.fillText(midiToName(m), 4, y + rowH / 2 + 0.5);
        }
      }

      // контур вокала — то, по чему сверяем ноты
      const line = map.pitchline;
      if (line && line.midi.length > 0) {
        const i0 = Math.max(0, Math.floor(viewLeft / line.hopMs) - 1);
        const i1 = Math.min(line.midi.length - 1, Math.ceil((viewLeft + VIEW_MS) / line.hopMs) + 1);
        ctx2d.lineWidth = 2;
        ctx2d.lineCap = 'round';
        ctx2d.lineJoin = 'round';
        ctx2d.strokeStyle = C.pitch;
        ctx2d.shadowColor = C.pitch;
        ctx2d.shadowBlur = 5;
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
      }

      // выделение по времени (для транспонирования)
      const sr = selRangeRef.current;
      if (sr) {
        const x1 = Math.max(KEYBOARD_W, msToX(Math.min(sr.aMs, sr.bMs)));
        const x2 = Math.min(W, msToX(Math.max(sr.aMs, sr.bMs)));
        if (x2 > x1) {
          ctx2d.fillStyle = C.selRange;
          ctx2d.fillRect(x1, RULER_H, x2 - x1, H - RULER_H);
          ctx2d.strokeStyle = C.selRangeEdge;
          ctx2d.beginPath();
          ctx2d.moveTo(x1, RULER_H);
          ctx2d.lineTo(x1, H);
          ctx2d.moveTo(x2, RULER_H);
          ctx2d.lineTo(x2, H);
          ctx2d.stroke();
        }
      }

      // ноты
      const sel = selectedRef.current;
      for (const n of notesRef.current) {
        const x1 = msToX(n.startMs);
        const x2 = msToX(n.startMs + n.durMs);
        if (x2 < KEYBOARD_W || x1 > W) continue;
        const y = midiToY(n.midi);
        const h = Math.max(6, rowH * 0.72);
        const isSel = n.id === sel;
        const sx = Math.max(x1, KEYBOARD_W);
        ctx2d.fillStyle = isSel ? C.noteSel : C.note;
        roundRect(ctx2d, sx, y - h / 2, Math.max(3, x2 - sx), h, 5);
        ctx2d.fill();
        ctx2d.strokeStyle = isSel ? C.noteSelBorder : C.noteBorder;
        ctx2d.lineWidth = isSel ? 2 : 1;
        ctx2d.stroke();
        ctx2d.lineWidth = 1;
      }

      // шарик-ориентир на контуре + playhead
      const playX = msToX(center);
      if (line) {
        const cm = contourMidiAt(line, Math.max(0, center));
        if (cm !== null) {
          const y = midiToY(cm);
          if (y >= -4 && y <= H + 4) {
            ctx2d.fillStyle = C.pitch;
            ctx2d.shadowColor = C.pitch;
            ctx2d.shadowBlur = 12;
            ctx2d.beginPath();
            ctx2d.arc(playX, y, 5, 0, Math.PI * 2);
            ctx2d.fill();
            ctx2d.shadowBlur = 0;
          }
        }
      }
      ctx2d.strokeStyle = C.playhead;
      ctx2d.setLineDash([6, 4]);
      ctx2d.beginPath();
      ctx2d.moveTo(playX, 0);
      ctx2d.lineTo(playX, H);
      ctx2d.stroke();
      ctx2d.setLineDash([]);

      // линейка времени (перемотка кликом по ней)
      ctx2d.fillStyle = C.ruler;
      ctx2d.fillRect(KEYBOARD_W, 0, W - KEYBOARD_W, RULER_H);
      ctx2d.strokeStyle = C.rulerLine;
      ctx2d.beginPath();
      ctx2d.moveTo(KEYBOARD_W, RULER_H + 0.5);
      ctx2d.lineTo(W, RULER_H + 0.5);
      ctx2d.stroke();
      ctx2d.font = '10px system-ui, sans-serif';
      ctx2d.textBaseline = 'middle';
      const firstSec = Math.max(0, Math.floor(viewLeft / 1000));
      const lastSec = Math.ceil((viewLeft + VIEW_MS) / 1000);
      for (let s = firstSec; s <= lastSec; s++) {
        const x = msToX(s * 1000);
        if (x < KEYBOARD_W) continue;
        const major = s % 5 === 0;
        ctx2d.strokeStyle = C.rulerLine;
        ctx2d.beginPath();
        ctx2d.moveTo(x, major ? 3 : 9);
        ctx2d.lineTo(x, RULER_H);
        ctx2d.stroke();
        if (major) {
          ctx2d.fillStyle = C.textDim;
          ctx2d.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, x + 3, RULER_H / 2);
        }
      }
      // playhead-маркер на линейке
      ctx2d.fillStyle = '#f0ece6';
      ctx2d.beginPath();
      ctx2d.moveTo(playX - 5, 0);
      ctx2d.lineTo(playX + 5, 0);
      ctx2d.lineTo(playX, 7);
      ctx2d.closePath();
      ctx2d.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [map.pitchline, win.lowMidi, win.highMidi]);

  // ——— мышь ———

  const geom = () => {
    const wrap = wrapRef.current!;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const semis = win.highMidi - win.lowMidi + 1;
    const rowH = H / semis;
    const pxPerMs = (W - KEYBOARD_W) / VIEW_MS;
    const viewLeft = centerMsRef.current - VIEW_MS * PLAYHEAD_FRAC;
    return {
      rowH,
      xToMs: (x: number) => viewLeft + (x - KEYBOARD_W) / pxPerMs,
      msToX: (ms: number) => KEYBOARD_W + (ms - viewLeft) * pxPerMs,
      yToMidi: (y: number) => win.lowMidi - 0.5 + (H - y) / rowH,
      midiToY: (m: number) => H - (m - win.lowMidi + 0.5) * rowH,
    };
  };

  const localPos = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Нота под курсором + попал ли курсор в её правый край (ресайз). */
  const hitTest = (x: number, y: number) => {
    const g = geom();
    for (let i = notesRef.current.length - 1; i >= 0; i--) {
      const n = notesRef.current[i];
      const x1 = g.msToX(n.startMs);
      const x2 = g.msToX(n.startMs + n.durMs);
      const ny = g.midiToY(n.midi);
      if (x >= x1 - 2 && x <= x2 + 2 && Math.abs(y - ny) <= g.rowH * 0.4) {
        return { note: n, edge: Math.abs(x - x2) <= EDGE_PX };
      }
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = localPos(e);
    if (x < KEYBOARD_W) return;
    const g = geom();
    (e.target as Element).setPointerCapture(e.pointerId);

    // перемотка — только по линейке сверху
    if (y <= RULER_H) {
      dragRef.current = { mode: 'seek', id: -1, grabMs: 0, grabMidi: 0 };
      seekTo(g.xToMs(x));
      bump();
      return;
    }

    // Shift+drag — выделение фразы по времени (для транспонирования)
    if (e.shiftKey) {
      const anchor = g.xToMs(x);
      dragRef.current = { mode: 'range', id: -1, grabMs: anchor, grabMidi: 0 };
      setRange({ aMs: anchor, bMs: anchor });
      bump();
      return;
    }

    const hit = hitTest(x, y);
    if (hit) {
      select(hit.note.id);
      dragRef.current = {
        mode: hit.edge ? 'resize' : 'move',
        id: hit.note.id,
        grabMs: g.xToMs(x) - hit.note.startMs,
        grabMidi: g.yToMidi(y) - hit.note.midi,
      };
    } else {
      select(null);
      dragRef.current = { mode: 'none', id: -1, grabMs: 0, grabMidi: 0 };
    }
    bump();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.mode === 'none') return;
    const { x, y } = localPos(e);
    const g = geom();

    if (d.mode === 'seek') {
      seekTo(g.xToMs(x));
      return;
    }
    if (d.mode === 'range') {
      setRange({ aMs: d.grabMs, bMs: g.xToMs(x) });
      return;
    }
    const n = notesRef.current.find((v) => v.id === d.id);
    if (!n) return;

    if (d.mode === 'move') {
      n.startMs = Math.max(0, Math.min(map.durationMs - n.durMs, Math.round(g.xToMs(x) - d.grabMs)));
      n.midi = Math.round(g.yToMidi(y) - d.grabMidi);
      n.midi = Math.max(win.lowMidi, Math.min(win.highMidi, n.midi));
    } else {
      n.durMs = Math.min(map.durationMs - n.startMs, Math.max(MIN_DUR_MS, Math.round(g.xToMs(x) - n.startMs)));
    }
    setDirty(true);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current.mode !== 'none') {
      // вырожденное выделение (клик с Shift без протяжки) — снимаем
      if (dragRef.current.mode === 'range') {
        const r = selRangeRef.current;
        if (r && Math.abs(r.bMs - r.aMs) < 60) setRange(null);
        else if (r) setRange({ aMs: Math.min(r.aMs, r.bMs), bMs: Math.max(r.aMs, r.bMs) });
      }
      dragRef.current = { mode: 'none', id: -1, grabMs: 0, grabMidi: 0 };
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        // капчур мог не установиться
      }
      bump();
    }
  };

  /** Двойной клик по пустому месту — добавить ноту. */
  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = localPos(e);
    if (x < KEYBOARD_W || y <= RULER_H) return;
    if (hitTest(x, y)) return;
    const g = geom();
    const note: ENote = {
      id: nextId.current++,
      startMs: Math.max(0, Math.min(map.durationMs - Math.min(MIN_DUR_MS, map.durationMs), Math.round(g.xToMs(x)))),
      durMs: Math.min(NEW_NOTE_MS, map.durationMs),
      midi: Math.max(win.lowMidi, Math.min(win.highMidi, Math.round(g.yToMidi(y)))),
    };
    note.durMs = Math.min(note.durMs, map.durationMs - note.startMs);
    notesRef.current = [...notesRef.current, note];
    select(note.id);
    setDirty(true);
    bump();
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.currentTime = centerMsRef.current / 1000;
      void a.play().then(() => setPlaying(true)).catch(() => setVocalOk(false));
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const notes = [...notesRef.current]
        .sort((a, b) => a.startMs - b.startMs)
        .map(({ id: _id, ...n }) => n);
      await onSave(notes);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const selNote = selected !== null ? notesRef.current.find((n) => n.id === selected) : undefined;

  return (
    <div className="editor-overlay">
      <div className="editor">
        <header className="editor-head">
          <b>{t('Note editor')} · {t(map.title)}</b>
          <span className="dim small">{t('{n} notes', { n: notesRef.current.length })}</span>
          <div className="editor-spacer" />
          {vocalOk && (
            <button className="btn tiny" onClick={togglePlay}>
              {playing ? '⏸' : '▶'} {t('Vocals')}
            </button>
          )}
          <button
            className="btn tiny"
            disabled={selRange === null && selected === null}
            title={t('Octave down: selection (Shift+drag) or the selected note')}
            onClick={() => transpose(-12)}
          >
            −12
          </button>
          <button
            className="btn tiny"
            disabled={selRange === null && selected === null}
            title={t('Octave up: selection (Shift+drag) or the selected note')}
            onClick={() => transpose(12)}
          >
            +12
          </button>
          <button className="btn tiny danger" disabled={selected === null} onClick={deleteSelected}>
            🗑 {t('Delete note')}
          </button>
          <button className="btn tiny primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t('Saving…') : t('Save')}
          </button>
          <button className="btn tiny ghost" onClick={onClose}>✕</button>
        </header>

        <div
          ref={wrapRef}
          className="editor-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <canvas ref={canvasRef} />
        </div>

        <div className="editor-foot">
          <input
            type="range"
            min={0}
            max={map.durationMs}
            step={50}
            value={centerMs}
            onChange={(e) => seekTo(+e.target.value)}
          />
          <span className="dim small mono">{fmt(centerMs)} / {fmt(map.durationMs)}</span>
        </div>

        <p className="dim small editor-hint">
          {t('drag a note — move; drag its right edge — length; double-click — add; Delete — remove. Timeline on top seeks.')}
          {' '}{t('Shift+drag selects a phrase; ±12 (or Shift+↑/↓) fixes a wrong octave.')}
          {selNote && ` · ${midiToName(selNote.midi)}, ${Math.round(selNote.durMs)} ms`}
        </p>
        {notice && <p className="hint small">{notice}</p>}
        {!vocalOk && vocalUrl && <p className="hint small">{t('Vocals unavailable — edit along the contour.')}</p>}
        {error && <p className="error small">⚠️ {error}</p>}

        {vocalUrl && (
          <audio
            ref={audioRef}
            src={vocalUrl}
            preload="auto"
            onEnded={() => setPlaying(false)}
            onError={() => setVocalOk(false)}
          />
        )}
      </div>
    </div>
  );
}

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
