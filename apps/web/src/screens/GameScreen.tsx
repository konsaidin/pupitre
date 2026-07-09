// Экран игры: подготовка (сложность/октава/подсказки) → отсчёт → игра →
// пауза/итог. Работает и для упражнений (синт), и для песен (инструментал).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ensureMic, getAudioContext, stopMic } from '../audio/audioSession';
import { ExtractionPanel } from '../components/ExtractionPanel';
import { PianoRoll } from '../components/PianoRoll';
import { SongEditor } from '../components/SongEditor';
import { GameEngine } from '../game/engine';
import { chooseOctaveShift, rollWindow, shiftNotes, shiftPitchline } from '../game/octave';
import { saveMap, vocalUrl as vocalUrlFor } from '../lib/api';
import { comfortZone } from '../lib/music';
import { contourSegments } from '../lib/pitchline';
import { DIFFICULTY_META, type Difficulty, type MapNote, type SongMap } from '../lib/songMap';
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
  const [editing, setEditing] = useState(false);
  const [tuning, setTuning] = useState(false); // панель настроек извлечения
  const [lineMode, setLineMode] = useState(false); // экспериментально: петь по линии-контуру
  // карта живёт в состоянии: редактор нот её меняет
  const [songMap, setSongMap] = useState<SongMap | null>(play?.map ?? null);
  const backingBufferRef = useRef<AudioBuffer | null>(null);
  const editedRef = useRef(false);

  const range = profile.range;

  // октавный сдвиг для песен считается один раз от комфортной зоны
  const autoShift = useMemo(() => {
    if (!songMap || !range || play?.kind !== 'song') return 0;
    return chooseOctaveShift(songMap.notes, comfortZone(range));
  }, [songMap, range, play?.kind]);
  const shift = octaveShift ?? autoShift;

  const shiftedMap: SongMap | null = useMemo(() => {
    if (!songMap) return null;
    return {
      ...songMap,
      notes: shiftNotes(songMap.notes, shift),
      guideEvents: songMap.guideEvents ? shiftNotes(songMap.guideEvents, shift) : undefined,
      pitchline: songMap.pitchline ? shiftPitchline(songMap.pitchline, shift) : undefined,
    };
  }, [songMap, shift]);

  /** Окно редактора — в исходных (несдвинутых) координатах карты. */
  const editorWindow = useMemo(() => {
    if (!songMap || !range) return null;
    return rollWindow(songMap.notes, range);
  }, [songMap, range]);

  /** Возможен ли режим «петь по линии» для этой карты. */
  const canLineMode = play?.kind === 'song' && !!songMap?.pitchline?.midi.length;
  const lineOn = lineMode && canLineMode;

  /**
   * Карта для движка: в режиме линии ноты подменяются виртуальными фразами
   * из контура (комбо/вердикты), целью матчинга становится сам контур.
   */
  const engineMap: SongMap | null = useMemo(() => {
    if (!shiftedMap) return null;
    if (!lineOn || !shiftedMap.pitchline) return shiftedMap;
    return { ...shiftedMap, notes: contourSegments(shiftedMap.pitchline) };
  }, [shiftedMap, lineOn]);

  const window_ = useMemo(() => {
    if (!engineMap || !range) return null;
    return rollWindow(engineMap.notes, range);
  }, [engineMap, range]);

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

  if (!play || !songMap || !shiftedMap || !engineMap || !window_) {
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
        map: engineMap,
        difficulty,
        latencyMs: profile.latencyMs,
        guideNotes,
        metronome,
        lineTarget: lineOn,
        backingBuffer: backingBufferRef.current ?? undefined,
        onFinish: (summary: GameSummary) => {
          recordScore({
            mapId: songMap.id,
            title: songMap.title,
            score: summary.score,
            accuracy: summary.accuracy,
            stars: summary.stars,
            difficulty,
            playedAt: Date.now(),
          });
          // хвост голоса для итогового графика (прореженный)
          const trail = (engRef.current?.trail ?? []).filter((_, i) => i % 2 === 0);
          navigate('/results', {
            state: { summary, playState: play, shiftedMap: engineMap, window: window_, trail, title: songMap.title, difficulty },
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

  const openEditor = () => {
    engine?.pause();
    setEditing(true);
  };

  /** Правка идёт в исходных координатах — движок пересобираем после закрытия. */
  const onEditorSave = async (notes: MapNote[]) => {
    await saveMap(songMap.id, notes);
    setSongMap({ ...songMap, notes });
    editedRef.current = true;
  };

  const onEditorClose = () => {
    setEditing(false);
    if (editedRef.current) {
      editedRef.current = false;
      restart();
    }
  };

  const meta = DIFFICULTY_META[difficulty];

  return (
    <div className="screen game">
      <header className="game-header">
        <button className="btn ghost" onClick={quit}>← Выйти</button>
        <div className="game-title">
          <b>{songMap.title}</b>
          {songMap.subtitle && <span className="dim"> · {songMap.subtitle}</span>}
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
        {engine && <PianoRoll engine={engine} window={window_} lineMode={lineOn} />}

        {status === 'setup' && !editing && !tuning && (
          <div className="overlay">
            <div className="panel">
              <h2>{songMap.title}</h2>
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
              {canLineMode && (
                <label className="field">
                  Цель
                  <div className="seg">
                    <button className={lineMode ? 'seg-btn' : 'seg-btn active'} onClick={() => setLineMode(false)}>Ноты</button>
                    <button className={lineMode ? 'seg-btn active' : 'seg-btn'} onClick={() => setLineMode(true)}>Линия 🧪</button>
                  </div>
                  <span className="dim small">
                    {lineMode
                      ? 'экспериментально: пой по контуру-дорожке, очки — за близость к линии'
                      : 'классика: попадай голосом в плашки-ноты'}
                  </span>
                </label>
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
              {play.kind === 'song' && (
                <div className="btn-row tight">
                  <button className="btn ghost" onClick={openEditor}>✎ Редактировать ноты</button>
                  <button className="btn ghost" onClick={() => setTuning(true)}>⚙ Извлечение</button>
                </div>
              )}
            </div>
          </div>
        )}

        {status === 'loading' && (
          <div className="overlay"><div className="panel"><p>Готовим микрофон и аудио…</p></div></div>
        )}

        {status === 'running' && hud.countdown > 0.05 && (
          <div className="overlay transparent"><span className="countdown">{Math.ceil(hud.countdown)}</span></div>
        )}

        {status === 'paused' && !editing && (
          <div className="overlay">
            <div className="panel">
              <h2>Пауза</h2>
              <div className="btn-col">
                <button className="btn primary" onClick={resume}>Продолжить</button>
                {play.kind === 'song' && (
                  <button className="btn" onClick={openEditor}>✎ Редактировать ноты</button>
                )}
                <button className="btn" onClick={restart}>Заново</button>
                <button className="btn" onClick={quit}>Выйти</button>
              </div>
            </div>
          </div>
        )}

        {tuning && (
          <ExtractionPanel
            map={songMap}
            onApplied={(fresh) => {
              // новая карта: ноты/контур другие, ручной октавный выбор сбрасываем
              setSongMap(fresh);
              setOctaveShift(null);
            }}
            onClose={() => setTuning(false)}
          />
        )}

        {editing && editorWindow && (
          <SongEditor
            map={songMap}
            window={editorWindow}
            vocalUrl={songMap.hasVocal ? vocalUrlFor(songMap.id) : null}
            onSave={onEditorSave}
            onClose={onEditorClose}
          />
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
