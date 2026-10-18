import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Icon } from '../components/Icon';
import type { PlayState } from './GameScreen';

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
    <div className="screen library-screen">
      <ScreenHeader
        title={t('Your soundtrack.')}
        eyebrow={t('The songs you make your own')}
        subtitle={t('The music you love. The voice only you have. Put them together.')}
        action={
          <span className="count-badge">
            <Icon name="note" size={16} />
            {ready} {t('ready')}
          </span>
        }
      />
      <button
        className={`dropzone${dragOver ? ' over' : ''}`}
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
      >
        <span className="upload-art" aria-hidden="true">
          <span className="upload-disc" />
          <span className="upload-plus">+</span>
        </span>
        <span className="dropzone-copy">
          <span className="overline">{t('Make it your next song')}</span>
          <strong>{uploading ? t('Uploading…') : t('Drop a track. Find your part.')}</strong>
          <span>{t('We’ll find the vocal melody and turn it into notes you can sing along with.')}</span>
          <small>MP3, WAV, FLAC, M4A</small>
        </span>
        <span className="btn primary">
          <Icon name="upload" size={18} />
          {uploading ? t('Uploading…') : t('Choose a file')}
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
        <div className="notice error" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <strong>{t('The library needs a moment.')}</strong>
            <p>{t('Check your connection or the song server in settings, then try again.')}</p>
            <details>
              <summary>{t('Details')}</summary>
              <p>{error}</p>
            </details>
          </div>
          <button className="btn" onClick={() => void refresh()}>
            {t('Retry')}
          </button>
        </div>
      )}
      <div className="library-toolbar">
        <div className="chip-row">
          {(['all', 'ready', 'processing'] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? 'chip-btn active' : 'chip-btn'}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {t(f === 'all' ? 'All tracks' : f === 'ready' ? 'Ready' : 'Processing')}
              <span>{f === 'all' ? (songs?.length ?? 0) : f === 'ready' ? ready : processing}</span>
            </button>
          ))}
        </div>
        <label className="search-field">
          <Icon name="search" size={18} />
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
        <div className="empty-state" role="status">
          <Icon name="note" size={32} />
          <h2>{t('Opening your library…')}</h2>
          <p>{t('Your next favorite session is on its way.')}</p>
        </div>
      )}
      {songs?.length === 0 && !error && (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="headphones" size={32} />
          </span>
          <h2>{t('Every repertoire starts with one song.')}</h2>
          <p>{t('Add a track above. We’ll get the notes ready for your first take.')}</p>
        </div>
      )}
      {songs && songs.length > 0 && visible?.length === 0 && (
        <div className="empty-state">
          <Icon name="search" size={28} />
          <h2>{t('No tracks found')}</h2>
          <p>{t('Try another title or show all tracks.')}</p>
          <button
            className="btn"
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
        <div className="track-list">
          <div className="track-list-head">
            <span>#</span>
            <span>{t('Track')}</span>
            <span>{t('Status')}</span>
            <span>{t('Best result')}</span>
            <span />
          </div>
          {visible.map((s, i) => {
            const best = bestScore(profile, s.id);
            const busy = s.status === 'queued' || s.status === 'processing';
            const cover = s.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4;
            return (
              <article key={s.id} className="track-row">
                <span className="track-number">{String(i + 1).padStart(2, '0')}</span>
                <div className="track-identity">
                  <span className={`track-cover cover-${cover}`} aria-hidden="true">
                    <span />
                    <Icon name="note" size={20} />
                  </span>
                  <div>
                    <h3 title={s.title}>{s.title}</h3>
                    <p>
                      {s.artist || t('Your collection')}
                      {s.durationMs ? ` · ${formatDur(s.durationMs)}` : ''}
                      {s.status === 'done' ? ` · ${t('{n} notes', { n: s.noteCount })}` : ''}
                    </p>
                    {s.status === 'done' && !s.separated && (
                      <span className="track-warning" title={s.separationError ?? undefined}>
                        {t('Full mix playback')}
                      </span>
                    )}
                    {s.error && (
                      <details className="track-error">
                        <summary>{t('What happened?')}</summary>
                        {s.error}
                      </details>
                    )}
                    {busy && (
                      <span
                        className="mini-progress"
                        role="progressbar"
                        aria-label={t(STAGE_LABEL[s.stage])}
                        aria-valuenow={Math.round(s.progress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span style={{ width: `${s.progress}%` }} />
                      </span>
                    )}
                  </div>
                </div>
                <span className={`track-status ${s.status}`}>
                  <i />
                  {t(STAGE_LABEL[s.stage])}
                  {busy ? ` ${Math.round(s.progress)}%` : ''}
                </span>
                <span className="track-best">
                  {best ? (
                    <>
                      <b>{Math.round(best.accuracy * 100)}%</b>
                      <small>
                        {'★'.repeat(best.stars)}
                        {'☆'.repeat(3 - best.stars)}
                      </small>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </span>
                <div className="track-actions">
                  {s.status === 'done' && (
                    <button
                      className="btn play-track"
                      disabled={openingId !== null}
                      onClick={() => void playSong(s)}
                      aria-label={`${t('Sing')}: ${s.title}`}
                    >
                      <Icon name="play" size={18} />
                      <span>{openingId === s.id ? t('Opening…') : t('Sing')}</span>
                    </button>
                  )}
                  {s.status === 'error' && (
                    <button className="btn tiny" onClick={() => void songAction(() => retrySong(s.id))}>
                      {t('Retry')}
                    </button>
                  )}
                  <button
                    className="icon-btn delete-track"
                    aria-label={`${t('Delete')}: ${s.title}`}
                    onClick={() => {
                      if (confirm(t('Delete “{title}”?', { title: s.title })))
                        void songAction(() => deleteSong(s.id));
                    }}
                  >
                    <Icon name="trash" size={16} />
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
