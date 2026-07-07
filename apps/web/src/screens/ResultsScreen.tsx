// Итоговый экран: звёзды, очки, разбивка вердиктов и график «голос vs ноты».

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { GameSummary } from '../game/scoring';
import type { TrailPoint } from '../game/engine';
import type { SongMap, Difficulty } from '../lib/songMap';
import { DIFFICULTY_META } from '../lib/songMap';
import type { PlayState } from './GameScreen';

interface ResultsState {
  summary: GameSummary;
  playState: PlayState;
  shiftedMap: SongMap;
  window: { lowMidi: number; highMidi: number };
  trail: TrailPoint[];
  title: string;
  difficulty: Difficulty;
}

export function ResultsScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const st = location.state as ResultsState | null;

  if (!st) {
    return (
      <div className="screen">
        <p>Нет результата.</p>
        <button className="btn" onClick={() => navigate('/')}>В меню</button>
      </div>
    );
  }

  const { summary: s } = st;
  return (
    <div className="screen results">
      <h1>{st.title}</h1>
      <p className="dim">{DIFFICULTY_META[st.difficulty].label}</p>
      <div className="stars">{[1, 2, 3].map((i) => (
        <span key={i} className={i <= s.stars ? 'star on' : 'star'}>★</span>
      ))}</div>
      <div className="results-grid">
        <div className="stat"><span className="stat-num">{s.score}</span><span className="dim">очки</span></div>
        <div className="stat"><span className="stat-num">{Math.round(s.accuracy * 100)}%</span><span className="dim">точность</span></div>
        <div className="stat"><span className="stat-num">×{s.maxCombo}</span><span className="dim">макс. комбо</span></div>
      </div>
      <div className="verdicts">
        <span className="v perfect">Perfect {s.perfect}</span>
        <span className="v good">Good {s.good}</span>
        <span className="v miss">Miss {s.miss}</span>
      </div>
      <ResultGraph st={st} />
      <div className="btn-row">
        <button className="btn primary" onClick={() => navigate('/play', { state: st.playState })}>Ещё раз</button>
        <button className="btn" onClick={() => navigate(st.playState.kind === 'exercise' ? '/exercises' : '/songs')}>
          К списку
        </button>
        <button className="btn ghost" onClick={() => navigate('/')}>В меню</button>
      </div>
    </div>
  );
}

function ResultGraph({ st }: { st: ResultsState }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { shiftedMap, window: win, trail, summary } = st;
    const dur = shiftedMap.durationMs;
    const semis = win.highMidi - win.lowMidi + 1;
    const x = (ms: number) => (ms / dur) * W;
    const y = (midi: number) => H - ((midi - win.lowMidi + 0.5) / semis) * H;

    g.fillStyle = '#0d1117';
    g.fillRect(0, 0, W, H);

    // ноты, раскрашенные вердиктом
    const byNote = new Map(summary.results.map((r) => [r.note, r]));
    for (const n of shiftedMap.notes) {
      const r = byNote.get(n);
      g.fillStyle = !r
        ? 'rgba(120,130,160,0.5)'
        : r.judgement === 'perfect'
          ? 'rgba(56,217,140,0.8)'
          : r.judgement === 'good'
            ? 'rgba(232,195,74,0.8)'
            : 'rgba(224,95,95,0.55)';
      g.fillRect(x(n.startMs), y(n.midi) - 2.5, Math.max(1.5, x(n.startMs + n.durMs) - x(n.startMs)), 5);
    }

    // линия голоса
    g.strokeStyle = 'rgba(138,163,232,0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    let pen = false;
    let lastMs = -1e9;
    for (const p of trail) {
      if (Number.isNaN(p.midi)) { pen = false; continue; }
      const px = x(p.songMs);
      const py = y(p.midi);
      if (!pen || p.songMs - lastMs > 250) { g.moveTo(px, py); pen = true; }
      else g.lineTo(px, py);
      lastMs = p.songMs;
    }
    g.stroke();
  }, [st]);

  return <canvas ref={ref} className="result-graph" />;
}
