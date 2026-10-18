import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EXERCISES, type ExerciseDef } from '../game/exercises';
import { t } from '../lib/i18n';
import { comfortZone, midiToName } from '../lib/music';
import { bestScore } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { RangeSlider } from '../components/RangeSlider';
import { Icon, type IconName } from '../components/Icon';
import { MelodyAudition } from '../components/MelodyAudition';
import { StudioArtwork } from '../components/StudioArtwork';
import type { PlayState } from './GameScreen';

const CATEGORY_ICON: Record<ExerciseDef['category'], IconName> = {
  'Warm-ups': 'waves',
  Scales: 'note',
  'Ear training': 'ear',
  Techniques: 'sparkle',
};
const CATEGORY_DESC: Record<string, string> = {
  'Warm-ups': 'Give your voice a gentle beginning.',
  Scales: 'Make every step sound intentional.',
  'Ear training': 'Hear it. Find it. Sing it.',
  Techniques: 'Explore the character of your voice.',
};

export function ExercisesScreen() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const categories = [...new Set(EXERCISES.map((e) => e.category))];
  const catFilter = params.get('cat');
  const activeCategory = categories.find((cat) => cat === catFilter);
  const shown = activeCategory ? [activeCategory] : categories;

  return (
    <div className="screen exercises-screen">
      <ScreenHeader
        title={t('Practice')}
        eyebrow={t('A little better, every day')}
        subtitle={
          profile.range
            ? t('All exercises are built for your range ({low}–{high}).', {
                low: midiToName(profile.range.lowMidi),
                high: midiToName(profile.range.highMidi),
              })
            : t('Your voice sets the key. Let’s find it first.')
        }
        action={<span className="count-badge">{t('{n} exercises', { n: EXERCISES.length })}</span>}
      />
      {!profile.range ? (
        <section className="range-invitation">
          <div>
            <span className="overline">{t('Before the first note')}</span>
            <h2>{t('An instrument like no other.')}</h2>
            <p>{t('First, let’s measure your range — exercises are generated from it.')}</p>
            <button className="btn primary" onClick={() => navigate('/range')}>
              <Icon name="mic" size={18} />
              {t('Measure my range')}
              <Icon name="arrow" size={18} />
            </button>
          </div>
          <StudioArtwork />
        </section>
      ) : (
        <>
          <div className="exercise-toolbar">
            <div className="chip-row" aria-label={t('Exercise categories')}>
              <button
                className={!activeCategory ? 'chip-btn active' : 'chip-btn'}
                aria-pressed={!activeCategory}
                onClick={() => setParams({}, { replace: true })}
              >
                {t('All')}
                <span>{EXERCISES.length}</span>
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={activeCategory === cat ? 'chip-btn active' : 'chip-btn'}
                  aria-pressed={activeCategory === cat}
                  onClick={() => setParams({ cat }, { replace: true })}
                >
                  <Icon name={CATEGORY_ICON[cat]} size={16} />
                  {t(cat)}
                </button>
              ))}
            </div>
          </div>
          {shown.map((cat) => (
            <section className="exercise-section" key={cat}>
              <div className="section-heading">
                <div>
                  <h2>{t(cat)}</h2>
                  <p>{t(CATEGORY_DESC[cat])}</p>
                </div>
                <span className="section-count">
                  {String(EXERCISES.filter((e) => e.category === cat).length).padStart(2, '0')}
                </span>
              </div>
              <div className="exercise-grid">
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
        </>
      )}
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
  const map = useMemo(() => ex.build(range, { bpm, repeats, rootMidi }), [ex, range, bpm, repeats, rootMidi]);
  const seconds = Math.round(map.durationMs / 1000);
  const startPlay = () => {
    const state: PlayState = { map: { ...map, id: ex.id }, kind: 'exercise' };
    navigate('/play', { state });
  };

  return (
    <article className={`exercise-card${open ? ' open' : ''}`} data-category={ex.category}>
      <div className="exercise-preview">
        <span className="exercise-category">
          <Icon name={CATEGORY_ICON[ex.category]} size={17} />
          {t(ex.category)}
        </span>
        {best && (
          <span className="exercise-best" title={t('Best result')}>
            {'★'.repeat(best.stars)} <b>{best.score}</b>
          </span>
        )}
        <MelodyAudition notes={map.notes} title={t(ex.title)} />
      </div>
      <div className="exercise-card-content">
        <h3>{t(ex.title)}</h3>
        <p>{t(ex.description)}</p>
        <div className="exercise-meta">
          <span>
            <Icon name="clock" size={14} />
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </span>
          <span>{bpm} BPM</span>
          <span>{midiToName(rootMidi)}</span>
        </div>
        <div className="exercise-card-actions">
          <button
            className="btn ghost"
            aria-expanded={open}
            aria-controls={`options-${ex.id}`}
            onClick={onToggle}
          >
            <Icon name="sliders" size={16} />
            {t('Customize')}
          </button>
          <button className="btn primary" disabled={!map.notes.length} onClick={startPlay}>
            <Icon name="play" size={16} />
            {t('Sing')}
          </button>
        </div>
      </div>
      {open && (
        <div className="exercise-options" id={`options-${ex.id}`}>
          <RangeSlider
            min={50}
            max={160}
            step={5}
            value={bpm}
            onChange={setBpm}
            label={
              <>
                {t('Tempo')} <b>{bpm} BPM</b>
              </>
            }
          />
          <RangeSlider
            min={1}
            max={ex.maxRepeats}
            value={repeats}
            onChange={setRepeats}
            label={
              <>
                {t('Repeats')} <b>{repeats}</b>
              </>
            }
          />
          <RangeSlider
            min={zone.lowMidi}
            max={Math.max(zone.lowMidi, zone.highMidi - 7)}
            value={rootMidi}
            onChange={setRootMidi}
            label={
              <>
                {t('Key (root note)')} <b>{midiToName(rootMidi)}</b>
              </>
            }
          />
          {!map.notes.length && (
            <p className="hint">{t('Lower the key to fit this pattern into your range.')}</p>
          )}
        </div>
      )}
    </article>
  );
}
