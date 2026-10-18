// Экран игры: подготовка (сложность/октава/подсказки) → отсчёт → игра →
// пауза/итог. Работает и для упражнений (синт), и для песен (инструментал).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ensureMic, getAudioContext, stopMic } from '../audio/audioSession';
import { ExtractionPanel } from '../components/ExtractionPanel';
import { Icon } from '../components/Icon';
import { MelodyPreview } from '../components/StudioArtwork';
import { useMobileLandscape } from '../components/MobileLandscape';
import { PianoRoll } from '../components/PianoRoll';
import { SeekBar } from '../components/SeekBar';
import { VocalRibbon } from '../components/VocalRibbon';
import { SongEditor } from '../components/SongEditor';
import { GameEngine } from '../game/engine';
import { chooseOctaveShift, rollWindow, shiftNotes, shiftPitchline } from '../game/octave';
import { apiFetch, mixUrl, saveMap, vocalUrl as vocalUrlFor } from '../lib/api';
import { t } from '../lib/i18n';
import { comfortZone } from '../lib/music';
import { contourSegments } from '../lib/pitchline';
import { DIFFICULTY_META, type Difficulty, type MapNote, type SongMap } from '../lib/songMap';
import type { GameSummary } from '../game/scoring';
import { micOptions } from '../lib/profile';
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
  const { blocked } = useMobileLandscape();
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
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
  // A/B-луп фразы: null → точка A поставлена → интервал активен
  const [loop, setLoop] = useState<{ a: number; b: number | null } | null>(null);
  const [tuning, setTuning] = useState(false); // панель настроек извлечения
  const [lineMode, setLineMode] = useState(false); // экспериментально: петь по линии-контуру
  // вариант исполнения: минус / оригинал с вокалом / только извлечённый вокал
  const [backingVariant, setBackingVariant] = useState<'minus' | 'mix' | 'vocal'>('minus');
  // карта живёт в состоянии: редактор нот её меняет
  const [songMap, setSongMap] = useState<SongMap | null>(play?.map ?? null);
  // буфер аккомпанемента кэшируется по url: смена варианта исполнения — новый трек
  const backingBufferRef = useRef<{ url: string; buffer: AudioBuffer } | null>(null);
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
    let m = shiftedMap;
    if (lineOn && m.pitchline) m = { ...m, notes: contourSegments(m.pitchline) };
    if (play?.kind === 'song' && backingVariant !== 'minus') {
      const url = backingVariant === 'mix' ? mixUrl(m.id) : vocalUrlFor(m.id);
      m = { ...m, backing: { kind: 'url', url } };
    }
    return m;
  }, [shiftedMap, lineOn, backingVariant, play?.kind]);

  const window_ = useMemo(() => {
    if (!engineMap || !range) return null;
    return rollWindow(engineMap.notes, range);
  }, [engineMap, range]);

  useEffect(() => () => stopMic(), []);
  useEffect(() => {
    if (blocked && status === 'running' && engine) {
      engine.pause();
      setStatus('paused');
    }
  }, [blocked, engine, status]);
  // уход с экрана любым путём (не только кнопкой «Выйти») глушит движок:
  // иначе запланированный синт/метроном доигрывает поверх следующей игры
  useEffect(() => () => engine?.quit(), [engine]);

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
        <p className="error">{!range ? t('Define your vocal range first.') : t('Nothing to play.')}</p>
        <button className="btn" onClick={() => navigate(range ? '/' : '/range')}>
          {range ? t('To menu') : t('To the wizard')}
        </button>
      </div>
    );
  }

  const start = async () => {
    setStatus('loading');
    setError(null);
    try {
      const ctx = getAudioContext();
      const input = await ensureMic(profile.micDeviceId, micOptions(profile));
      if (engineMap.backing.kind === 'url' && backingBufferRef.current?.url !== engineMap.backing.url) {
        const resp = await apiFetch(engineMap.backing.url);
        if (!resp.ok)
          throw new Error(t('Could not load the backing track ({status})', { status: resp.status }));
        backingBufferRef.current = {
          url: engineMap.backing.url,
          buffer: await ctx.decodeAudioData(await resp.arrayBuffer()),
        };
      }
      update({ difficulty, guideNotes, metronome });
      const engRef: { current: GameEngine | null } = { current: null };
      const eng = new GameEngine({
        ctx,
        input,
        map: engineMap,
        difficulty,
        latencyMs: profile.latencyMs,
        guideNotes,
        metronome,
        lineTarget: lineOn,
        backingBuffer: backingBufferRef.current?.buffer,
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
            state: {
              summary,
              playState: play,
              shiftedMap: engineMap,
              window: window_,
              trail,
              title: songMap.title,
              difficulty,
            },
            replace: true,
          });
        },
      });
      engRef.current = eng;
      setEngine(eng);
      setStatus('running');
      await eng.start();
      if (blockedRef.current) {
        eng.pause();
        setStatus('paused');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to start'));
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
    setLoop(null);
    setStatus('setup');
  };

  /** Кнопка/клавиша лупа: первый раз — точка A, второй — точка B (луп пошёл), третий — сброс. */
  const cycleLoop = () => {
    if (!engine || (status !== 'running' && status !== 'paused')) return;
    const ms = Math.max(0, engine.songMs());
    if (!loop) {
      setLoop({ a: ms, b: null });
    } else if (loop.b === null) {
      const a = Math.min(loop.a, ms);
      const b = Math.max(loop.a, ms, a + 1000); // вырожденный интервал не ставим
      engine.setLoop(a, b);
      setLoop({ a, b });
      engine.seekTo(a);
    } else {
      engine.setLoop(null, null);
      setLoop(null);
    }
  };

  const openEditor = () => {
    engine?.pause();
    setEditing(true);
  };

  // хоткеи: Space — старт/пауза, ←/→ — перемотка ±5 с, Esc — пауза → выход.
  // Логика живёт в ref и обновляется каждый рендер: обработчик в useEffect с
  // депсами держал бы устаревшие замыкания (start со старыми настройками).
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (editing || tuning) return; // у редактора/панели свои клавиши
    if (e.code === 'Space') {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (status === 'running') pause();
      else if (status === 'paused') resume();
      else if (status === 'setup') {
        update({ headphonesWarned: true });
        void start();
      }
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      if (!engine || (status !== 'running' && status !== 'paused')) return;
      e.preventDefault();
      engine.seekTo(engine.songMs() + (e.code === 'ArrowRight' ? 5000 : -5000));
    } else if (e.code === 'KeyL') {
      e.preventDefault();
      cycleLoop();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      if (status === 'running') pause();
      else if (status === 'paused' || status === 'setup' || status === 'finished') quit();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        <button className="btn ghost" onClick={quit}>
          {t('← Exit')}
        </button>
        <div className="game-title">
          <b>{t(songMap.title)}</b>
          {songMap.subtitle && <span className="dim">{songMap.subtitle}</span>}
        </div>
        {play.kind === 'song' && (
          <div className="octave-badge" title={t('Melody shifted into your octave')}>
            <button
              className="btn tiny"
              disabled={status === 'running'}
              onClick={() => {
                setOctaveShift(shift - 1);
                restart();
              }}
            >
              −
            </button>
            <span>
              {shift === 0 ? t('original') : t('{n} oct.', { n: `${shift > 0 ? '+' : ''}${shift}` })}
            </span>
            <button
              className="btn tiny"
              disabled={status === 'running'}
              onClick={() => {
                setOctaveShift(shift + 1);
                restart();
              }}
            >
              +
            </button>
          </div>
        )}
        <div className="seg" title={t('View: vocal ribbon or piano roll')}>
          <button
            className={profile.vocalView === 'ribbon' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => update({ vocalView: 'ribbon' })}
          >
            {t('Ribbon')}
          </button>
          <button
            className={profile.vocalView === 'roll' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => update({ vocalView: 'roll' })}
          >
            {t('Roll')}
          </button>
        </div>
        <button
          className="btn tiny"
          aria-pressed={profile.reduceMotion}
          aria-label={profile.reduceMotion ? t('Stationary notes') : t('Scrolling notes')}
          title={t('Notes stay in place; the playhead moves. Pages change without sliding.')}
          onClick={() => update({ reduceMotion: !profile.reduceMotion })}
        >
          <Icon name={profile.reduceMotion ? 'sliders' : 'waves'} size={16} className="motion-icon" />
          <span className="motion-label">
            {profile.reduceMotion ? t('Stationary notes') : t('Scrolling notes')}
          </span>
        </button>
        {(status === 'running' || status === 'paused') && (
          <button
            className={
              loop?.b != null
                ? 'btn tiny loop-btn active'
                : loop
                  ? 'btn tiny loop-btn armed'
                  : 'btn tiny loop-btn'
            }
            onClick={cycleLoop}
            title={t('Phrase loop (L): press at the start, again at the end, third press clears')}
          >
            {!loop ? t('Loop A') : loop.b === null ? t('Loop B') : t('Loop ✕')}
          </button>
        )}
        <div className="hud">
          <span className="hud-score">{hud.score}</span>
          {hud.combo > 1 && <span className="hud-combo">×{hud.combo}</span>}
          <span className="hud-diff">{t(meta.label)}</span>
        </div>
        {status === 'running' && (
          <button className="btn ghost game-pause" aria-label={t('Pause')} onClick={pause}>
            <Icon name="pause" size={15} />
            <span>{t('Pause')}</span>
          </button>
        )}
      </header>

      <div className="game-progress">
        <div style={{ width: `${hud.progress * 100}%` }} />
      </div>

      <div className="game-stage">
        {engine &&
          (profile.vocalView === 'roll' ? (
            <PianoRoll
              engine={engine}
              window={window_}
              lineMode={lineOn}
              reduceMotion={profile.reduceMotion}
            />
          ) : (
            <VocalRibbon
              engine={engine}
              window={window_}
              lineMode={lineOn}
              reduceMotion={profile.reduceMotion}
            />
          ))}

        {status === 'setup' && !editing && !tuning && (
          <div className="overlay setup-overlay">
            <div className="setup-layout">
              <aside className="session-intro">
                <span className="overline">{t('The practice room')}</span>
                <h2>
                  {t('Listen.')}
                  <br />
                  <span>{t('Find your note.')}</span>
                  <br />
                  {t('Make it yours.')}
                </h2>
                <p>{t('Follow the melody, see your voice, and enjoy getting closer with every take.')}</p>
                <div className="session-preview">
                  <MelodyPreview notes={songMap.notes} />
                  <div>
                    <span>
                      <Icon name="clock" size={14} />
                      {Math.floor(Math.round(songMap.durationMs / 1000) / 60)}:
                      {String(Math.round(songMap.durationMs / 1000) % 60).padStart(2, '0')}
                    </span>
                    <span>{t('{n} notes', { n: songMap.notes.length })}</span>
                  </div>
                </div>
                <span className="session-tip">
                  <Icon name="headphones" size={17} />
                  {t('Headphones on. Everything else can wait.')}
                </span>
              </aside>
              <div className="panel setup-panel">
                <div className="setup-heading">
                  <span className="session-emblem">
                    <Icon name={play.kind === 'song' ? 'note' : 'waves'} size={23} />
                  </span>
                  <span className="overline">{t('Your next take')}</span>
                  <h2>{t(songMap.title)}</h2>
                </div>
                <div className="setup-controls">
                  <label className="field">
                    {t('Difficulty')}
                    <div className="seg">
                      {(Object.keys(DIFFICULTY_META) as Difficulty[]).map((d) => (
                        <button
                          key={d}
                          className={d === difficulty ? 'seg-btn active' : 'seg-btn'}
                          onClick={() => setDifficulty(d)}
                        >
                          {t(DIFFICULTY_META[d].label)}
                        </button>
                      ))}
                    </div>
                    <span className="dim small">
                      {t('±{cents} cents tolerance{octave}', {
                        cents: DIFFICULTY_META[difficulty].toleranceCents,
                        octave: DIFFICULTY_META[difficulty].octaveAgnostic
                          ? t(', octave ignored')
                          : t(', octave matters'),
                      })}
                    </span>
                  </label>
                  {play.kind === 'exercise' && (
                    <>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={guideNotes}
                          onChange={(e) => setGuideNotes(e.target.checked)}
                        />{' '}
                        {t('Guide notes')}
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={metronome}
                          onChange={(e) => setMetronome(e.target.checked)}
                        />{' '}
                        {t('Metronome')}
                      </label>
                    </>
                  )}
                  {play.kind === 'song' && (
                    <label className="field">
                      {t('Playback')}
                      <div className="seg">
                        <button
                          className={backingVariant === 'minus' ? 'seg-btn active' : 'seg-btn'}
                          onClick={() => setBackingVariant('minus')}
                        >
                          {t('No vocals')}
                        </button>
                        <button
                          className={backingVariant === 'mix' ? 'seg-btn active' : 'seg-btn'}
                          onClick={() => setBackingVariant('mix')}
                        >
                          {t('With vocals')}
                        </button>
                        <button
                          className={backingVariant === 'vocal' ? 'seg-btn active' : 'seg-btn'}
                          disabled={!songMap.hasVocal}
                          title={songMap.hasVocal ? undefined : t('vocals not separated for this track')}
                          onClick={() => setBackingVariant('vocal')}
                        >
                          {t('Vocals only')}
                        </button>
                      </div>
                      <span className="dim small">
                        {backingVariant === 'minus' && t('instrumental — you sing the vocals')}
                        {backingVariant === 'mix' &&
                          t('the full original — sing along (headphones recommended)')}
                        {backingVariant === 'vocal' &&
                          t('extracted vocals only — as a guide (headphones recommended)')}
                      </span>
                    </label>
                  )}
                  {canLineMode && (
                    <label className="field">
                      {t('Target')}
                      <div className="seg">
                        <button
                          className={lineMode ? 'seg-btn' : 'seg-btn active'}
                          onClick={() => setLineMode(false)}
                        >
                          {t('Notes')}
                        </button>
                        <button
                          className={lineMode ? 'seg-btn active' : 'seg-btn'}
                          onClick={() => setLineMode(true)}
                        >
                          {t('Line 🧪')}
                        </button>
                      </div>
                      <span className="dim small">
                        {lineMode
                          ? t('experimental: sing along the contour line, points for staying close')
                          : t('classic: hit the note bars with your voice')}
                      </span>
                    </label>
                  )}
                  {play.kind === 'song' && (
                    <p className="dim small">
                      {t('Octave: {mode}. Use the ± buttons up top to change.', {
                        mode:
                          shift === 0
                            ? t('as in the original')
                            : t('shift {shift} — melody moved into your range', {
                                shift: `${shift > 0 ? '+' : ''}${shift}`,
                              }),
                      })}
                    </p>
                  )}
                  {!profile.headphonesWarned && (
                    <p className="hint">
                      {t(
                        '🎧 Put on headphones — otherwise the mic hears the backing track and your line jumps around.',
                      )}
                    </p>
                  )}
                  {error && <p className="error">⚠️ {error}</p>}
                </div>
                <button
                  className="btn primary big setup-start"
                  onClick={() => {
                    update({ headphonesWarned: true });
                    void start();
                  }}
                >
                  <Icon name="play" size={18} />
                  {t('Let’s go')}
                  <Icon name="arrow" size={18} />
                </button>
                {play.kind === 'song' && (
                  <div className="btn-row tight">
                    <button className="btn ghost" onClick={openEditor}>
                      {t('✎ Edit notes')}
                    </button>
                    <button className="btn ghost" onClick={() => setTuning(true)}>
                      {t('⚙ Extraction')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {status === 'loading' && (
          <div className="overlay">
            <div className="panel">
              <p>{t('Getting mic and audio ready…')}</p>
            </div>
          </div>
        )}

        {status === 'running' && hud.countdown > 0.05 && (
          <div className="overlay transparent">
            <span className="countdown">{Math.ceil(hud.countdown)}</span>
          </div>
        )}

        {status === 'paused' && !editing && (
          <div className="overlay">
            <div className="panel">
              <h2>{t('Pause')}</h2>
              <div className="btn-col">
                <button className="btn primary" onClick={resume}>
                  {t('Resume')}
                </button>
                {play.kind === 'song' && (
                  <button className="btn" onClick={openEditor}>
                    {t('✎ Edit notes')}
                  </button>
                )}
                <button className="btn" onClick={restart}>
                  {t('Restart')}
                </button>
                <button className="btn" onClick={quit}>
                  {t('Exit')}
                </button>
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
              <button className="btn" onClick={() => setStatus('setup')}>
                {t('Back')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="game-shortcuts">
        <span>
          <Icon name="headphones" size={14} />
          {t('Your voice. Your pace.')}
        </span>
        <span className="desktop-shortcut">
          <kbd>Space</kbd>
          {t('Play / pause')}
          <kbd>← →</kbd>
          {t('Seek')}
          <kbd>L</kbd>
          {t('Loop')}
        </span>
        <span>{profile.reduceMotion ? t('Stationary notes') : t('Scrolling notes')}</span>
      </div>
      {engine && (status === 'running' || status === 'paused') && (
        <SeekBar engine={engine} window={window_} loop={loop} onSeek={(ms) => engine.seekTo(ms)} />
      )}
    </div>
  );
}
