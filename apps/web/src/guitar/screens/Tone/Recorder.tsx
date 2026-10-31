// Дека записи экрана «Тон» (состояние — guitar/store/deck.ts, живёт вне экрана) и список дублей. Дека — портативный
// кассетник: кассета с этикеткой текущего дубля и бобинами (крутятся при записи и прослушивании, лента перематывается с
// левой бобины на правую по ходу), индикатор — время и уровень, клавиши REC · PLAY · STOP и выбор звука прослушивания:
// с текущим тоном (крути ручки — дубль звучит по-новому), как записан или сухой DI. Пишется чистый сигнал гитары.
// Список — дубли этого устройства: послушать, переименовать, выгрузить WAV (то, что слышно), удалить.
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { t } from '../../../lib/i18n';
import { HashLink } from '../../HashLink';
import { useInGameSheet } from '../../play/inGame';
import {
  deckDuration, deckForget, deckLevelDb, deckMode, deckPlay, deckRecord, deckRender, deckSeconds, deckSelect, deckStop, useDeck, type PlayMode,
} from '../../store/deck';
import { deleteTake, renameTake, useTakes, type TakeInfo } from '../../store/takes';
import { downloadBlob, safeFileName } from '../../ui/download';
import { GuitarIcon } from '../../ui/GuitarIcon';
import { PupitreLogo } from './PupitreLogo';
import './recorder.css';

const MODE_UI: Record<PlayMode, { label: string }> = {
  current: { label: 'Current tone' },
  recorded: { label: 'As recorded' },
  dry: { label: 'Dry DI' },
};
const MODES: PlayMode[] = ['current', 'recorded', 'dry'];
/** Полная правая бобина при записи — столько секунд. */
const REEL_FULL_S = 600;

const clock = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};
const short = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** fn каждый кадр анимации, пока active. */
function useFrames(active: boolean, fn: () => void) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const frame = () => {
      latest.current();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

/** Кассета: корпус дымчатого пластика, этикетка, окно с бобинами; объём ленты — CSS-переменными --l и --r. */
function Cassette({ title, spin }: { title: string; spin: boolean }) {
  const id = useId().replace(/:/g, '');
  const reel = (cx: number, side: 'l' | 'r') => (
    <g key={side}>
      <circle className={`deck__pack deck__pack--${side}`} cx={cx} cy="86" r="36" fill={`url(#${id}-tape)`} style={{ transformOrigin: `${cx}px 86px` }} />
      <g className="deck__hub" data-spin={spin || undefined} style={{ transformOrigin: `${cx}px 86px` }}>
        <circle cx={cx} cy="86" r="14" fill="#f3f1ea" stroke="#9c988c" strokeWidth="0.8" />
        <circle cx={cx} cy="86" r="8" fill="#141416" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} x={cx - 1.6} y="78" width="3.2" height="4" fill="#f3f1ea" transform={`rotate(${a} ${cx} 86)`} />
        ))}
      </g>
    </g>
  );
  return (
    <svg className="deck__cassette" viewBox="0 0 320 196" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3c41" />
          <stop offset="1" stopColor="#15161a" />
        </linearGradient>
        <radialGradient id={`${id}-tape`} cx="0.45" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#5a3f28" />
          <stop offset="0.7" stopColor="#3a2818" />
          <stop offset="1" stopColor="#24180e" />
        </radialGradient>
        <clipPath id={`${id}-win`}>
          <rect x="62" y="62" width="196" height="48" rx="24" />
        </clipPath>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="314" height="190" rx="12" fill={`url(#${id}-shell)`} stroke="#050506" />
      <rect x="4.5" y="4.5" width="311" height="187" rx="11" fill="none" stroke="#fff" strokeOpacity="0.1" />
      {/* этикетка: полоса, строки, имя дубля */}
      <rect x="20" y="14" width="280" height="110" rx="6" fill="#ece3cb" />
      <rect x="20" y="14" width="280" height="22" rx="6" fill="#d9572c" />
      <rect x="20" y="30" width="280" height="6" fill="#d9572c" />
      <rect x="20" y="36" width="280" height="4" fill="#f0b232" />
      <text x="32" y="30" className="deck__label-a">A</text>
      <text x="290" y="30" className="deck__label-type" textAnchor="end">DI · TYPE II</text>
      <text x="160" y="56" className="deck__label-title" textAnchor="middle">{title}</text>
      {[112, 118].map((y) => <line key={y} x1="30" y1={y} x2="290" y2={y} stroke="#b9ae92" strokeWidth="0.8" />)}
      {/* окно с бобинами */}
      <rect x="62" y="62" width="196" height="48" rx="24" fill="#08080a" />
      <g clipPath={`url(#${id}-win)`}>
        {reel(112, 'l')}
        {reel(208, 'r')}
      </g>
      <rect x="62" y="62" width="196" height="48" rx="24" fill={`url(#${id}-glass)`} stroke="#000" strokeOpacity="0.7" />
      {/* низ: окно головок и направляющие */}
      <path d="M70 193L86 156H234L250 193Z" fill="#202125" stroke="#050506" />
      {[104, 136, 184, 216].map((x) => <rect key={x} x={x - 5} y="168" width="10" height="10" rx="2" fill="#050506" />)}
      {[[14, 14], [306, 14], [14, 182], [306, 182], [160, 178]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.4" fill="#5b5e63" stroke="#111" strokeWidth="0.6" />
      ))}
    </svg>
  );
}

