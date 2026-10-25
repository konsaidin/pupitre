// Игра (ui-spec §11.6, §10.3; этап 13b–c, срез 1; оценка — M2): дорожка на весь экран под синт-минус, HUD сверху
// («СЕКЦИЯ · ТАКТ n / N · м:сс»; с выбранным входом — точность, серия, очки, множитель; без него — «Без оценки»), снизу
// слева — пилюля входа, отсчёт крупной цифрой, пауза, итоги. Клавиши: Space — старт/пауза/дальше, Esc — пауза, на паузе
// — выход; ←/→ — ±5 с; PgUp/PgDn — секции; L — луп секции; F — во весь экран; T — 3D/табулатура.
// HUD обновляется опросом ~8 Гц (как GameScreen), не из кадра дорожки.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPlaybackContext } from '../../../audio/guitar/playback';
import { onInputFrames } from '../../../audio/instrument/session';
import { currentLang, t } from '../../../lib/i18n';
import { midiToName } from '../../../lib/music';
import type { GamePhase } from '../../../game/engine';
import { comboMultiplier, type GameSummary } from '../../../game/scoring';
import { GameInputPill } from '../../input/InputPill';
import { backingLayers, synthBuffers } from '../../backing/synthBacking';
import { GuitarHighway } from '../../highway/GuitarHighway';
import type { GuitarSong, TabMap } from '../../model/types';
import { createPlaySession, type PlaySession } from '../../play/session';
import { guitarLibrary, renderBacking } from '../../store/library';
import { loadGuitarSettings, updateGuitarSettings, useGuitarSettings } from '../../store/settings';
import { GuitarIcon } from '../../ui/GuitarIcon';
import './play.css';

/** /guitar/play/:songId/:arrId → [songId, arrId] (разбор пути сам: useParams утяжелил бы входной чанк). */
export function playIds(pathname: string): [string, string] | null {
  const m = /^\/guitar\/play\/([^/]+)\/([^/]+)/.exec(pathname);
  return m ? [decodeURIComponent(m[1]), decodeURIComponent(m[2])] : null;
}
export const playHref = (songId: string, arrId: string) => `#/guitar/play/${encodeURIComponent(songId)}/${encodeURIComponent(arrId)}`;
export const songHref = (songId: string) => `#/guitar/song/${encodeURIComponent(songId)}`;

const noteName = (midi: number) => midiToName(midi).replace('#', '♯');

