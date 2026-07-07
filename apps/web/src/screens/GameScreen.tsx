// Экран игры: подготовка (сложность/октава/подсказки) → отсчёт → игра →
// пауза/итог. Работает и для упражнений (синт), и для песен (инструментал).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ensureMic, getAudioContext, stopMic } from '../audio/audioSession';
import { PianoRoll } from '../components/PianoRoll';
import { GameEngine } from '../game/engine';
import { chooseOctaveShift, rollWindow, shiftNotes } from '../game/octave';
import { comfortZone } from '../lib/music';
import { DIFFICULTY_META, type Difficulty, type SongMap } from '../lib/songMap';
import type { GameSummary } from '../game/scoring';
import { useProfile } from '../state/ProfileContext';

export interface PlayState {
  map: SongMap;
  kind: 'exercise' | 'song';
}

type Status = 'setup' | 'loading' | 'running' | 'paused' | 'finished' | 'error';

export function GameScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, update, recordScore } = useProfile();
  const play = location.state as PlayState | null;

  const [status, setStatus] = useState<Status>('setup');
  const [error, setError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>(profile.difficulty);
  const [guideNotes, setGuideNotes] = useState(profile.guideNotes);
  const [metronome, setMetronome] = useState(profile.metronome);
  const [octaveShift, setOctaveShift] = useState<number | null>(null);
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [hud, setHud] = useState({ score: 0, combo: 0, progress: 0, countdown: 0 });
  const backingBufferRef = useRef<AudioBuffer | null>(null);

  const range = profile.range;

  // октавный сдвиг для песен считается один раз от комфортной зоны
  const autoShift = useMemo(() => {
    if (!play || !range || play.kind !== 'song') return 0;
    return chooseOctaveShift(play.map.notes, comfortZone(range));
  }, [play, range]);
  const shift = octaveShift ?? autoShift;

  const shiftedMap: SongMap | null = useMemo(() => {
    if (!play) return null;
    return {
      ...play.map,
      notes: shiftNotes(play.map.notes, shift),
      guideEvents: play.map.guideEvents ? shiftNotes(play.map.guideEvents, shift) : undefined,
    };
  }, [play, shift]);

  const window_ = useMemo(() => {
    if (!shiftedMap || !range) return null;
    return rollWindow(shiftedMap.notes, range);
  }, [shiftedMap, range]);

  useEffect(() => () => stopMic(), []);

  // HUD-опрос движка
  useEffect(() => {
    if (!engine) return;
    const iv = setInterval(() => {
      setHud({
        score: engine.score,
        combo: engine.combo,
        progress: Math.min(1, Math.max(0, engine.songMs() / engine.map.durationMs)),
        countdown: engine.countdownRemaining(),
      });
      if (engine.phase === 'finished' && status === 'running') setStatus('finished');
    }, 120);
    return () => clearInterval(iv);
  }, [engine, status]);

  if (!play || !shiftedMap || !window_) {
    return (
      <div className="screen">
        <p className="error">{!range ? 'Сначала определи диапазон голоса.' : 'Нет данных для игры.'}</p>
        <button className="btn" onClick={() => navigate(range ? '/' : '/range')}>
          {range ? 'В меню' : 'К визарду'}
        </button>
      </div>
    );
  }

  const start = async () => {
    setStatus('loading');
    setError(null);
    try {
      const ctx = getAudioContext();
      const tracker = await ensureMic(profile.micDeviceId);
      if (shiftedMap.backing.kind === 'url' && !backingBufferRef.current) {
        const resp = await fetch(shiftedMap.backing.url);
        if (!resp.ok) throw new Error(`Не удалось загрузить инструментал (${resp.status})`);
        backingBufferRef.current = await ctx.decodeAudioData(await resp.arrayBuffer());
      }
      update({ difficulty, guideNotes, metronome });
      const engRef: { current: GameEngine | null } = { current: null };
      const eng = new GameEngine({
        ctx,
        tracker,
        map: shiftedMap,
        difficulty,
        latencyMs: profile.latencyMs,
        guideNotes,
        metronome,
        backingBuffer: backingBufferRef.current ?? undefined,
        onFinish: (summary: GameSummary) => {
          recordScore({
            mapId: play.map.id,
            title: play.map.title,
            score: summary.score,
            accuracy: summary.accuracy,
            stars: summary.stars,
            difficulty,
            playedAt: Date.now(),
          });
          // хвост голоса для итогового графика (прореженный)
          const trail = (engRef.current?.trail ?? []).filter((_, i) => i % 2 === 0);
          navigate('/results', {
            state: { summary, playState: play, shiftedMap, window: window_, trail, title: play.map.title, difficulty },
            replace: true,
          });
        },
      });
      engRef.current = eng;
      setEngine(eng);
      setStatus('running');
      await eng.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка запуска');
      setStatus('error');
    }
  };

  const pause = () => {
    engine?.pause();
    setStatus('paused');
  };
  const resume = () => {
    engine?.resume();
    setStatus('running');
  };
  const quit = () => {
    engine?.quit();
    stopMic();
    navigate(play.kind === 'exercise' ? '/exercises' : '/songs');
  };
  const restart = () => {
    engine?.quit();
    setEngine(null);
    setStatus('setup');
  };

  const meta = DIFFICULTY_META[difficulty];

  return (
    <div className="screen game">
      <header className="game-header">
        <button className="btn ghost" onClick={quit}>← Выйти</button>
        <div className="game-title">
          <b>{play.map.title}</b>
          {play.map.subtitle && <span className="dim"> · {play.map.subtitle}</span>}
        </div>
        {play.kind === 'song' && (
          <div className="octave-badge" title="Мелодия сдвинута в твою октаву">
            <button className="btn tiny" disabled={status === 'running'} onClick={() => { setOctaveShift(shift - 1); restart(); }}>−</button>
            <span>{shift === 0 ? 'оригинал' : `${shift > 0 ? '+' : ''}${shift} окт.`}</span>
            <button className="btn tiny" disabled={status === 'running'} onClick={() => { setOctaveShift(shift + 1); restart(); }}>+</button>
          </div>
        )}
        <div className="hud">
          <span className="hud-score">{hud.score}</span>
          {hud.combo > 1 && <span className="hud-combo">×{hud.combo}</span>}
          <span className="hud-diff">{meta.label}</span>
        </div>
        {status === 'running' && <button className="btn ghost" onClick={pause}>⏸ Пауза</button>}
      </header>

      <div className="game-progress"><div style={{ width: `${hud.progress * 100}%` }} /></div>

      <div className="game-stage">
        {engine && <PianoRoll engine={engine} window={window_} />}

        {status === 'setup' && (
          <div className="overlay">
            <div className="panel">
              <h2>{play.map.title}</h2>
              <label className="field">
                Сложность
                <div className="seg">
                  {(Object.keys(DIFFICULTY_META) as Difficulty[]).map((d) => (
                    <button key={d} className={d === difficulty ? 'seg-btn active' : 'seg-btn'} onClick={() => setDifficulty(d)}>
                      {DIFFICULTY_META[d].label}
                    </button>
                  ))}
                </div>
                <span className="dim small">допуск ±{DIFFICULTY_META[difficulty].toleranceCents} центов{DIFFICULTY_META[difficulty].octaveAgnostic ? ', октава не важна' : ', октава важна'}</span>
              </label>
              {play.kind === 'exercise' && (
                <>
                  <label className="check"><input type="checkbox" checked={guideNotes} onChange={(e) => setGuideNotes(e.target.checked)} /> Играть подсказки (опорные ноты)</label>
                  <label className="check"><input type="checkbox" checked={metronome} onChange={(e) => setMetronome(e.target.checked)} /> Метроном</label>
                </>
              )}
              {play.kind === 'song' && (
                <p className="dim small">Октава: {shift === 0 ? 'как в оригинале' : `сдвиг ${shift > 0 ? '+' : ''}${shift} — мелодия перенесена в твой диапазон`}. Изменить можно кнопками ± сверху.</p>
              )}
              {!profile.headphonesWarned && (
                <p className="hint">🎧 Надень наушники — иначе микрофон услышит аккомпанемент и линия голоса будет прыгать.</p>
              )}
              {error && <p className="error">⚠️ {error}</p>}
              <button className="btn primary big" onClick={() => { update({ headphonesWarned: true }); void start(); }}>
                Поехали
              </button>
            </div>
          </div>
        )}

        {status === 'loading' && (
          <div className="overlay"><div className="panel"><p>Готовим микрофон и аудио…</p></div></div>
        )}

        {status === 'running' && hud.countdown > 0.05 && (
          <div className="overlay transparent"><span className="countdown">{Math.ceil(hud.countdown)}</span></div>
        )}

        {status === 'paused' && (
          <div className="overlay">
            <div className="panel">
              <h2>Пауза</h2>
              <div className="btn-col">
                <button className="btn primary" onClick={resume}>Продолжить</button>
                <button className="btn" onClick={restart}>Заново</button>
                <button className="btn" onClick={quit}>Выйти</button>
              </div>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="overlay">
            <div className="panel">
              <p className="error">⚠️ {error}</p>
              <button className="btn" onClick={() => setStatus('setup')}>Назад</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
