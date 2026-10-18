// Итоговый экран: звёзды, очки, разбивка вердиктов и график «голос vs ноты».

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
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
        <p>{t('No result.')}</p>
        <button className="btn" onClick={() => navigate('/')}>
          {t('To menu')}
        </button>
      </div>
    );
  }

  const { summary: s } = st;
  return (
    <div className="screen results">
      <header className="result-hero">
        <div>
          <span className="overline">{t('Session complete')}</span>
          <h1>{t(st.title)}</h1>
          <p>
            {t('Every note takes you further.')} · {t(DIFFICULTY_META[st.difficulty].label)}
          </p>
          <div className="stars" aria-label={t('{n} of 3 stars', { n: s.stars })}>
            {[1, 2, 3].map((i) => (
              <span key={i} aria-hidden="true" className={i <= s.stars ? 'star on' : 'star'}>
                ★
              </span>
            ))}
          </div>
        </div>
        <div className="accuracy-ring">
          <svg viewBox="0 0 180 180" aria-hidden="true">
            <circle cx="90" cy="90" r="78" stroke="#45404b" />
            <circle
              cx="90"
              cy="90"
              r="78"
              stroke="var(--accent)"
              opacity={s.accuracy > 0 ? 1 : 0}
              strokeDasharray={`${Math.max(0, Math.min(1, s.accuracy)) * 490.1} 490.1`}
              strokeLinecap="round"
            />
          </svg>
          <div>
            <strong>{Math.round(s.accuracy * 100)}%</strong>
            <small>{t('accuracy')}</small>
          </div>
        </div>
      </header>
      <div className="results-grid">
        <div className="stat">
          <span className="stat-num">{s.score}</span>
          <span className="dim">{t('points')}</span>
        </div>
        <div className="stat">
          <span className="stat-num">{s.perfect + s.good}</span>
          <span className="dim">{t('notes on target')}</span>
        </div>
        <div className="stat">
          <span className="stat-num">×{s.maxCombo}</span>
          <span className="dim">{t('max combo')}</span>
        </div>
      </div>
      <div className="verdicts">
        <span className="v perfect">Perfect {s.perfect}</span>
        <span className="v good">Good {s.good}</span>
        <span className="v miss">Miss {s.miss}</span>
      </div>
      {(s.tech.vibratoMs >= 500 || s.tech.distortionMs >= 500) && (
        <p className="dim tech-stats">
          {s.tech.vibratoMs >= 500 && `〜 ${t('vibrato')} ${(s.tech.vibratoMs / 1000).toFixed(1)} ${t('s')}`}
          {s.tech.vibratoMs >= 500 && s.tech.distortionMs >= 500 && ' · '}
          {s.tech.distortionMs >= 500 &&
            `⚡ ${t('rasp')} ${(s.tech.distortionMs / 1000).toFixed(1)} ${t('s')}`}
        </p>
      )}
      <section className="result-graph-panel">
        <div className="section-heading">
          <h2>{t('Your voice, on the map')}</h2>
          <div className="graph-legend">
            <span>
              <i />
              {t('Notes')}
            </span>
            <span>
              <i />
              {t('Your voice')}
            </span>
          </div>
        </div>
        <ResultGraph st={st} />
      </section>
      <div className="btn-row">
        <button className="btn primary" onClick={() => navigate('/play', { state: st.playState })}>
          <Icon name="play" size={17} />
          {t('Try again')}
        </button>
        <button
          className="btn"
          onClick={() => navigate(st.playState.kind === 'exercise' ? '/exercises' : '/songs')}
        >
          {t('To the list')}
        </button>
        <button className="btn ghost" onClick={() => navigate('/')}>
          {t('To menu')}
        </button>
      </div>
    </div>
  );
}

function ResultGraph({ st }: { st: ResultsState }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const { shiftedMap, window: win, trail, summary } = st;
      const dur = Math.max(1, shiftedMap.durationMs);
      const semis = win.highMidi - win.lowMidi + 1;
      const x = (ms: number) => (ms / dur) * W;
      const y = (midi: number) => H - ((midi - win.lowMidi + 0.5) / semis) * H;

      g.fillStyle = '#1d1f25';
      g.fillRect(0, 0, W, H);

      // ноты, раскрашенные вердиктом
      const byNote = new Map(summary.results.map((r) => [r.note, r]));
      for (const n of shiftedMap.notes) {
        const r = byNote.get(n);
        g.fillStyle = !r
          ? 'rgba(120,130,160,0.5)'
          : r.judgement === 'perfect'
            ? 'rgba(178,210,187,0.8)'
            : r.judgement === 'good'
              ? 'rgba(221,192,145,0.8)'
              : 'rgba(221,160,157,0.55)';
        g.fillRect(x(n.startMs), y(n.midi) - 2.5, Math.max(1.5, x(n.startMs + n.durMs) - x(n.startMs)), 5);
      }

      // линия голоса
      g.strokeStyle = 'rgba(185,172,205,0.95)';
      g.lineWidth = 1.5;
      g.beginPath();
      let pen = false;
      let lastMs = -1e9;
      for (const p of trail) {
        if (Number.isNaN(p.midi)) {
          pen = false;
          continue;
        }
        const px = x(p.songMs);
        const py = y(p.midi);
        if (!pen || p.songMs - lastMs > 250) {
          g.moveTo(px, py);
          pen = true;
        } else g.lineTo(px, py);
        lastMs = p.songMs;
      }
      g.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [st]);

  return (
    <canvas
      ref={ref}
      className="result-graph"
      role="img"
      aria-label={t('Your sung pitch compared with the target notes')}
    />
  );
}