/** Режим обучения: чем ждём — лад и нота (у аккорда — имя или ноты). */
function WaitingChip({ event }: { event: TabMap['notes'][number] }) {
  const single = event.notes.length === 1 ? event.notes[0] : null;
  return (
    <div className="game__waiting" role="status" data-ui="play-waiting">
      <span className="rp-chip rp-chip--light">
        <GuitarIcon name="hand-finger" size="sm" />
        {t('Play it to go on')}
        <b className="rp-num">
          {single
            ? `${single.fret ? `${t('fret')} ${single.fret}` : t('open string')} · ${noteName(single.midi)}`
            : event.notes.map((n) => noteName(n.midi)).join(' ')}
        </b>
      </span>
    </div>
  );
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Hud {
  phase: GamePhase;
  songMs: number;
  countdown: number;
  section: string;
  bar: number;
  loop: string | null;
  score: number;
  combo: number;
  /** Доля по оценённым событиям; NaN — ещё ни одного. */
  accuracy: number;
  /** Режим обучения: событие, которого ждём (−1 — не ждём). */
  waitingFor: number;
  /** Остаток отсчёта, с (короткий разгон после ожидания — не отсчёт). */
  countdownSec: number;
}

/** «96,4» / «96.4». */
const percent = (x: number) => (Number.isFinite(x) ? (x * 100).toFixed(1).replace('.', currentLang() === 'ru' ? ',' : '.') : '—');
/** «128 450» — по разрядам. */
const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');

/** Секция и такт на моменте ms (по картам секций и тактов, в порядке исполнения). */
export function whereAt(map: TabMap, ms: number): { section: string; sectionIndex: number; bar: number } {
  const sectionIndex = map.sections.findIndex((s) => ms >= s.startMs && ms < s.endMs);
  let bar = map.bars.findIndex((b) => ms >= b.startMs && ms < b.endMs);
  if (bar < 0) bar = ms < (map.bars[0]?.startMs ?? 0) ? 0 : map.bars.length - 1;
  return { section: sectionIndex >= 0 ? map.sections[sectionIndex].name : '', sectionIndex, bar: bar + 1 };
}

type Load =
  | { phase: 'loading' }
  | { phase: 'rendering'; song: GuitarSong; arrName: string }
  | { phase: 'ready'; song: GuitarSong; arrName: string; session: PlaySession }
  | { phase: 'error'; error: string };

export function PlayScreen() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [settings] = useGuitarSettings();
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [hud, setHud] = useState<Hud | null>(null);
  const [summary, setSummary] = useState<GameSummary | null>(null);
  // «Сыграть ещё» — новая сессия тем же эффектом
  const [round, setRound] = useState(0);
  const sessionRef = useRef<PlaySession | null>(null);

  // Сессия: контекст, минус, движок — создаются и освобождаются в одном эффекте (StrictMode).
  useEffect(() => {
    const ids = playIds(pathname);
    if (!ids) return;
    let cancelled = false;
    let session: PlaySession | null = null;
    const ctx = createPlaybackContext();
    (async () => {
      const lib = await guitarLibrary();
      await lib.refreshIfStale(ids[0]); // ▶ из библиотеки идёт мимо подготовки песни
      const [song, arr] = await Promise.all([lib.getSong(ids[0]), lib.getArrangement(ids[1])]);
      if (!song || !arr) throw new Error(t('Song not found'));
      if (cancelled) return;
      setLoad({ phase: 'rendering', song, arrName: arr.name });
      const buffers = await synthBuffers(ctx, {
        arr, speed: 1, render: renderBacking,
        scoreBytes: async () => new Uint8Array(await (await lib.getFile(song.scoreFileId))!.blob.arrayBuffer()),
      });
      if (cancelled) return;
      // оценка — когда вход выбран (кадры анализа идут, пока вход открыт: сессия входа держит его на весь раздел)
      const current = loadGuitarSettings();
      const scoring =
        current.input.deviceId !== null
          ? { frames: { onFrame: onInputFrames }, a4Hz: current.reference.a4Hz, strictness: current.strictness, learn: current.learn }
          : undefined;
      session = createPlaySession({
        ctx, arr, layers: backingLayers(buffers, current.mix), speed: 1, metronome: false, scoring,
        onFinish: (result) => (scoring ? setSummary(result) : navigate(`/guitar/song/${encodeURIComponent(song.id)}`)),
      });
      sessionRef.current = session;
      void lib.updateSong(song.id, { lastPlayedAt: Date.now() });
      setLoad({ phase: 'ready', song, arrName: arr.name, session });
    })().catch((e: Error) => {
      if (!cancelled) setLoad({ phase: 'error', error: e.message ?? String(e) });
    });
    return () => {
      cancelled = true;
      sessionRef.current = null;
      session?.dispose();
      void ctx.close();
    };
  }, [pathname, navigate, round]);

  // HUD — опросом ~8 Гц.
  useEffect(() => {
    if (load.phase !== 'ready') return;
    const { engine, map } = load.session;
    const poll = () => {
      const ms = engine.songMs();
      const where = whereAt(map, ms);
      const loop = engine.loopA !== null && engine.loopB !== null ? `${whereAt(map, engine.loopA).bar}–${whereAt(map, engine.loopB - 1).bar}` : null;
      let judged = 0;
      let ratio = 0;
      for (const r of engine.results) {
        if (!r) continue;
        judged++;
        ratio += r.hitRatio;
      }
      setHud({
        phase: engine.phase, songMs: ms, countdown: Math.ceil(engine.countdownRemaining()), section: where.section, bar: where.bar, loop,
        score: engine.score, combo: engine.combo, accuracy: judged ? ratio / judged : NaN,
        waitingFor: load.session.learn?.waitingFor() ?? -1,
        countdownSec: engine.countdownRemaining(),
      });
    };
    poll();
    const timer = setInterval(poll, 80);
    return () => clearInterval(timer);
  }, [load]);

  // Клавиши — через ref на сессию (как GameScreen: обработчик не пересоздаётся на каждый кадр HUD).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = sessionRef.current;
      if (!s || e.repeat) return;
      const { engine, map } = s;
      const ms = engine.songMs();
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (engine.phase === 'idle') void engine.start();
          else if (engine.phase === 'paused') engine.resume();
          else engine.pause();
          break;
        case 'Escape':
          if (engine.phase === 'paused' || engine.phase === 'idle') navigate(-1);
          else engine.pause();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          engine.seekTo(ms + (e.code === 'ArrowLeft' ? -5000 : 5000));
          break;
        case 'PageUp':
        case 'PageDown': {
          e.preventDefault();
          const { sectionIndex } = whereAt(map, ms);
          const sections = map.sections;
          if (!sections.length) break;
          const here = sections[Math.max(0, sectionIndex)];
          const target = e.code === 'PageDown'
            ? sections[Math.min(sections.length - 1, sectionIndex + 1)]
            : ms - here.startMs > 2000 ? here : sections[Math.max(0, sectionIndex - 1)];
          engine.seekTo(target.startMs);
          break;
        }
        case 'KeyL': {
          if (engine.loopA !== null) {
            engine.setLoop(null, null);
            break;
          }
          // Луп секции; без секций — четыре такта от текущего.
          const { sectionIndex, bar } = whereAt(map, ms);
          const span = sectionIndex >= 0
            ? [map.sections[sectionIndex].startMs, map.sections[sectionIndex].endMs]
            : [map.bars[bar - 1].startMs, map.bars[Math.min(map.bars.length - 1, bar + 2)].endMs];
          engine.setLoop(span[0], span[1]);
          break;
        }
        case 'KeyF':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.();
          break;
        case 'KeyT':
          updateGuitarSettings((st) => ({ ...st, view: { ...st.view, mode: st.view.mode === '3d' ? 'tab' : '3d' } }));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (load.phase === 'error')
    return (
      <div className="game" data-ui="play">
        <div className="game__overlay">
          <h1 className="rp-h2">{t('Could not open the song')}</h1>
          <p>{load.error}</p>
          <button type="button" className="rp-btn" onClick={() => navigate('/guitar')}>
            {t('Back to the library')}
          </button>
        </div>
      </div>
    );

  const ready = load.phase === 'ready' ? load.session : null;
  const song = load.phase === 'loading' ? null : load.song;
  const view = { ...settings.view, leftHanded: settings.instrument.leftHanded };
  const songMs = () => {
    const s = sessionRef.current;
    if (!s) return 0;
    const phase = s.engine.phase;
    return phase === 'playing' || phase === 'countdown' ? s.transport.heardSongMs() : s.engine.songMs();
  };
  const total = ready?.map.durationMs ?? 0;

  return (
    <div className={`game${view.mode === 'tab' ? ' game--tab' : ''}`} data-ui="play">
      {ready && <GuitarHighway adapted={ready.adapted} songMs={songMs} visualOffsetMs={settings.visualOffsetMs} view={view} />}
      <div className="game__scrim" />
      <header className="hud-top">
        <div className="hud-left">
          <button type="button" className="hud-btn" data-ui="play-pause"
            aria-label={hud?.phase === 'playing' || hud?.phase === 'countdown' || hud?.phase === 'waiting' ? t('Pause (Esc)') : t('Play')}
            onClick={() => {
              const engine = ready?.engine;
              if (!engine) return;
              if (engine.phase === 'idle') void engine.start();
              else if (engine.phase === 'paused') engine.resume();
              else engine.pause();
            }}>
            <GuitarIcon name={hud?.phase === 'playing' || hud?.phase === 'countdown' || hud?.phase === 'waiting' ? 'player-pause-filled' : 'player-play-filled'} />
          </button>
          <div className="hud-song">
            <b>{song?.title ?? ''}</b>
            <span>{load.phase !== 'loading' ? load.arrName : ''} · 100 %</span>
          </div>
        </div>
        <div className="hud-center">
          <div className="game__progress" aria-hidden="true">
            <i style={{ ['--p' as string]: `${total ? Math.min(100, ((hud?.songMs ?? 0) / total) * 100) : 0}%` }} />
          </div>
          <div className="hud-section" data-ui="play-where">
            {hud?.section && (
              <>
                <b>{hud.section}</b>
                <i />
              </>
            )}
            <span>
              {t('bar')} {hud?.bar ?? 1} / {ready?.map.bars.length ?? 0}
            </span>
            <i />
            <span data-ui="play-time">{clock(hud?.songMs ?? 0)}</span>
          </div>
        </div>
        <div className="hud-right">
          {ready?.scoring ? (
            <>
              <div className="hud-stat" data-ui="play-accuracy">
                <span className="rp-label">{t('Accuracy')}</span>
                <span className="hud-stat__v">
                  {percent(hud?.accuracy ?? NaN)}
                  <span className="rp-unit">%</span>
                </span>
              </div>
              <div className="hud-stat hud-streak" data-ui="play-streak">
                <span className="rp-label">{t('Streak')}</span>
                <span className="hud-stat__v">
                  <GuitarIcon name="flame" size="sm" />
                  {hud?.combo ?? 0}
                </span>
              </div>
              <div className="hud-stat hud-score" data-ui="play-score">
                <span className="rp-label">{t('Score')}</span>
                <span className="hud-stat__v">{thousands(hud?.score ?? 0)}</span>
              </div>
              <div className="hud-mult" aria-label={`${t('Multiplier')} ${comboMultiplier(hud?.combo ?? 0)}`}>
                <span>
                  <small>×</small>
                  {comboMultiplier(hud?.combo ?? 0)}
                </span>
              </div>
            </>
          ) : (
            <span className="rp-chip rp-chip--dot game__nojudge" title={t('Choose an input in Input and sound to get scored')}>
              {t('No scoring')}
            </span>
          )}
        </div>
      </header>
      {(hud?.loop || ready?.scoring) && (
        <footer className="hud-bottom">
          <div className="hud-pills">{ready?.scoring && <GameInputPill />}</div>
          <div className="hud-pills">
            {hud?.loop && (
              <span className="hud-pill" data-ui="play-loop">
                <GuitarIcon name="repeat" size="sm" />
                <b>
                  {t('Bars')} {hud.loop}
                </b>
              </span>
            )}
          </div>
        </footer>
      )}
      {hud?.phase === 'countdown' && hud.countdownSec > 0.3 && <div className="game__count" data-ui="play-countdown">{hud.countdown}</div>}
      {ready && hud?.phase === 'waiting' && hud.waitingFor >= 0 && <WaitingChip event={ready.map.notes[hud.waitingFor]} />}
      {load.phase !== 'ready' && (
        <div className="game__overlay" data-ui="play-preparing">
          <span className="rp-chip rp-chip--spin rp-chip--light">
            <GuitarIcon name="loader-2" size="sm" />
            {t('Preparing the backing track…')}
          </span>
        </div>
      )}
      {ready && hud?.phase === 'idle' && (
        <div className="game__overlay" data-ui="play-start">
          <h1 className="rp-h1">{song?.title}</h1>
          <p>
            {ready.scoring
              ? t('Play the highway: notes light up when you hit them. Space — pause, ←/→ — ±5 s, L — loop the section, T — tablature.')
              : t('Play along with the highway. Space — pause, ←/→ — ±5 s, L — loop the section, T — tablature.')}
          </p>
          <div className="rp-seg game__mode" role="radiogroup" aria-label={t('How to play')} data-ui="play-mode">
            {([false, true] as const).map((learn) => (
              <button
                key={String(learn)}
                type="button"
                className="rp-seg__item"
                role="radio"
                aria-checked={settings.learn === learn && (ready.scoring || !learn)}
                disabled={learn && !ready.scoring}
                title={learn && !ready.scoring ? t('Learning needs an input: choose it in Input and sound') : undefined}
                onClick={() => {
                  updateGuitarSettings((st) => ({ ...st, learn }));
                  ready.setLearn(learn);
                }}
              >
                <GuitarIcon name={learn ? 'hand-finger' : 'player-play'} size="sm" />
                {learn ? t('Learn the song') : t('Play through')}
              </button>
            ))}
          </div>
          <p className="rp-sm rp-faint game__mode-hint">
            {settings.learn && ready.scoring ? t('The song waits on every note until you play it.') : t('The song plays on; misses are counted.')}
          </p>
          <button type="button" className="rp-btn rp-btn--light rp-btn--lg" onClick={() => void ready.engine.start()} data-ui="play-go">
            <GuitarIcon name="player-play-filled" size="sm" />
            {t('Play')} <span className="rp-kbd">Space</span>
          </button>
        </div>
      )}
      {ready && hud?.phase === 'paused' && (
        <div className="game__overlay" data-ui="play-paused">
          <div className="game__pause" role="dialog" aria-label={t('Pause')}>
            <span className="rp-label">{t('Pause')}</span>
            <div className="pause__time">
              {clock(hud.songMs)} <span>/ {clock(total)}</span>
            </div>
            <button type="button" className="pause__item" onClick={() => ready.engine.resume()}>
              <GuitarIcon name="player-play-filled" />
              {t('Continue')}
              <span className="rp-kbd">Space</span>
            </button>
            <button type="button" className="pause__item" onClick={() => ready.engine.seekTo(0)}>
              <GuitarIcon name="player-skip-back" />
              {t('Start over')}
            </button>
            <button type="button" className="pause__item"
              onClick={() => updateGuitarSettings((st) => ({ ...st, view: { ...st.view, mode: st.view.mode === '3d' ? 'tab' : '3d' } }))}>
              <GuitarIcon name="eye" />
              {view.mode === '3d' ? t('Show tablature') : t('Show 3D highway')}
              <span className="rp-kbd">T</span>
            </button>
            <div className="pause__sep" />
            <button type="button" className="pause__item pause__item--danger" onClick={() => navigate(-1)}>
              <GuitarIcon name="x" />
              {t('Finish')}
              <span className="rp-kbd">Esc</span>
            </button>
          </div>
        </div>
      )}
      {summary && song && (
        <div className="game__overlay" data-ui="play-results">
          <div className="game__pause" role="dialog" aria-label={t('Results')}>
            <span className="rp-label">{t('Results')}</span>
            <div className="pause__time" data-ui="results-accuracy">
              {percent(summary.accuracy)} <span>%</span>
            </div>
            <div className="results__rows">
              <span>{t('Hits')}</span>
              <b data-ui="results-hits">{summary.perfect + summary.good}</b>
              <span>{t('of them on the beat')}</span>
              <b>{summary.perfect}</b>
              <span>{t('Misses')}</span>
              <b data-ui="results-misses">{summary.miss}</b>
              <span>{t('Best streak')}</span>
              <b>{summary.maxCombo}</b>
              <span>{t('Score')}</span>
              <b>{thousands(summary.score)}</b>
            </div>
            <button type="button" className="pause__item" data-ui="results-again"
              onClick={() => {
                setSummary(null);
                setRound((r) => r + 1);
              }}>
              <GuitarIcon name="refresh" />
              {t('Play again')}
            </button>
            <button type="button" className="pause__item" onClick={() => navigate(`/guitar/song/${encodeURIComponent(song.id)}`)}>
              <GuitarIcon name="arrow-left" />
              {t('Back to the song')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
