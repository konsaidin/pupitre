// Итоговый экран: звёзды, очки, разбивка вердиктов и график «голос vs ноты».

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';
import './vocal.css';
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
      <div className="screen rp-page vo-page">
        <div className="rp-empty">
          <p>{t('No result.')}</p>
        </div>
        <button className="rp-btn" onClick={() => navigate('/')}>
          {t('To menu')}
        </button>
      </div>
    );
  }

  const { summary: s } = st;
  const pct = Math.round(s.accuracy * 100);
  return (
    <div className="screen results rp-page vo-page" data-ui="vocal-results">
      <section className="rp-card vo-result">
        <div className="vo-result__main">
          <span className="rp-label">
            {t('Session complete')} · {t(st.title)} · {t(DIFFICULTY_META[st.difficulty].label)}
          </span>
          <div className="vo-result__acc">
            <span className="rp-num">{pct}</span>
            <span className="vo-result__pct">%</span>
          </div>
          <div className="vo-row">
            <span className="rp-label">{t('accuracy')}</span>
            <span className="vo-stars" aria-label={t('{n} of 3 stars', { n: s.stars })}>
              {[1, 2, 3].map((i) => (
                <GuitarIcon key={i} name={i <= s.stars ? 'star-filled' : 'star'} />
              ))}
            </span>
            <span className="rp-chip rp-chip--plain">{t('Every note takes you further.')}</span>
          </div>
        </div>
        <div className="vo-result__stats">
          <div className="rp-stat">
            <span className="rp-label">{t('points')}</span>
            <span className="rp-stat__v">{s.score}</span>
          </div>
          <div className="rp-stat">
            <span className="rp-label">{t('notes on target')}</span>
            <span className="rp-stat__v">{s.perfect + s.good}</span>
          </div>
          <div className="rp-stat">
            <span className="rp-label">{t('max combo')}</span>
            <span className="rp-stat__v">×{s.maxCombo}</span>
          </div>
          <div className="vo-result__verdicts">
            <span className="rp-chip rp-chip--ok">Perfect <b className="rp-num">{s.perfect}</b></span>
            <span className="rp-chip vo-chip--good">Good <b className="rp-num">{s.good}</b></span>
            <span className="rp-chip vo-chip--miss">Miss <b className="rp-num">{s.miss}</b></span>
          </div>
          {(s.tech.vibratoMs >= 500 || s.tech.distortionMs >= 500) && (
            <p className="rp-xs rp-faint">
              {s.tech.vibratoMs >= 500 && `〜 ${t('vibrato')} ${(s.tech.vibratoMs / 1000).toFixed(1)} ${t('s')}`}
              {s.tech.vibratoMs >= 500 && s.tech.distortionMs >= 500 && ' · '}
              {s.tech.distortionMs >= 500 && `⚡ ${t('rasp')} ${(s.tech.distortionMs / 1000).toFixed(1)} ${t('s')}`}
            </p>
          )}
        </div>
      </section>
      <section className="rp-card rp-card--pad vo-result__graph">
        <div className="rp-card__head">
          <h2 className="rp-label">{t('Your voice, on the map')}</h2>
          <div className="vo-legend rp-xs rp-muted">
            <span>
              <i className="vo-legend__notes" />
              {t('Notes')}
            </span>
            <span>
              <i className="vo-legend__voice" />
              {t('Your voice')}
            </span>
          </div>
        </div>
        <ResultGraph st={st} />
      </section>
      <div className="vo-row">
        <button className="rp-btn rp-btn--light rp-btn--lg" onClick={() => navigate('/play', { state: st.playState })}>
          <GuitarIcon name="player-play-filled" size="sm" />
          {t('Try again')}
        </button>
        <button className="rp-btn rp-btn--lg" onClick={() => navigate(st.playState.kind === 'exercise' ? '/exercises' : '/songs')}>
          <GuitarIcon name="list-details" size="sm" />
          {t('To the list')}
        </button>
        <button className="rp-btn rp-btn--ghost rp-btn--lg" onClick={() => navigate('/')}>
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

      g.fillStyle = '#1A1E28';
      g.fillRect(0, 0, W, H);

      // ноты, раскрашенные вердиктом
      const byNote = new Map(summary.results.map((r) => [r.note, r]));
      for (const n of shiftedMap.notes) {
        const r = byNote.get(n);
        g.fillStyle = !r
          ? 'rgba(140,147,167,0.45)'
          : r.judgement === 'perfect'
            ? 'rgba(69,227,162,0.8)'
            : r.judgement === 'good'
              ? 'rgba(255,198,92,0.8)'
              : 'rgba(255,106,118,0.55)';
        g.fillRect(x(n.startMs), y(n.midi) - 2.5, Math.max(1.5, x(n.startMs + n.durMs) - x(n.startMs)), 5);
      }

      // линия голоса
      g.strokeStyle = 'rgba(141,183,255,0.95)';
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
