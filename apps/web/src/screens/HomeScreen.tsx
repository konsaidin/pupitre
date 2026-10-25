// Обзор вокального режима на «Рампе»: заголовок страницы с датой; «Начать» — постер, призыв (распевка или
// знакомство с голосом) и показатели (занятий, средняя точность, серия); карточка «Мой голос» (тип, диапазон, полоса
// клавиш C2–C6); три плитки практики с постерами; пианино студии; ритм недели и последние результаты.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EXERCISES } from '../game/exercises';
import { listSongs } from '../lib/api';
import { currentLang, t } from '../lib/i18n';
import { classifyRange, midiToName } from '../lib/music';
import { practiceStreak } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { GuitarIcon, type GuitarIconName } from '../guitar/ui/GuitarIcon';
import { RampaPoster } from '../components/RampaPoster';
import { StudioPiano } from '../components/StudioPiano';
import './vocal.css';

const noteName = (midi: number) => midiToName(midi).replace('#', '♯');

export function HomeScreen() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const r = profile.range;
  const [songCount, setSongCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    listSongs(false)
      .then((songs) => {
        if (alive) setSongCount(songs.filter((s) => s.status === 'done').length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const warmups = EXERCISES.filter((e) => e.category === 'Warm-ups').length;
  const scores = profile.scores;
  const avgAccuracy = scores.length
    ? Math.round((scores.reduce((v, s) => v + s.accuracy, 0) / scores.length) * 100)
    : null;
  const streak = practiceStreak(scores);
  const today = new Date();
  const locale = currentLang() === 'ru' ? 'ru-RU' : 'en-GB';
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    return { day, practiced: scores.some((s) => s.playedAt >= day.getTime() && s.playedAt < next.getTime()) };
  });

  return (
    <div className="screen home rp-page vo-page" data-ui="vocal-home">
      <header className="vo-head">
        <div>
          <span className="rp-label">{t('Your personal voice studio')}</span>
          <h1 className="rp-h1">{t('Find your flow.')}</h1>
        </div>
        <span className="rp-chip rp-chip--plain vo-date">
          <GuitarIcon name="clock" size="sm" />
          {today.toLocaleDateString(locale, { day: 'numeric', month: 'long', weekday: 'short' })}
        </span>
      </header>

      <div className="vo-top">
        <section className="rp-card vo-continue">
          <RampaPoster seed="pupitre-voice" glyph="♪" className="vo-continue__poster" />
          <div className="vo-continue__body">
            <div>
              <span className="rp-label">{t('Made for your voice')}</span>
              <h2 className="vo-continue__title">
                {t('Your voice.')} <span className="rp-muted">{t('More possibility.')}</span>
              </h2>
              <p className="vo-continue__text">{t('Find your notes, feel the melody, and make a little progress every day.')}</p>
            </div>
            <div className="vo-stats">
              <Stat value={String(scores.length)} label={t('sessions completed')} />
              <Stat value={avgAccuracy === null ? '—' : String(avgAccuracy)} unit={avgAccuracy === null ? undefined : '%'} label={t('average accuracy')} />
              <Stat value={String(streak)} label={t('Days in a row')} />
            </div>
            <div className="vo-continue__foot">
              <button className="rp-btn rp-btn--light rp-btn--lg" onClick={() => navigate(r ? '/exercises?cat=Warm-ups' : '/range')} data-ui="home-start">
                <GuitarIcon name={r ? 'player-play-filled' : 'microphone'} />
                {r ? t('Start a warm-up') : t('Discover my voice')}
              </button>
              <span className="rp-xs rp-faint">
                {r ? t('Your range. Your pace. Your next step.') : t('One minute to find your starting point.')}
              </span>
            </div>
          </div>
        </section>
        <VoiceCard />
      </div>

      <div className="vo-section">
        <h2 className="rp-h3">{t('What shall we sing?')}</h2>
        <span className="rp-sm rp-faint">{t('Small steps. A stronger voice.')}</span>
      </div>
      <div className="vo-tiles">
        <PracticeTile
          seed="warm-ups"
          glyph="01"
          icon="wave-sine"
          title={t('Warm-ups')}
          desc={t('Ease into your voice. Long tones, gentle sirens, and a fresh start.')}
          foot={t('{n} exercises', { n: warmups })}
          onClick={() => navigate(r ? '/exercises?cat=Warm-ups' : '/range')}
        />
        <PracticeTile
          seed="skills"
          glyph="02"
          icon="target"
          title={t('Build your skills')}
          desc={t('Find the center of every note. Scales, intervals, and vocal technique.')}
          foot={t('{n} exercises', { n: EXERCISES.length - warmups })}
          onClick={() => navigate(r ? '/exercises' : '/range')}
        />
        <PracticeTile
          seed="songs-you-love"
          glyph="03"
          icon="music"
          title={t('Sing what you love')}
          desc={t('Turn your favorite songs into a practice session. Bring your own soundtrack.')}
          foot={songCount === null ? t('Open the library') : t('{n} songs ready', { n: songCount })}
          onClick={() => navigate('/songs')}
        />
      </div>

      <StudioPiano />

      <div className="vo-bottom">
        <section className="rp-card rp-card--pad">
          <div className="rp-card__head">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="activity" />
              {t('Your rhythm')}
            </h2>
            <span className="rp-chip">
              <GuitarIcon name="flame" size="sm" />
              {t('{n} d.', { n: streak })}
            </span>
          </div>
          <div className="vo-week">
            {week.map(({ day, practiced }, i) => (
              <div key={i} className={`vo-day${practiced ? ' vo-day--on' : ''}${i === 6 ? ' vo-day--today' : ''}`}>
                <span className="rp-label">{day.toLocaleDateString(locale, { weekday: 'short' })}</span>
                <span className="vo-day__mark" aria-label={practiced ? t('Practiced') : t('No practice yet')}>
                  {practiced && <GuitarIcon name="check" size="sm" />}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="rp-card rp-card--pad">
          <div className="rp-card__head">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="history" />
              {t('Recent results')}
            </h2>
            <button className="rp-btn rp-btn--ghost rp-btn--sm" onClick={() => navigate('/settings')}>
              <GuitarIcon name="adjustments-horizontal" size="sm" />
              {t('Set up your studio')} · <span className="rp-num">{profile.latencyMs} {t('ms')}</span>
            </button>
          </div>
          {scores.length > 0 ? (
            <ul className="vo-results">
              {scores.slice(0, 3).map((s, i) => (
                <li key={`${s.playedAt}-${i}`}>
                  <b>{t(s.title)}</b>
                  <span className="vo-stars" aria-label={`${s.stars} / 3`}>
                    {[0, 1, 2].map((k) => (
                      <GuitarIcon key={k} name={k < s.stars ? 'star-filled' : 'star'} size="sm" />
                    ))}
                  </span>
                  <span className="rp-num vo-results__acc">
                    {Math.round(s.accuracy * 100)}
                    <small>%</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rp-empty vo-empty">
              <GuitarIcon name="headphones" size="lg" />
              <p>
                {t('Your first session starts a story.')} <span className="rp-faint">{t('Sing a little. Your progress will appear here.')}</span>
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="rp-stat">
      <span className="rp-label">{label}</span>
      <span className="rp-stat__v">
        {value}
        {unit && <span className="rp-unit">{unit}</span>}
      </span>
    </div>
  );
}

function PracticeTile({ seed, glyph, icon, title, desc, foot, onClick }: {
  seed: string;
  glyph: string;
  icon: GuitarIconName;
  title: string;
  desc: string;
  foot: string;
  onClick: () => void;
}) {
  return (
    <button className="rp-card vo-tile" onClick={onClick}>
      <RampaPoster seed={seed} glyph={glyph} className="vo-tile__poster">
        <span className="vo-tile__icon">
          <GuitarIcon name={icon} />
        </span>
      </RampaPoster>
      <span className="vo-tile__body">
        <span className="rp-h3">{title}</span>
        <span className="rp-sm rp-muted">{desc}</span>
        <span className="vo-tile__foot">
          <span className="rp-chip">{foot}</span>
          <GuitarIcon name="arrow-right" />
        </span>
      </span>
    </button>
  );
}

function VoiceCard() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const r = profile.range;
  return (
    <section className="rp-card rp-card--pad vo-voice">
      <div className="rp-card__head">
        <span className="rp-label">{t('Your instrument')}</span>
        <GuitarIcon name="microphone" size="sm" />
      </div>
      <div>
        <div className="rp-h2">{r ? t(classifyRange(r.lowMidi, r.highMidi)) : t('One of a kind.')}</div>
        <div className="rp-sm rp-muted">{r ? t('This is your vocal range') : t('Let’s get to know your voice')}</div>
      </div>
      <div className="vo-voice__range rp-num">
        {r ? (
          <>
            {noteName(r.lowMidi)} <span className="rp-faint">—</span> {noteName(r.highMidi)}
          </>
        ) : (
          <span className="rp-faint">? — ?</span>
        )}
      </div>
      <div className="vo-keys" aria-hidden="true">
        {Array.from({ length: 29 }, (_, i) => {
          const midi = 36 + (i * 48) / 28;
          return <i key={i} className={r && midi >= r.lowMidi && midi <= r.highMidi ? 'on' : ''} />;
        })}
      </div>
      <div className="vo-keys__axis rp-label">
        <span>C2</span>
        <span>C4</span>
        <span>C6</span>
      </div>
      <button className="rp-btn" onClick={() => navigate('/range')}>
        {r ? t('Explore my range') : t('Measure my range')}
        <GuitarIcon name="arrow-right" size="sm" />
      </button>
    </section>
  );
}
