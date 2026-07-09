// Главный экран: hero с голосовым статусом, разделы списком, последние результаты.

import { useNavigate } from 'react-router-dom';
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
        <p className="lead">Пой в ноты — приложение слышит голос и показывает, куда попадать</p>
      </header>

      <SpotlightCard as="div" className="home-range" onClick={() => navigate('/range')} role="button" tabIndex={0}>
        <span className="nav-icon" aria-hidden="true">🎙️</span>
        <span className="nav-text">
          {r ? (
            <>
              <span className="range-notes">{midiToName(r.lowMidi)} – {midiToName(r.highMidi)}</span>
              <span className="dim small">{classifyRange(r.lowMidi, r.highMidi)} · нажми, чтобы перемерить</span>
            </>
          ) : (
            <>
              <b>Измерить диапазон голоса</b>
              <span className="dim small">займёт минуту — всё подстроится под тебя</span>
            </>
          )}
        </span>
        <span className="nav-chev" aria-hidden="true">›</span>
      </SpotlightCard>

      <nav className="home-nav">
        <SpotlightCard as="button" className="nav-card" onClick={() => navigate(r ? '/exercises' : '/range')}>
          <span className="nav-icon" aria-hidden="true">🎵</span>
          <span className="nav-text">
            <b>Распевки и упражнения</b>
            <span className="dim small">разогрев, гаммы, интервалы — под твой диапазон</span>
          </span>
          <span className="nav-chev" aria-hidden="true">›</span>
        </SpotlightCard>
        <SpotlightCard as="button" className="nav-card" onClick={() => navigate(r ? '/songs' : '/range')}>
          <span className="nav-icon" aria-hidden="true">🎧</span>
          <span className="nav-text">
            <b>Песни</b>
            <span className="dim small">загрузи трек — споёшь его по нотам</span>
          </span>
          <span className="nav-chev" aria-hidden="true">›</span>
        </SpotlightCard>
        <SpotlightCard as="button" className="nav-card" onClick={() => navigate('/settings')}>
          <span className="nav-icon" aria-hidden="true">⚙️</span>
          <span className="nav-text">
            <b>Настройки</b>
            <span className="dim small">микрофон, калибровка задержки, сложность</span>
          </span>
          <span className="nav-chev" aria-hidden="true">›</span>
        </SpotlightCard>
      </nav>

      {profile.scores.length > 0 && (
        <section className="recent">
          <h2 className="cat">Последние результаты</h2>
          <ul className="score-list">
            {profile.scores.slice(0, 8).map((s, i) => (
              <li key={i}>
                <span className="score-stars">{'★'.repeat(s.stars) || '·'}</span>
                <span className="score-title">{s.title}</span>
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
