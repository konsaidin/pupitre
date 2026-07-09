// Библиотека песен: загрузка файла, статусы обработки, запуск игры.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  deleteSong,
  getPitchline,
  getSong,
  instrumentalUrl,
  listSongs,
  retrySong,
  uploadSong,
  type SongInfo,
  type SongStage,
} from '../lib/api';
import { bestScore } from '../lib/profile';
import type { SongMap } from '../lib/songMap';
import { useProfile } from '../state/ProfileContext';
import { SpotlightCard } from '../components/fx/SpotlightCard';
import type { PlayState } from './GameScreen';

const STAGE_LABEL: Record<SongStage, string> = {
  queued: 'В очереди…',
  decode: 'Декодирую…',
  separate: 'Отделяю вокал…',
  analyze: 'Снимаю мелодию…',
  done: 'Готово',
  error: 'Ошибка',
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
      setError(e instanceof Error ? e.message : 'Бэкенд недоступен');
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
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  };

  const playSong = async (s: SongInfo) => {
    try {
      const detail = await getSong(s.id);
      if (!detail.map) throw new Error('Карта нот ещё не готова');
      const pitchline = detail.map.hasPitchline ? await getPitchline(s.id).catch(() => null) : null;
      const map: SongMap = {
        ...detail.map,
        title: s.title,
        subtitle: s.artist || detail.map.subtitle,
        backing: { kind: 'url', url: instrumentalUrl(s.id) },
        pitchline: pitchline ?? undefined,
      };
      const state: PlayState = { map, kind: 'song' };
      navigate('/play', { state });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось открыть песню');
    }
  };

  return (
    <div className="screen">
      <h1>Песни</h1>
      <div
        className={dragOver ? 'dropzone over' : 'dropzone'}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <span>📥 Перетащи сюда mp3/wav/flac/m4a или нажми, чтобы выбрать файл</span>
        <span className="dim small">Трек обработается на сервере: вокал отделится, мелодия станет нотами</span>
        <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      </div>

      {error && (
        <p className="error">
          ⚠️ {error}. Проверь, что бэкенд запущен: <code>uvicorn app.main:app --port 8000</code> в services/api.
        </p>
      )}

      {songs && songs.length === 0 && !error && <p className="dim">Пока пусто — загрузи первый трек.</p>}

      <div className="card-list">
        {songs?.map((s) => {
          const best = bestScore(profile, s.id);
          const busy = s.status === 'queued' || s.status === 'processing';
          return (
            <SpotlightCard key={s.id} as="div" className="card song-card" tilt={false} magnetism={false}>
              <div className="card-head static">
                <span className="card-icon">{s.status === 'done' ? '🎧' : s.status === 'error' ? '⚠️' : '⏳'}</span>
                <span className="card-title">
                  <b>{s.artist ? `${s.artist} — ${s.title}` : s.title}</b>
                  <span className="dim small">
                    {STAGE_LABEL[s.stage]}
                    {s.error ? ` — ${s.error}` : ''}
                    {s.status === 'done' && s.durationMs ? ` · ${formatDur(s.durationMs)} · ${s.noteCount} нот` : ''}
                    {s.status === 'done' && !s.separated ? ' · вокал не отделён (играет полный микс)' : ''}
                  </span>
                  {busy && (
                    <span className="mini-progress"><span style={{ width: `${Math.round(s.progress)}%` }} /></span>
                  )}
                </span>
                {best && <span className="card-best">{'★'.repeat(best.stars)}<span className="dim"> {best.score}</span></span>}
                <div className="btn-row tight">
                  {s.status === 'done' && (
                    <button className="btn primary" onClick={() => void playSong(s)}>Петь</button>
                  )}
                  {s.status === 'error' && (
                    <button className="btn" onClick={() => void retrySong(s.id).then(refresh)}>Повторить</button>
                  )}
                  <button
                    className="btn ghost"
                    onClick={() => { if (confirm(`Удалить «${s.title}»?`)) void deleteSong(s.id).then(refresh); }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            </SpotlightCard>
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
