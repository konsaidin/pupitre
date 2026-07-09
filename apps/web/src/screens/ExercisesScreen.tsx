// Список распевок и упражнений с настройкой темпа/тональности/повторов.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EXERCISES, type ExerciseDef } from '../game/exercises';
import { t } from '../lib/i18n';
import { comfortZone, midiToName } from '../lib/music';
import { bestScore } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { ScreenHeader } from '../components/ScreenHeader';
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
        <ScreenHeader
          title={t('Warm-ups & exercises')}
          subtitle={t('First, let’s measure your range — exercises are generated from it.')}
        />
        <button className="btn primary" onClick={() => navigate('/range')}>{t('Measure my range')}</button>
      </div>
    );
  }

  const categories = [...new Set(EXERCISES.map((e) => e.category))];

  return (
    <div className="screen">
      <ScreenHeader
        title={t('Warm-ups & exercises')}
        subtitle={t('All exercises are built for your range ({low}–{high}).', { low: midiToName(profile.range.lowMidi), high: midiToName(profile.range.highMidi) })}
      />
      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="cat">{t(cat)}</h2>
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
          <b>{t(ex.title)}</b>
          <span className="dim small">{t(ex.description)}</span>
        </span>
        {best && <span className="card-best">{'★'.repeat(best.stars)}<span className="dim"> {best.score}</span></span>}
      </button>
      {open && (
        <div className="card-body">
          <RangeSlider min={50} max={160} step={5} value={bpm} onChange={setBpm} label={<>{t('Tempo')}: <b>{bpm} BPM</b></>} />
          <RangeSlider min={1} max={ex.maxRepeats} value={repeats} onChange={setRepeats} label={<>{t('Repeats')}: <b>{repeats}</b></>} />
          <RangeSlider
            min={zone.lowMidi}
            max={Math.max(zone.lowMidi, zone.highMidi - 7)}
            value={rootMidi}
            onChange={setRootMidi}
            label={<>{t('Key (root note)')}: <b>{midiToName(rootMidi)}</b></>}
          />
          <button className="btn primary" onClick={startPlay}>{t('Sing')}</button>
        </div>
      )}
    </SpotlightCard>
  );
}
