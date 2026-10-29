// Экран игры: подготовка (сложность/октава/подсказки) → отсчёт → игра →
// пауза/итог. Работает и для упражнений (синт), и для песен (инструментал).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ensureMic, getAudioContext, stopMic } from '../audio/audioSession';
import { ExtractionPanel } from '../components/ExtractionPanel';
import { MelodyPreview } from '../components/MelodyAudition';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';
import './vocal.css';
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
      <div className="screen rp-page vo-page">
        <p className="vo-error">{!range ? t('Define your vocal range first.') : t('Nothing to play.')}</p>
        <button className="rp-btn" onClick={() => navigate(range ? '/' : '/range')}>
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

  // название песни из имени файла: «HIM_-_Join_Me…» → «HIM - Join Me…» (только показ)
  const shownTitle = t(songMap.title).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const durationSec = Math.round(songMap.durationMs / 1000);
  const segItem = (active: boolean) => (active ? 'rp-seg__item seg-btn active' : 'rp-seg__item seg-btn');
  return (
    <div className="screen game vo-game" data-ui="vocal-game">
      {/* .game-header .seg .seg-btn — зацепка защищённого e2e ribbon.cjs: [0] — лента, [1] — ролл */}
      <header className="game-header vo-game__head">
        <button className="rp-btn rp-btn--ghost rp-btn--sm" onClick={quit}>
          <GuitarIcon name="arrow-left" size="sm" />
          {t('Exit')}
        </button>
        <div className="vo-game__title">
          <b>{shownTitle}</b>
          {songMap.subtitle && <span className="rp-faint">{songMap.subtitle}</span>}
        </div>
        {play.kind === 'song' && (
          <div className="rp-stepper vo-game__octave" title={t('Melody shifted into your octave')}>
            <button
              disabled={status === 'running'}
              aria-label={t('Lower octave')}
              onClick={() => {
                setOctaveShift(shift - 1);
                restart();
              }}
            >
              <GuitarIcon name="minus" size="sm" />
            </button>
            <output>{shift === 0 ? t('original') : t('{n} oct.', { n: `${shift > 0 ? '+' : ''}${shift}` })}</output>
            <button
              disabled={status === 'running'}
              aria-label={t('Higher octave')}
              onClick={() => {
                setOctaveShift(shift + 1);
                restart();
              }}
            >
              <GuitarIcon name="plus" size="sm" />
            </button>
          </div>
        )}
        <div className="rp-seg rp-seg--sm seg" title={t('View: vocal ribbon or piano roll')}>
          <button className={segItem(profile.vocalView === 'ribbon')} aria-pressed={profile.vocalView === 'ribbon'} onClick={() => update({ vocalView: 'ribbon' })}>
            {t('Ribbon')}
          </button>
          <button className={segItem(profile.vocalView === 'roll')} aria-pressed={profile.vocalView === 'roll'} onClick={() => update({ vocalView: 'roll' })}>
            {t('Roll')}
          </button>
        </div>
        <button
          className="rp-btn rp-btn--ghost rp-btn--sm"
          aria-pressed={profile.reduceMotion}
          aria-label={profile.reduceMotion ? t('Stationary notes') : t('Scrolling notes')}
          title={t('Notes stay in place; the playhead moves. Pages change without sliding.')}
          onClick={() => update({ reduceMotion: !profile.reduceMotion })}
        >
          <GuitarIcon name={profile.reduceMotion ? 'focus-centered' : 'arrows-horizontal'} size="sm" />
          <span className="vo-game__motion">{profile.reduceMotion ? t('Stationary notes') : t('Scrolling notes')}</span>
        </button>
        {(status === 'running' || status === 'paused') && (
          <button
            className={`rp-btn rp-btn--sm${loop?.b != null ? ' rp-btn--light' : ''}`}
            aria-pressed={!!loop}
            onClick={cycleLoop}
            title={t('Phrase loop (L): press at the start, again at the end, third press clears')}
          >
            <GuitarIcon name="repeat" size="sm" />
            {!loop ? t('Loop A') : loop.b === null ? t('Loop B') : t('Loop ✕')}
          </button>
        )}
        <div className="vo-game__hud">
          <span className="rp-tag">{t(meta.label)}</span>
          {hud.combo > 1 && <span className="vo-game__mult rp-num"><small>×</small>{hud.combo}</span>}
          <span className="rp-num vo-game__score">{hud.score}</span>
        </div>
        {status === 'running' && (
          <button className="rp-btn rp-btn--icon rp-btn--sm" aria-label={t('Pause')} title={t('Pause')} onClick={pause}>
            <GuitarIcon name="player-pause-filled" size="sm" />
          </button>
        )}
      </header>

      <div className="rp-progress vo-game__progress">
        <i style={{ width: `${hud.progress * 100}%` }} />
      </div>

      <div className="game-stage vo-game__stage">
        {engine &&
          (profile.vocalView === 'roll' ? (
            <PianoRoll engine={engine} window={window_} lineMode={lineOn} reduceMotion={profile.reduceMotion} />
          ) : (
            <VocalRibbon engine={engine} window={window_} lineMode={lineOn} reduceMotion={profile.reduceMotion} />
          ))}

        {status === 'setup' && !editing && !tuning && (
          <div className="vo-overlay">
            <div className="vo-setup">
              <aside className="rp-card rp-card--pad vo-setup__intro">
                <span className="rp-label">{t('Melody')}</span>
                <p className="rp-sm rp-muted">{t('The line is the melody; your voice is drawn on top of it.')}</p>
                <div className="vo-melody">
                  <MelodyPreview notes={songMap.notes} />
                  <div className="vo-melody__bar rp-xs rp-faint">
                    <span className="rp-tag">
                      <GuitarIcon name="clock" size="sm" />
                      <span className="rp-num">
                        {Math.floor(durationSec / 60)}:{String(durationSec % 60).padStart(2, '0')}
                      </span>
                    </span>
                    <span className="rp-tag">{t('{n} notes', { n: songMap.notes.length })}</span>
                  </div>
                </div>
                <span className="rp-xs rp-faint vo-setup__tip">
                  <GuitarIcon name="headphones" size="sm" />
                  {t('Sing in headphones')}
                </span>
              </aside>
              <div className="rp-card rp-card--raised rp-card--pad vo-setup__panel">
                <div>
                  <span className="rp-label">{t('Your next take')}</span>
                  <h2 className="rp-h2">{shownTitle}</h2>
                </div>
                <div className="rp-field">
                  <span className="rp-field__head rp-sm">{t('Difficulty')}</span>
                  <div className="rp-seg rp-seg--fill" role="radiogroup" aria-label={t('Difficulty')}>
                    {(Object.keys(DIFFICULTY_META) as Difficulty[]).map((d) => (
                      <button key={d} className="rp-seg__item" role="radio" aria-checked={d === difficulty} onClick={() => setDifficulty(d)}>
                        {t(DIFFICULTY_META[d].label)}
                      </button>
                    ))}
                  </div>
                  <span className="rp-field__hint">
                    {t('±{cents} cents tolerance{octave}', {
                      cents: DIFFICULTY_META[difficulty].toleranceCents,
                      octave: DIFFICULTY_META[difficulty].octaveAgnostic ? t(', octave ignored') : t(', octave matters'),
                    })}
                  </span>
                </div>
                {play.kind === 'exercise' && (
                  <div className="vo-toggles">
                    {(
                      [
                        ['Guide notes', guideNotes, setGuideNotes],
                        ['Metronome', metronome, setMetronome],
                      ] as const
                    ).map(([label, on, set]) => (
                      <div className="rp-toggle-row" key={label}>
                        <button type="button" role="switch" className="rp-switch" aria-checked={on} aria-label={t(label)} onClick={() => set(!on)} />
                        <span className="rp-toggle-row__text">{t(label)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {play.kind === 'song' && (
                  <div className="rp-field">
                    <span className="rp-field__head rp-sm">{t('Playback')}</span>
                    <div className="rp-seg rp-seg--fill" role="radiogroup" aria-label={t('Playback')}>
                      <button className="rp-seg__item" role="radio" aria-checked={backingVariant === 'minus'} onClick={() => setBackingVariant('minus')}>
                        {t('No vocals')}
                      </button>
                      <button className="rp-seg__item" role="radio" aria-checked={backingVariant === 'mix'} onClick={() => setBackingVariant('mix')}>
                        {t('With vocals')}
                      </button>
                      <button
                        className="rp-seg__item"
                        role="radio"
                        aria-checked={backingVariant === 'vocal'}
                        disabled={!songMap.hasVocal}
                        title={songMap.hasVocal ? undefined : t('vocals not separated for this track')}
                        onClick={() => setBackingVariant('vocal')}
                      >
                        {t('Vocals only')}
                      </button>
                    </div>
                    <span className="rp-field__hint">
                      {backingVariant === 'minus' && t('instrumental — you sing the vocals')}
                      {backingVariant === 'mix' && t('the full original — sing along (headphones recommended)')}
                      {backingVariant === 'vocal' && t('extracted vocals only — as a guide (headphones recommended)')}
                    </span>
                  </div>
                )}
                {canLineMode && (
                  <div className="rp-field">
                    <span className="rp-field__head rp-sm">{t('Target')}</span>
                    <div className="rp-seg rp-seg--fill" role="radiogroup" aria-label={t('Target')}>
                      <button className="rp-seg__item" role="radio" aria-checked={!lineMode} onClick={() => setLineMode(false)}>
                        {t('Notes')}
                      </button>
                      <button className="rp-seg__item" role="radio" aria-checked={lineMode} onClick={() => setLineMode(true)}>
                        {t('Line 🧪')}
                      </button>
                    </div>
                    <span className="rp-field__hint">
                      {lineMode
                        ? t('experimental: sing along the contour line, points for staying close')
                        : t('classic: hit the note bars with your voice')}
                    </span>
                  </div>
                )}
                {play.kind === 'song' && (
                  <p className="rp-field__hint">
                    {t('Octave: {mode}. Use the ± buttons up top to change.', {
                      mode:
                        shift === 0
                          ? t('as in the original')
                          : t('shift {shift} — melody moved into your range', { shift: `${shift > 0 ? '+' : ''}${shift}` }),
                    })}
                  </p>
                )}
                {!profile.headphonesWarned && (
                  <p className="rp-chip rp-chip--info vo-setup__warn">
                    {t('🎧 Put on headphones — otherwise the mic hears the backing track and your line jumps around.')}
                  </p>
                )}
                {error && <p className="vo-error">{error}</p>}
                {/* .btn.primary.big — зацепка защищённого e2e ribbon.cjs (старт игры) */}
                <button
                  className="rp-btn rp-btn--light rp-btn--xl btn primary big setup-start"
                  onClick={() => {
                    update({ headphonesWarned: true });
                    void start();
                  }}
                >
                  <GuitarIcon name="player-play-filled" />
                  {t('Let’s go')}
                </button>
                {play.kind === 'song' && (
                  <div className="vo-row">
                    <button className="rp-btn rp-btn--ghost rp-btn--sm" onClick={openEditor}>
                      <GuitarIcon name="wand" size="sm" />
                      {t('Edit notes')}
                    </button>
                    <button className="rp-btn rp-btn--ghost rp-btn--sm" onClick={() => setTuning(true)}>
                      <GuitarIcon name="adjustments-alt" size="sm" />
                      {t('Extraction')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {status === 'loading' && (
          <div className="vo-overlay">
            <div className="rp-card rp-card--raised rp-card--pad vo-panel">
              <GuitarIcon name="loader-2" className="vo-spin" />
              <p>{t('Getting mic and audio ready…')}</p>
            </div>
          </div>
        )}

        {status === 'running' && hud.countdown > 0.05 && (
          <div className="vo-overlay vo-overlay--clear">
            <span className="vo-countdown rp-num">{Math.ceil(hud.countdown)}</span>
          </div>
        )}

        {status === 'paused' && !editing && (
          <div className="vo-overlay">
            <div className="rp-card rp-card--raised rp-card--pad vo-panel">
              <h2 className="rp-h2">{t('Pause')}</h2>
              <div className="vo-col">
                <button className="rp-btn rp-btn--light rp-btn--lg" onClick={resume}>
                  <GuitarIcon name="player-play-filled" size="sm" />
                  {t('Resume')}
                </button>
                {play.kind === 'song' && (
                  <button className="rp-btn" onClick={openEditor}>
                    <GuitarIcon name="wand" size="sm" />
                    {t('Edit notes')}
                  </button>
                )}
                <button className="rp-btn" onClick={restart}>
                  <GuitarIcon name="refresh" size="sm" />
                  {t('Restart')}
                </button>
                <button className="rp-btn rp-btn--ghost" onClick={quit}>
                  <GuitarIcon name="arrow-left" size="sm" />
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
          <div className="vo-overlay">
            <div className="rp-card rp-card--raised rp-card--pad vo-panel">
              <p className="vo-error">{error}</p>
              <button className="rp-btn" onClick={() => setStatus('setup')}>
                {t('Back')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="vo-game__foot rp-xs rp-faint">
        <span>
          <GuitarIcon name="headphones" size="sm" />
          {t('Sing in headphones')}
        </span>
        <span className="vo-game__keys">
          <kbd className="rp-kbd">Space</kbd>
          {t('Play / pause')}
          <kbd className="rp-kbd">← →</kbd>
          {t('Seek')}
          <kbd className="rp-kbd">L</kbd>
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
