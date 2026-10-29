// Подготовка песни (ui-spec §11.3; этап 13a, срез 1 — подмножество): постер, партии радио-карточками (роль, строй,
// капо, сложность по плотности событий), вид [3D | Табулатура], порядок струн, левша, своя партия в аккомпанементе
// (не слышно · тихо · громко), CTA «Играть Space».
// Аккомпанемент — синтез (запись — этап 23), строгость и скорость — позже.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../../../lib/i18n';
import type { GuitarArrangement, GuitarSong } from '../../model/types';
import { importErrorText } from '../../import/workerClient';
import { guitarLibrary } from '../../store/library';
import { updateGuitarSettings, useGuitarSettings } from '../../store/settings';
import { GuitarIcon } from '../../ui/GuitarIcon';
import { PartLevelSeg } from '../../ui/PartLevel';
import { durationOf, Poster, ROLE } from '../Library/LibraryScreen';
import { clock, playHref } from '../Play/PlayScreen';
import './song.css';

/** Сложность партии 1–5 до этапа 36 — по плотности событий: < 1, < 2, < 3, < 4, ≥ 4 в секунду. */
export function densityLevel(a: GuitarArrangement): number {
  const sec = durationOf(a) / 1000;
  const rate = sec > 0 ? a.events.length / sec : 0;
  return rate < 1 ? 1 : rate < 2 ? 2 : rate < 3 ? 3 : rate < 4 ? 4 : 5;
}

export function SongScreen() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [settings] = useGuitarSettings();
  const songId = decodeURIComponent(/^\/guitar\/song\/([^/]+)/.exec(pathname)?.[1] ?? '');
  const [data, setData] = useState<{ song: GuitarSong; arrangements: GuitarArrangement[] } | null | 'missing' | { error: string }>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await guitarLibrary();
      const song = await lib.getSong(songId);
      if (!song) return cancelled || setData('missing');
      // Разобрано старой версией конвертера — пере-разбор из оригинала с переносом правок (этап 9a).
      await lib.refreshIfStale(songId);
      const arrangements = await lib.getArrangements(songId);
      if (!cancelled) {
        setData({ song, arrangements });
        setChosen((c) => c ?? arrangements.find((a) => a.instrument === settings.instrument.default)?.id ?? arrangements[0]?.id ?? null);
      }
    })().catch((e: Error) => {
      if (!cancelled) setData({ error: importErrorText(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [songId, settings.instrument.default]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && chosen && data && data !== 'missing' && !('error' in data)) {
        e.preventDefault();
        location.hash = playHref(data.song.id, chosen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen, data]);

  if (data && typeof data === 'object' && 'error' in data)
    return (
      <div className="rp-page">
        <div className="rp-empty">
          <h1 className="rp-h1">{t('Could not open the song')}</h1>
          <p>{data.error}</p>
          <button type="button" className="rp-btn" onClick={() => navigate('/guitar')}>
            {t('Back to the library')}
          </button>
        </div>
      </div>
    );
  if (data === 'missing')
    return (
      <div className="rp-page">
        <div className="rp-empty">
          <h1 className="rp-h1">{t('Song not found')}</h1>
          <button type="button" className="rp-btn" onClick={() => navigate('/guitar')}>
            {t('Back to the library')}
          </button>
        </div>
      </div>
    );
  if (!data) return <div className="rp-page" />;

  const { song, arrangements } = data;
  const view = settings.view;
  const setView = (patch: Partial<typeof view>) => updateGuitarSettings((s) => ({ ...s, view: { ...s.view, ...patch } }));
  const arr = arrangements.find((a) => a.id === chosen) ?? arrangements[0];

  return (
    <div className="rp-page song-page" data-ui="song">
      <a className="back-link" href="#/guitar">
        <GuitarIcon name="chevron-left" size="sm" />
        {t('Library')}
      </a>
      <div className="song-page__head">
        <Poster title={song.title} className="song-page__poster" />
        <div>
          <span className="rp-label">{song.artist || '—'}</span>
          <h1 className="rp-display song-page__title">{song.title}</h1>
          {arr && (
            <p className="rp-muted">
              {clock(durationOf(arr))} · {arr.timeline.bars.length} {t('bars')} · {arr.sections.length ? arr.sections.map((s) => s.name).filter((n, i, all) => all.indexOf(n) === i).join(' · ') : t('no sections')}
            </p>
          )}
        </div>
      </div>

      <section className="song-page__group">
        <span className="rp-label">{t('Part')}</span>
        <div className="song-page__arrs" role="radiogroup" aria-label={t('Part')}>
          {arrangements.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={a.id === arr?.id} className="arr-card" data-ui="song-part"
              onClick={() => setChosen(a.id)}>
              <span className="arr-card__top">
                <b>{a.name}</b>
                <span className="rp-tag">{t(ROLE[a.role].label)}</span>
              </span>
              <small>
                {a.tuning.name}
                {a.capo ? ` · ${t('capo')} ${a.capo}` : ''} · {a.strings} {t('strings')} · {a.events.length} {t('notes')}
              </small>
              <span className="song-page__level" aria-label={t('Difficulty')}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <i key={i} data-on={i <= densityLevel(a) || undefined} />
                ))}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="song-page__group song-page__opts">
        <div>
          <span className="rp-label">{t('View')}</span>
          <div className="rp-seg" role="radiogroup" aria-label={t('View')}>
            {(['3d', 'tab'] as const).map((m) => (
              <button key={m} type="button" className="rp-seg__item" role="radio" aria-checked={view.mode === m} onClick={() => setView({ mode: m })}>
                {m === '3d' ? t('3D highway') : t('Tablature')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="rp-label">{t('String order')}</span>
          <div className="rp-seg" role="radiogroup" aria-label={t('String order')}>
            {(['low-top', 'high-top'] as const).map((o) => (
              <button key={o} type="button" className="rp-seg__item" role="radio" aria-checked={view.stringOrder === o} onClick={() => setView({ stringOrder: o })}>
                {o === 'low-top' ? t('Low string on top') : t('As in tablature')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="rp-label">{t('Hand')}</span>
          <div className="rp-seg" role="radiogroup" aria-label={t('Hand')}>
            {[false, true].map((left) => (
              <button key={String(left)} type="button" className="rp-seg__item" role="radio" aria-checked={settings.instrument.leftHanded === left}
                onClick={() => updateGuitarSettings((s) => ({ ...s, instrument: { ...s.instrument, leftHanded: left } }))}>
                {left ? t('Left-handed') : t('Right-handed')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="rp-label">{t('Backing')}</span>
          <div className="rp-seg" role="radiogroup" aria-label={t('Backing')}>
            <button type="button" className="rp-seg__item" role="radio" aria-checked="true">
              {t('Synth')}
            </button>
            <button type="button" className="rp-seg__item" role="radio" aria-checked="false" disabled title={t('Recordings will come later')}>
              {t('Recording')}
            </button>
          </div>
        </div>
        <div>
          <span className="rp-label">{t('Your part in the backing')}</span>
          <PartLevelSeg />
        </div>
      </section>

      {arr && (
        <div className="song-page__cta">
          <a className="rp-btn rp-btn--light rp-btn--xl" href={playHref(song.id, arr.id)} data-ui="song-play">
            <GuitarIcon name="player-play-filled" />
            {t('Play')} <span className="rp-kbd">Space</span>
          </a>
          <span className="rp-muted">{t('Without scoring: play along with the highway')}</span>
        </div>
      )}
    </div>
  );
}
