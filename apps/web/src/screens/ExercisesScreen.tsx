// Список распевок и упражнений с настройкой темпа/тональности/повторов.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EXERCISES, type ExerciseDef } from '../game/exercises';
import { comfortZone, midiToName } from '../lib/music';
import { bestScore } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { SpotlightCard } from '../components/fx/SpotlightCard';
import { RangeSlider } from '../components/fx/RangeSlider';
import type { PlayState } from './GameScreen';

export function ExercisesScreen() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(null);

  if (!profile.range) {
    return (
      <div className="screen">
        <h1>Распевки и упражнения</h1>
        <p className="lead">Сначала измерим твой диапазон — упражнения генерируются под него.</p>
        <button className="btn primary" onClick={() => navigate('/range')}>Определить диапазон</button>
      </div>
    );
  }

  const categories = [...new Set(EXERCISES.map((e) => e.category))];

  return (
    <div className="screen">
      <h1>Распевки и упражнения</h1>
      <p className="lead dim">
        Все упражнения построены под твой диапазон ({midiToName(profile.range.lowMidi)}–{midiToName(profile.range.highMidi)}).
      </p>
      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="cat">{cat}</h2>
          <div className="card-list">
            {EXERCISES.filter((e) => e.category === cat).map((ex) => (
              <ExerciseCard
                key={ex.id}
                ex={ex}
                open={openId === ex.id}
                onToggle={() => setOpenId(openId === ex.id ? null : ex.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ExerciseCard({ ex, open, onToggle }: { ex: ExerciseDef; open: boolean; onToggle: () => void }) {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const range = profile.range!;
  const zone = comfortZone(range);
  const [bpm, setBpm] = useState(ex.defaultBpm);
  const [repeats, setRepeats] = useState(ex.defaultRepeats);
  const [rootMidi, setRootMidi] = useState(zone.lowMidi);
  const best = bestScore(profile, ex.id);

  const startPlay = () => {
    const map = ex.build(range, { bpm, repeats, rootMidi });
    // id упражнения без параметров — чтобы лучший результат копился по упражнению
    map.id = ex.id;
    const state: PlayState = { map, kind: 'exercise' };
    navigate('/play', { state });
  };

  return (
    <SpotlightCard as="div" className={open ? 'card open' : 'card'} tilt={false} magnetism={false}>
      <button className="card-head" onClick={onToggle}>
        <span className="card-icon">{ex.icon}</span>
        <span className="card-title">
          <b>{ex.title}</b>
          <span className="dim small">{ex.description}</span>
        </span>
        {best && <span className="card-best">{'★'.repeat(best.stars)}<span className="dim"> {best.score}</span></span>}
      </button>
      {open && (
        <div className="card-body">
          <RangeSlider min={50} max={160} step={5} value={bpm} onChange={setBpm} label={<>Темп: <b>{bpm} BPM</b></>} />
          <RangeSlider min={1} max={ex.maxRepeats} value={repeats} onChange={setRepeats} label={<>Повторы: <b>{repeats}</b></>} />
          <RangeSlider
            min={zone.lowMidi}
            max={Math.max(zone.lowMidi, zone.highMidi - 7)}
            value={rootMidi}
            onChange={setRootMidi}
            label={<>От ноты: <b>{midiToName(rootMidi)}</b></>}
          />
          <button className="btn primary" onClick={startPlay}>Петь</button>
        </div>
      )}
    </SpotlightCard>
  );
}
