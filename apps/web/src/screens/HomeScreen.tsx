import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EXERCISES } from '../game/exercises';
import { listSongs } from '../lib/api';
import { currentLang, t } from '../lib/i18n';
import { classifyRange, midiToName } from '../lib/music';
import { practiceStreak } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { Icon, type IconName } from '../components/Icon';
import { StudioPiano } from '../components/StudioPiano';
import { PracticeArtwork, StudioArtwork } from '../components/StudioArtwork';

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
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    return { day, practiced: scores.some((s) => s.playedAt >= day.getTime() && s.playedAt < next.getTime()) };
  });

  return (
    <div className="screen home">
      <header className="home-heading">
        <div>
          <span className="overline">{t('Your personal voice studio')}</span>
          <h1>{t('Find your flow.')}</h1>
        </div>
        <span className="date-label">
          {today.toLocaleDateString(currentLang() === 'ru' ? 'ru-RU' : 'en-GB', {
            day: 'numeric',
            month: 'long',
            weekday: 'short',
          })}
        </span>
      </header>
      <div className="home-hero-grid">
        <section className="studio-hero">
          <div className="hero-copy">
            <span className="hero-tag">
              <span /> {t('Made for your voice')}
            </span>
            <h2>
              {t('Your voice.')}
              <br />
              <span>{t('More possibility.')}</span>
            </h2>
            <p>{t('Find your notes, feel the melody, and make a little progress every day.')}</p>
            <button className="btn ink" onClick={() => navigate(r ? '/exercises?cat=Warm-ups' : '/range')}>
              <Icon name={r ? 'play' : 'mic'} size={18} />
              {r ? t('Start a warm-up') : t('Discover my voice')}
              <Icon name="arrow" size={18} />
            </button>
            <span className="hero-footnote">
              {r ? t('Your range. Your pace. Your next step.') : t('One minute to find your starting point.')}
            </span>
          </div>
          <StudioArtwork />
          <span className="hero-edition" aria-hidden="true">
            PUPITRE / SOUND IN PROGRESS
          </span>
        </section>
        <VoiceCard />
      </div>
      <div className="section-heading">
        <h2>{t('What shall we sing?')}</h2>
        <span>{t('Small steps. A stronger voice.')}</span>
      </div>
      <div className="practice-grid">
        <PracticeCard
          number="01"
          icon="waves"
          tone="champagne"
          title={t('Warm-ups')}
          desc={t('Ease into your voice. Long tones, gentle sirens, and a fresh start.')}
          foot={t('{n} exercises', { n: warmups })}
          variant={0}
          onClick={() => navigate(r ? '/exercises?cat=Warm-ups' : '/range')}
        />
        <PracticeCard
          number="02"
          icon="sparkle"
          tone="lilac"
          title={t('Build your skills')}
          desc={t('Find the center of every note. Scales, intervals, and vocal technique.')}
          foot={t('{n} exercises', { n: EXERCISES.length - warmups })}
          variant={3}
          onClick={() => navigate(r ? '/exercises' : '/range')}
        />
        <PracticeCard
          number="03"
          icon="note"
          tone="peach"
          title={t('Sing what you love')}
          desc={t('Turn your favorite songs into a practice session. Bring your own soundtrack.')}
          foot={songCount === null ? t('Open the library') : t('{n} songs ready', { n: songCount })}
          variant={5}
          onClick={() => navigate('/songs')}
        />
      </div>
      <StudioPiano />
      <div className="home-bottom-grid">
        <section className="activity-panel">
          <div className="section-heading">
            <h2>{t('Your rhythm')}</h2>
            <span className="streak">
              <Icon name="flame" size={16} />
              {t('{n} d.', { n: streak })}
            </span>
          </div>
          <div className="activity-week">
            {week.map(({ day, practiced }, i) => (
              <div
                key={i}
                className={`activity-day${practiced ? ' practiced' : ''}${i === 6 ? ' today' : ''}`}
              >
                <span>
                  {day.toLocaleDateString(currentLang() === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'short' })}
                </span>
                <span className="day-mark" aria-label={practiced ? t('Practiced') : t('No practice yet')}>
                  {practiced ? <Icon name="check" size={18} /> : <i />}
                </span>
              </div>
            ))}
          </div>
          <div className="activity-stats">
            <div>
              <strong>{scores.length}</strong>
              <span>{t('sessions completed')}</span>
            </div>
            <div>
              <strong>{avgAccuracy === null ? '—' : `${avgAccuracy}%`}</strong>
              <span>{t('average accuracy')}</span>
            </div>
          </div>
        </section>
        <section className="recent-panel">
          <div className="section-heading">
            <h2>{t('Recent results')}</h2>
            <Icon name="clock" size={17} />
          </div>
          {scores.length > 0 ? (
            <ul className="score-list">
              {scores.slice(0, 3).map((s, i) => (
                <li key={`${s.playedAt}-${i}`}>
                  <span className="result-icon">
                    <Icon name="waves" size={18} />
                  </span>
                  <span className="score-title">
                    <b>{t(s.title)}</b>
                    <small>
                      {'★'.repeat(s.stars)}
                      {'☆'.repeat(3 - s.stars)}
                    </small>
                  </span>
                  <span className="score-accuracy">
                    {Math.round(s.accuracy * 100)}
                    <small>%</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-recent">
              <Icon name="headphones" size={30} strokeWidth={1.5} />
              <p>
                {t('Your first session starts a story.')}
                <span>{t('Sing a little. Your progress will appear here.')}</span>
              </p>
            </div>
          )}
          <button className="studio-settings-link" onClick={() => navigate('/settings')}>
            <Icon name="sliders" size={16} />
            {t('Set up your studio')}
            <span>
              {profile.latencyMs} {t('ms')}
            </span>
            <Icon name="arrow" size={16} />
          </button>
        </section>
      </div>
    </div>
  );
}

function PracticeCard({
  number,
  icon,
  tone,
  title,
  desc,
  foot,
  variant,
  onClick,
}: {
  number: string;
  icon: IconName;
  tone: string;
  title: string;
  desc: string;
  foot: string;
  variant: number;
  onClick: () => void;
}) {
  return (
    <button className={`practice-card ${tone}`} onClick={onClick}>
      <span className="practice-card-top">
        <span className="tile-icon">
          <Icon name={icon} size={22} />
        </span>
        <span className="card-index">/{number}</span>
      </span>
      <PracticeArtwork variant={variant} />
      <span className="practice-card-title">{title}</span>
      <span className="practice-card-desc">{desc}</span>
      <span className="practice-card-foot">
        {foot}
        <span className="circle-arrow">
          <Icon name="arrow" size={18} />
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
    <section className="voice-card">
      <div className="voice-card-head">
        <span className="overline">{t('Your instrument')}</span>
        <Icon name="mic" size={18} />
      </div>
      <div className="voice-card-identity">
        <span className="voice-avatar">
          <Icon name="waves" size={36} strokeWidth={1.5} />
        </span>
        <span className="voice-type">
          {r ? t(classifyRange(r.lowMidi, r.highMidi)) : t('One of a kind.')}
        </span>
        <span className="voice-caption">
          {r ? t('This is your vocal range') : t('Let’s get to know your voice')}
        </span>
      </div>
      <div className="voice-notes">
        {r ? (
          <>
            {midiToName(r.lowMidi)} <span>—</span> {midiToName(r.highMidi)}
          </>
        ) : (
          <span className="unmeasured-range">
            ? <span>—</span> ?
          </span>
        )}
      </div>
      <div className="voice-keyboard" aria-hidden="true">
        {Array.from({ length: 29 }, (_, i) => {
          const midi = 36 + (i * 48) / 28;
          return <i key={i} className={r && midi >= r.lowMidi && midi <= r.highMidi ? 'in-range' : ''} />;
        })}
      </div>
      <div className="range-axis-labels">
        <span>C2</span>
        <span>C4</span>
        <span>C6</span>
      </div>
      <button className="btn voice-action" onClick={() => navigate('/range')}>
        {r ? t('Explore my range') : t('Measure my range')}
        <Icon name="arrow" size={17} />
      </button>
    </section>
  );
}
