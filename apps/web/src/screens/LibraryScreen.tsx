import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  deleteSong,
  listSongs,
  loadSongMap,
  retrySong,
  uploadSong,
  type SongInfo,
  type SongStage,
} from '../lib/api';
import { t } from '../lib/i18n';
import { bestScore } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { RampaPoster } from '../components/RampaPoster';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';
import type { PlayState } from './GameScreen';
import './vocal.css';

const STAGE_LABEL: Record<SongStage, string> = {
  queued: 'Queued…',
  decode: 'Decoding…',
  separate: 'Separating vocals…',
  analyze: 'Extracting melody…',
  done: 'Ready to sing',
  error: 'Needs attention',
};
type Filter = 'all' | 'ready' | 'processing';

export function LibraryScreen() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const [songs, setSongs] = useState<SongInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
      setSongs(await listSongs());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Backend unavailable'));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!songs?.some((s) => s.status === 'queued' || s.status === 'processing')) return;
    const iv = setInterval(() => void refresh(), 2000);
    return () => clearInterval(iv);
  }, [songs, refresh]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    const batch = Array.from(files);
    setUploading(true);
    try {
      for (const f of batch) await uploadSong(f);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Upload failed'));
    } finally {
      setUploading(false);
    }
  };
  const playSong = async (s: SongInfo) => {
    setOpeningId(s.id);
    try {
      const state: PlayState = { map: await loadSongMap(s.id), kind: 'song' };
      navigate('/play', { state });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not open the song'));
    } finally {
      setOpeningId(null);
    }
  };
  const songAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Something went wrong'));
    }
  };
  const ready = songs?.filter((s) => s.status === 'done').length ?? 0;
  const processing = songs?.filter((s) => s.status === 'processing' || s.status === 'queued').length ?? 0;
  const visible = songs?.filter((s) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'ready' ? s.status === 'done' : s.status === 'processing' || s.status === 'queued');
    return (
      matchesFilter &&
      `${s.title} ${s.artist ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    );
  });

  return (
    <div className="screen library-screen rp-page vo-page" data-ui="vocal-songs">
      <ScreenHeader
        title={t('Your soundtrack.')}
        eyebrow={t('The songs you make your own')}
        subtitle={t('The music you love. The voice only you have. Put them together.')}
        action={
          <>
            <span className="rp-chip rp-chip--plain">
              <GuitarIcon name="music" size="sm" />
              <span className="rp-num">{ready}</span> {t('ready')}
            </span>
            <button className="rp-btn rp-btn--light" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <GuitarIcon name="plus" size="sm" />
              {uploading ? t('Uploading…') : t('Choose a file')}
            </button>
          </>
        }
      />
      <button
        className={`rp-dropzone vo-drop${dragOver ? ' rp-dropzone--over' : ''}`}
        disabled={uploading}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void onFiles(e.dataTransfer.files);
        }}
        onClick={() => fileRef.current?.click()}
        data-ui="songs-drop"
      >
        <GuitarIcon name={uploading ? 'loader-2' : 'cloud-upload'} size="lg" className={uploading ? 'vo-spin' : undefined} />
        <span className="vo-drop__copy">
          <span className="rp-label">{t('Make it your next song')}</span>
          <strong className="rp-h3">{uploading ? t('Uploading…') : t('Drop a track. Find your part.')}</strong>
          <span className="rp-sm rp-muted">{t('We’ll find the vocal melody and turn it into notes you can sing along with.')}</span>
          <span className="rp-label rp-faint">MP3 · WAV · FLAC · M4A</span>
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {error && (
        <div className="rp-card rp-card--pad vo-notice" role="alert">
          <GuitarIcon name="alert-triangle" />
          <div>
            <b>{t('The library needs a moment.')}</b>
            <p className="rp-sm rp-muted">{t('Check your connection or the song server in settings, then try again.')}</p>
            <details className="rp-xs rp-faint">
              <summary>{t('Details')}</summary>
              <p>{error}</p>
            </details>
          </div>
          <button className="rp-btn" onClick={() => void refresh()}>
            <GuitarIcon name="refresh" size="sm" />
            {t('Retry')}
          </button>
        </div>
      )}
      <div className="vo-filters">
        <div className="rp-seg" role="group">
          {(['all', 'ready', 'processing'] as Filter[]).map((f) => (
            <button key={f} className="rp-seg__item" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(f === 'all' ? 'All tracks' : f === 'ready' ? 'Ready' : 'Processing')}
              <small>{f === 'all' ? (songs?.length ?? 0) : f === 'ready' ? ready : processing}</small>
            </button>
          ))}
        </div>
        <label className="rp-input vo-search">
          <GuitarIcon name="search" size="sm" />
          <input
            type="search"
            placeholder={t('Find a song…')}
            aria-label={t('Find a song…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {songs === null && !error && (
        <div className="rp-empty" role="status">
          <GuitarIcon name="loader-2" size="lg" className="vo-spin" />
          <h2 className="rp-h3">{t('Opening your library…')}</h2>
          <p>{t('Your next favorite session is on its way.')}</p>
        </div>
      )}
      {songs?.length === 0 && !error && (
        <div className="rp-empty">
          <GuitarIcon name="headphones" size="lg" />
          <h2 className="rp-h3">{t('Every repertoire starts with one song.')}</h2>
          <p>{t('Add a track above. We’ll get the notes ready for your first take.')}</p>
        </div>
      )}
      {songs && songs.length > 0 && visible?.length === 0 && (
        <div className="rp-empty">
          <GuitarIcon name="search" size="lg" />
          <h2 className="rp-h3">{t('No tracks found')}</h2>
          <p>{t('Try another title or show all tracks.')}</p>
          <button
            className="rp-btn"
            onClick={() => {
              setFilter('all');
              setQuery('');
            }}
          >
            {t('Show all tracks')}
          </button>
        </div>
      )}
      {!!visible?.length && (
        <div className="vo-songs">
          {visible.map((s) => {
            const best = bestScore(profile, s.id);
            const busy = s.status === 'queued' || s.status === 'processing';
            return (
              <article key={s.id} className="vo-song" data-status={s.status}>
                <RampaPoster seed={s.title} glyph={s.title.trim().charAt(0).toUpperCase()} className="vo-song__poster">
                  <span className={`rp-chip rp-chip--onart vo-song__status${s.status === 'done' ? ' rp-chip--ok' : busy ? ' rp-chip--info' : ''}`}>
                    {busy ? <GuitarIcon name="loader-2" size="sm" className="vo-spin" /> : <i className={`rp-led${s.status === 'done' ? ' rp-led--ok' : s.status === 'error' ? ' rp-led--bad' : ''}`} />}
                    {t(STAGE_LABEL[s.stage])}
                    {busy ? ` · ${Math.round(s.progress)} %` : ''}
                  </span>
                  {s.durationMs ? <span className="rp-num vo-song__dur">{formatDur(s.durationMs)}</span> : null}
                  {s.status === 'done' && (
                    <button
                      className="rp-btn rp-btn--light rp-btn--icon vo-song__play"
                      disabled={openingId !== null}
                      onClick={() => void playSong(s)}
                      aria-label={`${t('Sing')}: ${s.title}`}
                      title={openingId === s.id ? t('Opening…') : t('Sing')}
                    >
                      <GuitarIcon name={openingId === s.id ? 'loader-2' : 'player-play-filled'} className={openingId === s.id ? 'vo-spin' : undefined} />
                    </button>
                  )}
                </RampaPoster>
                {busy && (
                  <span
                    className="rp-progress vo-song__progress"
                    role="progressbar"
                    aria-label={t(STAGE_LABEL[s.stage])}
                    aria-valuenow={Math.round(s.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i style={{ width: `${s.progress}%` }} />
                  </span>
                )}
                <div className="vo-song__body">
                  <div className="vo-song__title">
                    <h3 title={s.title}>{s.title}</h3>
                    <p className="rp-sm rp-faint">
                      {s.artist || t('Your collection')}
                      {s.status === 'done' ? ` · ${t('{n} notes', { n: s.noteCount })}` : ''}
                    </p>
                  </div>
                  {best ? (
                    <span className="rp-ring vo-song__best" title={t('Best result')} style={{ '--p': best.accuracy } as CSSProperties}>
                      <span className="rp-num">{Math.round(best.accuracy * 100)}</span>
                    </span>
                  ) : (
                    <span className="rp-ring vo-song__best vo-song__best--none" title={t('Best result')}>
                      <span className="rp-num">—</span>
                    </span>
                  )}
                </div>
                <div className="vo-song__foot">
                  {s.status === 'done' && !s.separated && (
                    <span className="rp-tag" title={s.separationError ?? undefined}>
                      {t('Full mix playback')}
                    </span>
                  )}
                  {s.error && (
                    <details className="rp-xs rp-faint vo-song__error">
                      <summary>{t('What happened?')}</summary>
                      {s.error}
                    </details>
                  )}
                  {s.status === 'error' && (
                    <button className="rp-btn rp-btn--sm" onClick={() => void songAction(() => retrySong(s.id))}>
                      <GuitarIcon name="refresh" size="sm" />
                      {t('Retry')}
                    </button>
                  )}
                  <button
                    className="rp-btn rp-btn--ghost rp-btn--icon rp-btn--sm vo-song__delete"
                    aria-label={`${t('Delete')}: ${s.title}`}
                    title={t('Delete')}
                    onClick={() => {
                      if (confirm(t('Delete “{title}”?', { title: s.title }))) void songAction(() => deleteSong(s.id));
                    }}
                  >
                    <GuitarIcon name="trash" size="sm" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
function formatDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
