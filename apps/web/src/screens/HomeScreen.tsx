// Главный экран: hero с голосовым статусом, разделы списком, последние результаты.

import { useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';
import { classifyRange, midiToName } from '../lib/music';
import { useProfile } from '../state/ProfileContext';
import { SpotlightCard } from '../components/fx/SpotlightCard';
import { ShinyText } from '../components/fx/ShinyText';

export function HomeScreen() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const r = profile.range;

  return (
    <div className="screen home">
      <header className="home-hero">
        <h1 className="logo">🎤 <ShinyText>Slopsician</ShinyText></h1>
        <p className="lead">{t('Sing the notes — the app hears your voice and shows where to hit')}</p>
      </header>

      <SpotlightCard as="div" className="home-range" onClick={() => navigate('/range')} role="button" tabIndex={0}>
        <span className="nav-icon" aria-hidden="true">🎙️</span>
        <span className="nav-text">
          {r ? (
            <>
              <span className="range-notes">{midiToName(r.lowMidi)} – {midiToName(r.highMidi)}</span>
              <span className="dim small">{t('{cls} · tap to remeasure', { cls: t(classifyRange(r.lowMidi, r.highMidi)) })}</span>
            </>
          ) : (
            <>
              <b>{t('Measure your vocal range')}</b>
              <span className="dim small">{t('takes a minute — everything adapts to you')}</span>
            </>
          )}
        </span>
        <span className="nav-chev" aria-hidden="true">›</span>
      </SpotlightCard>

      <nav className="home-nav">
        <SpotlightCard as="button" className="nav-card" onClick={() => navigate(r ? '/exercises' : '/range')}>
          <span className="nav-icon" aria-hidden="true">🎵</span>
          <span className="nav-text">
            <b>{t('Warm-ups & exercises')}</b>
            <span className="dim small">{t('warm-up, scales, intervals — built for your range')}</span>
          </span>
          <span className="nav-chev" aria-hidden="true">›</span>
        </SpotlightCard>
        <SpotlightCard as="button" className="nav-card" onClick={() => navigate(r ? '/songs' : '/range')}>
          <span className="nav-icon" aria-hidden="true">🎧</span>
          <span className="nav-text">
            <b>{t('Songs')}</b>
            <span className="dim small">{t('upload a track and sing it note by note')}</span>
          </span>
          <span className="nav-chev" aria-hidden="true">›</span>
        </SpotlightCard>
        <SpotlightCard as="button" className="nav-card" onClick={() => navigate('/settings')}>
          <span className="nav-icon" aria-hidden="true">⚙️</span>
          <span className="nav-text">
            <b>{t('Settings')}</b>
            <span className="dim small">{t('microphone, latency calibration, difficulty')}</span>
          </span>
          <span className="nav-chev" aria-hidden="true">›</span>
        </SpotlightCard>
      </nav>

      {profile.scores.length > 0 && (
        <section className="recent">
          <h2 className="cat">{t('Recent results')}</h2>
          <ul className="score-list">
            {profile.scores.slice(0, 8).map((s, i) => (
              <li key={i}>
                <span className="score-stars">{'★'.repeat(s.stars) || '·'}</span>
                <span className="score-title">{t(s.title)}</span>
                <span className="dim">{Math.round(s.accuracy * 100)}%</span>
                <b>{s.score}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