export function Recorder({ inputChosen }: { inputChosen: boolean }) {
  const deck = useDeck();
  const inGame = useInGameSheet();
  const { takes } = useTakes();
  const take = takes.find((x) => x.id === deck.takeId) ?? null;
  const busy = deck.phase === 'recording' || deck.phase === 'saving';
  const live = deck.phase === 'recording' || deck.phase === 'playing';
  const root = useRef<HTMLElement>(null);
  const time = useRef<HTMLSpanElement>(null);

  // время, уровень и бобины — каждый кадр, прямо в DOM
  useFrames(live, () => {
    const el = root.current;
    if (!el) return;
    const sec = deckSeconds();
    if (time.current) time.current.textContent = clock(sec);
    const db = deckLevelDb();
    el.style.setProperty('--lvl', `${Number.isFinite(db) ? Math.min(100, Math.max(0, ((db + 54) / 54) * 100)) : 0}%`);
    const progress = deck.phase === 'recording' ? Math.min(1, sec / REEL_FULL_S) : deckDuration() ? sec / deckDuration() : 0;
    el.style.setProperty('--l', (0.44 + 0.56 * (1 - progress)).toFixed(3));
    el.style.setProperty('--r', (0.44 + 0.56 * progress).toFixed(3));
  });
  useEffect(() => {
    if (live || !root.current) return;
    root.current.style.setProperty('--lvl', '0%');
    if (time.current) time.current.textContent = clock(0);
  }, [live]);

  const status = deck.phase === 'recording' ? 'REC' : deck.phase === 'playing' ? 'PLAY' : deck.phase === 'saving' ? 'SAVE' : deck.phase === 'loading' ? 'LOAD' : 'STOP';
  const title = deck.phase === 'recording' ? t('New take') : take?.name ?? t('Empty cassette');

  return (
    <section className="deck" ref={root} aria-label={t('Recorder')} data-ui="tone-deck" data-phase={deck.phase}
      style={{ '--l': 1, '--r': 0.44, '--lvl': '0%' } as CSSProperties}>
      <div className="deck__body">
        <div className="deck__window">
          <Cassette title={title} spin={live} />
        </div>
        <div className="deck__side">
          <div className="deck__brand">
            <PupitreLogo finish="chrome" className="deck__logo" />
            <span className="deck__model" aria-hidden="true">TAPE • DI-4</span>
          </div>
          <div className="deck__lcd" aria-live="polite">
            <span className="deck__lamp" data-on={deck.phase === 'recording' || undefined} aria-hidden="true" />
            <span className="deck__status" data-ui="tone-deck-status">{status}</span>
            <span className="deck__time rp-num" ref={time} data-ui="tone-deck-time">{clock(0)}</span>
            <span className="deck__meter" aria-hidden="true"><i /></span>
          </div>
          <div className="deck__modes" role="radiogroup" aria-label={t('Listen with')} data-ui="tone-deck-mode">
            {MODES.map((m) => (
              <button key={m} type="button" className="amp-btn" role="radio" aria-checked={deck.mode === m} onClick={() => deckMode(m)}>
                <i className="amp-btn__led" aria-hidden="true" />
                <span className="amp-btn__label">{t(MODE_UI[m].label)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="deck__keys">
          <button type="button" className="deck__key deck__key--rec" aria-pressed={deck.phase === 'recording'} disabled={busy || !inputChosen}
            aria-label={t('Record')} onClick={() => deckRecord(t('Take'))} data-ui="tone-deck-rec">
            <i className="deck__glyph deck__glyph--rec" aria-hidden="true" />
            <span>REC</span>
          </button>
          <button type="button" className="deck__key" aria-pressed={deck.phase === 'playing' || deck.phase === 'loading'} disabled={busy || !takes.length}
            aria-label={t('Listen')} onClick={() => void deckPlay()} data-ui="tone-deck-play">
            <i className="deck__glyph deck__glyph--play" aria-hidden="true" />
            <span>PLAY</span>
          </button>
          <button type="button" className="deck__key" aria-label={t('Stop')} disabled={deck.phase === 'idle' || deck.phase === 'saving'}
            onClick={() => void deckStop()} data-ui="tone-deck-stop">
            <i className="deck__glyph deck__glyph--stop" aria-hidden="true" />
            <span>STOP</span>
          </button>
          <span className="deck__plate" aria-hidden="true">
            <PupitreLogo finish="engraved" className="deck__plate-logo" />
            <span>DI RECORDER · RE-AMP · 24 BIT</span>
          </span>
        </div>
      </div>
      {(!inputChosen || deck.error) && (
        <p className="deck__note" role="status">
          {!inputChosen || deck.error === 'no-input' ? (
            <>
              {t('No input to record from.')}{' '}
              {inGame ? t('It is chosen in Input and sound.') : <HashLink to="/guitar/input">{t('Choose an input')}</HashLink>}
            </>
          ) : deck.error === 'no-audio' ? t('The input gives no sound to record: update the app or choose another input.')
            : t('Something went wrong — try again.')}
        </p>
      )}
    </section>
  );
}

function TakeRow({ take, current, playing, rendering, busy }: {
  take: TakeInfo; current: boolean; playing: boolean; rendering: number | null; busy: boolean;
}) {
  const deck = useDeck();
  const [name, setName] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(timer);
  }, [confirm]);
  const seconds = take.frames / take.sampleRate;
  const exportWav = async () => {
    const blob = await deckRender(take.id, deck.mode);
    if (!blob) return;
    const suffix = deck.mode === 'dry' ? 'DI' : deck.mode === 'recorded' ? t('as recorded') : t('current tone');
    downloadBlob(blob, `${safeFileName(take.name)} — ${safeFileName(suffix)}.wav`);
  };
  return (
    <li className="tone-take" data-current={current || undefined} data-ui="tone-take">
      <button type="button" className="rp-btn rp-btn--icon rp-btn--ghost" aria-label={playing ? t('Stop') : t('Listen')}
        onClick={() => (playing ? void deckStop() : void deckPlay(take.id))} data-ui="tone-take-play">
        <GuitarIcon name={playing ? 'player-stop-filled' : 'player-play-filled'} size="sm" />
      </button>
      {name === null ? (
        <button type="button" className="tone-take__name" onClick={() => deckSelect(take.id)} onDoubleClick={() => setName(take.name)}>
          {take.name}
        </button>
      ) : (
        <form className="tone-take__edit" onSubmit={(e) => {
          e.preventDefault();
          void renameTake(take.id, name);
          setName(null);
        }}>
          <label className="rp-input">
            <input value={name} autoFocus maxLength={60} aria-label={t('Take name')} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                setName(null);
              }} onBlur={() => setName(null)} />
          </label>
        </form>
      )}
      <span className="tone-take__meta rp-num">{short(seconds)}</span>
      <span className="tone-take__meta">{when(take.at)}</span>
      <span className="tone-take__meta">{take.tone.rig === 'bass' ? t('Bass') : t('Guitar')}</span>
      <span className="tone-take__actions">
        <button type="button" className="rp-btn rp-btn--icon rp-btn--ghost" aria-label={t('Rename')} title={t('Rename')} onClick={() => setName(take.name)}
          data-ui="tone-take-rename">
          <GuitarIcon name="wand" size="sm" />
        </button>
        <button type="button" className="rp-btn rp-btn--sm" disabled={busy} onClick={() => void exportWav()} data-ui="tone-take-wav"
          title={t('What you hear: the mode chosen on the recorder.')}>
          <GuitarIcon name="download" size="sm" />
          {rendering !== null ? `${Math.round(rendering * 100)} %` : 'WAV'}
        </button>
        <button type="button" className={`rp-btn rp-btn--sm ${confirm ? 'rp-btn--danger' : 'rp-btn--ghost rp-btn--icon'}`} aria-label={t('Delete')}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            deckForget(take.id);
            void deleteTake(take.id);
          }} data-ui="tone-take-delete">
          <GuitarIcon name="trash" size="sm" />
          {confirm && t('Delete?')}
        </button>
      </span>
    </li>
  );
}

/** Список дублей под установкой (обычный интерфейс «Рампы», не железо). */
export function TakeList() {
  const deck = useDeck();
  const { takes, loaded } = useTakes();
  return (
    <section className="rp-card tone-takes" aria-labelledby="tone-takes" data-ui="tone-takes">
      <span className="rp-section-title">
        <GuitarIcon name="vinyl" size="sm" />
        <span className="rp-label" id="tone-takes">{t('Takes')}</span>
      </span>
      {loaded && !takes.length ? (
        <p className="rp-sm tone-takes__empty">
          {t('Press REC and play — the take appears here. The clean guitar signal is recorded: listen to it later with any sound.')}
        </p>
      ) : (
        <ul className="tone-takes__list">
          {takes.map((take) => (
            <TakeRow key={take.id} take={take} current={deck.takeId === take.id} playing={deck.takeId === take.id && (deck.phase === 'playing' || deck.phase === 'loading')}
              rendering={deck.rendering?.takeId === take.id ? deck.rendering.share : null} busy={deck.rendering !== null} />
          ))}
        </ul>
      )}
    </section>
  );
}
