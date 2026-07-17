// Список распевок и упражнений с настройкой темпа/тональности/повторов.

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EXERCISES, type ExerciseDef } from '../game/exercises';
import { t } from '../lib/i18n';
import { comfortZone, midiToName } from '../lib/music';
import { bestScore } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { RangeSlider } from '../components/RangeSlider';
import { Icon, type IconName } from '../components/Icon';
import type { PlayState } from './GameScreen';

/* сдержанный моно-глиф вместо цветных эмодзи из данных упражнений */
const CATEGORY_ICON: Record<ExerciseDef['category'], IconName> = {
  'Warm-ups': 'waves',
  'Scales': 'note',
  'Ear training': 'ear',
  'Techniques': 'sparkle',
};

export function ExercisesScreen() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
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
  // фильтр категории приходит с главной (?cat=Warm-ups) и переключается чипами
  const catFilter = params.get('cat');
  const shown = catFilter && (categories as string[]).includes(catFilter) ? [catFilter] : categories;

  return (
    <div className="screen">
      <ScreenHeader
        title={t('Warm-ups & exercises')}
        subtitle={t('All exercises are built for your range ({low}–{high}).', { low: midiToName(profile.range.lowMidi), high: midiToName(profile.range.highMidi) })}
      />
      <div className="chip-row">
        <button
          className={!catFilter ? 'chip-btn active' : 'chip-btn'}
          onClick={() => setParams({}, { replace: true })}
        >
          {t('All')}
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={catFilter === cat ? 'chip-btn active' : 'chip-btn'}
            onClick={() => setParams({ cat }, { replace: true })}
          >
            {t(cat)}
          </button>
        ))}
      </div>
      {shown.map((cat) => (
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
    <div className={open ? 'card open' : 'card'}>
      {/* шапка — как карточка песни в библиотеке: глиф, текст, «Спеть» справа;
          клик по остальной площади раскрывает настройки темпа/тональности */}
      <div className="card-head" onClick={onToggle} role="button" tabIndex={0}>
        <span className="card-glyph"><Icon name={CATEGORY_ICON[ex.category]} size={19} /></span>
        <span className="card-title">
          <b>{t(ex.title)}</b>
          <span className="dim small">{t(ex.description)}</span>
        </span>
        {best && <span className="card-best">{'★'.repeat(best.stars)}<span className="dim"> {best.score}</span></span>}
        <button
          className="btn primary"
          onClick={(e) => {
            e.stopPropagation();
            startPlay();
          }}
        >
          {t('Sing')}
        </button>
      </div>
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
        </div>
      )}
    </div>
  );
}
