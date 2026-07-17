// Библиотека песен: загрузка файла, статусы обработки, запуск игры.

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
  done: 'Done',
  error: 'Error',
};

export function LibraryScreen() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const [songs, setSongs] = useState<SongInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
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

  // пока что-то обрабатывается — поллим
  useEffect(() => {
    if (!songs?.some((s) => s.status === 'queued' || s.status === 'processing')) return;
    const iv = setInterval(() => void refresh(), 2000);
    return () => clearInterval(iv);
  }, [songs, refresh]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      for (const f of Array.from(files)) await uploadSong(f);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Upload failed'));
    }
  };

  const playSong = async (s: SongInfo) => {
    try {
      const state: PlayState = { map: await loadSongMap(s.id), kind: 'song' };
      navigate('/play', { state });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not open the song'));
    }
  };

  return (
    <div className="screen">
      <ScreenHeader title={t('Songs')} />
      <div
        className={dragOver ? 'dropzone over' : 'dropzone'}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <span className="upload-orb"><Icon name="upload" size={20} /></span>
        <span>{t('Drop mp3/wav/flac/m4a here or click to pick a file')}</span>
        <span className="dim small">{t('The track is processed on the server: vocals get separated, the melody becomes notes')}</span>
        <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      </div>

      {error && (
        <p className="error">
          ⚠️ {error}. {t('Check that the backend is running:')} <code>uvicorn app.main:app --port 8000</code>
        </p>
      )}

      {songs && songs.length === 0 && !error && <p className="dim">{t('Nothing here yet — upload your first track.')}</p>}

      <div className="card-list">
        {songs?.map((s) => {
          const best = bestScore(profile, s.id);
          const busy = s.status === 'queued' || s.status === 'processing';
          return (
            <div key={s.id} className="card song-card">
              <div className="card-head static">
                <span className="card-glyph">
                  <Icon name={s.status === 'done' ? 'note' : s.status === 'error' ? 'alert' : 'clock'} size={19} />
                </span>
                <span className="card-title">
                  <b>{s.artist ? `${s.artist} — ${s.title}` : s.title}</b>
                  <span className="dim small">
                    {t(STAGE_LABEL[s.stage])}
                    {s.error ? ` — ${s.error}` : ''}
                    {s.status === 'done' && s.durationMs ? ` · ${formatDur(s.durationMs)} · ${t('{n} notes', { n: s.noteCount })}` : ''}
                    {s.status === 'done' && !s.separated ? ` · ${t('vocals not separated (full mix plays)')}` : ''}
                  </span>
                  {busy && (
                    <span className="mini-progress"><span style={{ width: `${Math.round(s.progress)}%` }} /></span>
                  )}
                </span>
                {best && <span className="card-best">{'★'.repeat(best.stars)}<span className="dim"> {best.score}</span></span>}
                <div className="btn-row tight">
                  {s.status === 'done' && (
                    <button className="btn primary" onClick={() => void playSong(s)}>{t('Sing')}</button>
                  )}
                  {s.status === 'error' && (
                    <button className="btn" onClick={() => void retrySong(s.id).then(refresh)}>{t('Retry')}</button>
                  )}
                  <button
                    className="btn ghost"
                    aria-label={t('Delete')}
                    onClick={() => { if (confirm(t('Delete “{title}”?', { title: s.title }))) void deleteSong(s.id).then(refresh); }}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
