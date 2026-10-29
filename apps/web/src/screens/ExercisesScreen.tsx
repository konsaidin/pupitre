import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EXERCISES, type ExerciseDef } from '../game/exercises';
import { t } from '../lib/i18n';
import { comfortZone, midiToName } from '../lib/music';
import { bestScore } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { RangeSlider } from '../components/RangeSlider';
import { MelodyAudition } from '../components/MelodyAudition';
import { RampaPoster } from '../components/RampaPoster';
import { GuitarIcon, type GuitarIconName } from '../guitar/ui/GuitarIcon';
import type { PlayState } from './GameScreen';
import './vocal.css';

const CATEGORY_ICON: Record<ExerciseDef['category'], GuitarIconName> = {
  'Warm-ups': 'wave-sine',
  Scales: 'stack-2',
  'Ear training': 'ear',
  Techniques: 'sparkles',
};
const name = (midi: number) => midiToName(midi).replace('#', '♯');
const CATEGORY_DESC: Record<string, string> = {
  'Warm-ups': 'Long tones and sirens before singing.',
  Scales: 'Scales up and down.',
  'Ear training': 'Hear a note and sing it back.',
  Techniques: 'Vibrato.',
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
    <div className="screen exercises-screen rp-page vo-page" data-ui="vocal-practice">
      <ScreenHeader
        title={t('Practice')}
        eyebrow={t('A little better, every day')}
        subtitle={
          profile.range
            ? t('All exercises are built for your range ({low}–{high}).', {
                low: name(profile.range.lowMidi),
                high: name(profile.range.highMidi),
              })
            : t('Exercises are moved into your range — measure it first.')
        }
        action={<span className="rp-chip rp-chip--plain">{t('{n} exercises', { n: EXERCISES.length })}</span>}
      />
      {!profile.range ? (
        <section className="rp-card vo-invite">
          <RampaPoster seed="range-first" glyph="?" className="vo-invite__poster" />
          <div className="vo-invite__body">
            <span className="rp-label">{t('Before the first note')}</span>
            <h2 className="rp-h2">{t('An instrument like no other.')}</h2>
            <p className="rp-muted">{t('First, let’s measure your range — exercises are generated from it.')}</p>
            <button className="rp-btn rp-btn--light rp-btn--lg" onClick={() => navigate('/range')}>
              <GuitarIcon name="microphone" />
              {t('Measure my range')}
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="rp-seg vo-filter" role="group" aria-label={t('Exercise categories')}>
            <button
              className="rp-seg__item"
              aria-pressed={!activeCategory}
              onClick={() => setParams({}, { replace: true })}
            >
              {t('All')} <span className="rp-num rp-faint">{EXERCISES.length}</span>
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                className="rp-seg__item"
                aria-pressed={activeCategory === cat}
                onClick={() => setParams({ cat }, { replace: true })}
              >
                <GuitarIcon name={CATEGORY_ICON[cat]} size="sm" />
                {t(cat)}
              </button>
            ))}
          </div>
          {shown.map((cat) => (
            <section className="vo-group" key={cat}>
              <div className="vo-section">
                <div>
                  <h2 className="rp-h3">{t(cat)}</h2>
                  <p className="rp-sm rp-faint">{t(CATEGORY_DESC[cat])}</p>
                </div>
                <span className="rp-num rp-faint">
                  {String(EXERCISES.filter((e) => e.category === cat).length).padStart(2, '0')}
                </span>
              </div>
              <div className="vo-exercises">
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
    <article className={`rp-card vo-exercise${open ? ' vo-exercise--open' : ''}`} data-category={ex.category}>
      {/* card-head + .btn.primary — зацепка защищённого e2e ribbon.cjs: первая «Спеть» на экране */}
      <div className="card-head vo-exercise__head">
        <span className="rp-chip">
          <GuitarIcon name={CATEGORY_ICON[ex.category]} size="sm" />
          {t(ex.category)}
        </span>
        {best && (
          <span className="rp-chip vo-exercise__best" title={t('Best result')}>
            <GuitarIcon name="star-filled" size="sm" />
            {best.stars} · <b className="rp-num">{best.score}</b>
          </span>
        )}
        <button className="rp-btn rp-btn--light rp-btn--sm btn primary vo-exercise__sing" disabled={!map.notes.length} onClick={startPlay}>
          <GuitarIcon name="player-play-filled" size="sm" />
          {t('Sing')}
        </button>
      </div>
      <MelodyAudition notes={map.notes} title={t(ex.title)} />
      <div className="vo-exercise__body">
        <h3 className="rp-h3">{t(ex.title)}</h3>
        <p className="rp-sm rp-muted">{t(ex.description)}</p>
        <div className="vo-exercise__meta">
          <span className="rp-tag">
            <GuitarIcon name="clock" size="sm" />
            <span className="rp-num">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </span>
          </span>
          <span className="rp-tag rp-num">{bpm} BPM</span>
          <span className="rp-tag rp-num">{name(rootMidi)}</span>
          <button
            className="rp-btn rp-btn--ghost rp-btn--sm vo-exercise__more"
            aria-expanded={open}
            aria-controls={`options-${ex.id}`}
            onClick={onToggle}
          >
            <GuitarIcon name="adjustments-horizontal" size="sm" />
            {t('Customize')}
          </button>
        </div>
      </div>
      {open && (
        <div className="vo-exercise__options" id={`options-${ex.id}`}>
          <RangeSlider
            min={50}
            max={160}
            step={5}
            value={bpm}
            onChange={setBpm}
            label={
              <>
                <span>{t('Tempo')}</span> <b className="rp-num">{bpm} BPM</b>
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
                <span>{t('Repeats')}</span> <b className="rp-num">{repeats}</b>
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
                <span>{t('Key (root note)')}</span> <b className="rp-num">{name(rootMidi)}</b>
              </>
            }
          />
          {!map.notes.length && (
            <p className="rp-field__hint">{t('Lower the key to fit this pattern into your range.')}</p>
          )}
        </div>
      )}
    </article>
  );
}
