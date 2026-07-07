// Главный экран: статус голоса, разделы, последние результаты.

import { useNavigate } from 'react-router-dom';
import { classifyRange, midiToName } from '../lib/music';
import { useProfile } from '../state/ProfileContext';

export function HomeScreen() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const r = profile.range;

  return (
    <div className="screen home">
      <h1 className="logo">🎤 Slopsician</h1>
      <p className="lead">Пой в ноты. Приложение слышит твой голос и показывает, куда попадать.</p>

      <div className="home-range" onClick={() => navigate('/range')} role="button" tabIndex={0}>
        {r ? (
          <>
            <span className="range-notes">{midiToName(r.lowMidi)} – {midiToName(r.highMidi)}</span>
            <span className="dim">{classifyRange(r.lowMidi, r.highMidi)} · нажми, чтобы перемерить</span>
          </>
        ) : (
          <>
            <span className="range-notes">Диапазон не измерен</span>
            <span className="dim">нажми — займёт минуту, всё подстроится под твой голос</span>
          </>
        )}
      </div>

      <div className="home-nav">
        <button className="nav-card" onClick={() => navigate(r ? '/exercises' : '/range')}>
          <span className="nav-icon">🎵</span>
          <b>Распевки и упражнения</b>
          <span className="dim small">разогрев, гаммы, интервалы — под твой диапазон</span>
        </button>
        <button className="nav-card" onClick={() => navigate(r ? '/songs' : '/range')}>
          <span className="nav-icon">🎧</span>
          <b>Песни</b>
          <span className="dim small">загрузи трек — споёшь его по нотам</span>
        </button>
        <button className="nav-card" onClick={() => navigate('/settings')}>
          <span className="nav-icon">⚙️</span>
          <b>Настройки</b>
          <span className="dim small">микрофон, калибровка задержки, сложность</span>
        </button>
      </div>

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
