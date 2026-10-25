// Библиотека (ui-spec §11.2; этап 12, срез 1 — подмножество): сетка карточек песен с постерами, импорт партитуры
// кнопкой и перетаскиванием файла в окно, демо-песня, удаление с подтверждением, пустое состояние с дропзоной.
// Фильтры, поиск, «Продолжить», «Обработка», окно импорта с выбором дорожек — следующим проходом этапа 12.
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../../lib/i18n';
import demoTex from '../../demo/demo.alphatex?raw';
import { importErrorText } from '../../import/workerClient';
import { tempoMapOf, tickToMs } from '../../model/tempo';
import type { ArrangementRole, GuitarArrangement, GuitarSong } from '../../model/types';
import { count } from '../../i18n';
import { guitarLibrary } from '../../store/library';
import { GUITAR_PATTERNS, GuitarIcon, type GuitarPatternName } from '../../ui/GuitarIcon';
import { clock, playHref, songHref } from '../Play/PlayScreen';
import './library.css';

interface Entry {
  song: GuitarSong;
  arrangements: GuitarArrangement[];
}

export const ROLE: Record<ArrangementRole, { label: string }> = {
  lead: { label: 'Lead' }, rhythm: { label: 'Rhythm' }, combo: { label: 'Guitar' }, bass: { label: 'Bass' }, other: { label: 'Other' },
};
const PATTERNS = Object.keys(GUITAR_PATTERNS) as GuitarPatternName[];

/** Постер песни (ui-spec §9.9): оттенки и узор — от fnv1a названия, одинаковые на каждом экране. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
export function posterStyle(title: string) {
  const h = fnv1a(title);
  return { style: { ['--h1' as string]: h % 360, ['--h2' as string]: (h >>> 9) % 360 }, pattern: PATTERNS[(h >>> 18) % PATTERNS.length] };
}
export function Poster({ title, className = '', children }: { title: string; className?: string; children?: React.ReactNode }) {
  const { style, pattern } = posterStyle(title);
  const art = GUITAR_PATTERNS[pattern];
  return (
    <div className={`rp-poster ${className}`} style={style}>
      <svg className="rp-poster__art" viewBox={art.viewBox} preserveAspectRatio="xMidYMid slice" aria-hidden="true" dangerouslySetInnerHTML={{ __html: art.markup }} />
      <span className="rp-poster__glyph" aria-hidden="true">
        {title.trim().charAt(0).toUpperCase()}
      </span>
      {children}
    </div>
  );
}
export const durationOf = (a: GuitarArrangement) => tickToMs(tempoMapOf(a.timeline.tempos), a.timeline.durationTicks);

export function LibraryScreen() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [status, setStatus] = useState<{ kind: 'busy' | 'ok' | 'bad'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const lib = await guitarLibrary();
    const songs = await lib.allSongs();
    const list = await Promise.all(songs.map(async (song) => ({ song, arrangements: await lib.getArrangements(song.id) })));
    list.sort((a, b) => (b.song.lastPlayedAt ?? b.song.createdAt) - (a.song.lastPlayedAt ?? a.song.createdAt));
    setEntries(list);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setStatus({ kind: 'bad', text: String(e) }));
  }, [refresh]);

  const importFiles = useCallback(
    async (files: File[]) => {
      const lib = await guitarLibrary();
      for (const file of files) {
        setStatus({ kind: 'busy', text: `${t('Reading')} ${file.name}…` });
        try {
          const r = await lib.importFile(new Uint8Array(await file.arrayBuffer()), file.name);
          setStatus({ kind: 'ok', text: r.duplicate ? `${r.song.title}: ${t('already in the library')}` : `${r.song.title}: ${t('added')} · ${count(r.arrangements.length, 'part')}` });
        } catch (e) {
          setStatus({ kind: 'bad', text: `${file.name}: ${importErrorText(e)}` });
        }
      }
      await refresh();
    },
    [refresh],
  );
  const importDemo = async () => {
    setStatus({ kind: 'busy', text: t('Preparing the demo song…') });
    try {
      const r = await (await guitarLibrary()).importAlphaTex(demoTex, 'demo.alphatex');
      setStatus({ kind: 'ok', text: `${r.song.title}: ${t('added')}` });
      await refresh();
    } catch (e) {
      setStatus({ kind: 'bad', text: importErrorText(e) });
    }
  };

  // Перетаскивание файла в любое место окна.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDragging(false);
      void importFiles([...e.dataTransfer.files]);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [importFiles]);

  const remove = async (id: string) => {
    setConfirm(null);
    try {
      await (await guitarLibrary()).removeSong(id);
    } catch (e) {
      setStatus({ kind: 'bad', text: importErrorText(e) });
    }
    await refresh();
  };

  const parts = entries?.reduce((n, e) => n + e.arrangements.length, 0) ?? 0;
  const input = (
    <input ref={fileRef} type="file" hidden multiple accept=".gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8,.musicxml,.xml,.mxl"
      onChange={(e) => {
        void importFiles([...(e.target.files ?? [])]);
        e.target.value = '';
      }} />
  );

  return (
    <div className="rp-page" data-ui="library">
      {input}
      <div className="lib-head">
        <div className="lib-head__title">
          <h1 className="rp-h1">{t('Library')}</h1>
          {!!entries?.length && (
            <span className="rp-num">
              {count(entries.length, 'song')} · {count(parts, 'part')}
            </span>
          )}
        </div>
        <button type="button" className="rp-btn rp-btn--light" onClick={() => fileRef.current?.click()} data-ui="library-add">
          <GuitarIcon name="plus" size="sm" />
          {t('Add a song')}
        </button>
      </div>
      {status && (
        <p className={`lib-status lib-status--${status.kind}`} data-ui="library-status" role="status">
          {status.text}
        </p>
      )}
      {entries && !entries.length && (
        <div className="lib-empty" data-ui="library-empty">
          <div className={`rp-dropzone lib-empty__drop${dragging ? ' rp-dropzone--over' : ''}`}>
            <GuitarIcon name="file-music" size="xl" />
            <h2 className="rp-h2">{t('Drop a Guitar Pro or MusicXML file here')}</h2>
            <p>{t('GP3–GP8, GPX, MusicXML. Files stay on this computer.')}</p>
            <div className="lib-empty__actions">
              <button type="button" className="rp-btn rp-btn--light" onClick={() => fileRef.current?.click()}>
                <GuitarIcon name="upload" size="sm" />
                {t('Choose a file')}
              </button>
              <button type="button" className="rp-btn" onClick={() => void importDemo()} data-ui="library-demo">
                <GuitarIcon name="music" size="sm" />
                {t('Take the demo song')}
              </button>
            </div>
          </div>
        </div>
      )}
      {!!entries?.length && (
        <>
          {dragging && <div className="rp-dropzone rp-dropzone--over lib-dropbar">{t('Drop the file to add it')}</div>}
          <div className="lib-grid" data-ui="library-grid">
            {entries.map(({ song, arrangements }) => {
              const first = arrangements[0];
              return (
                <article key={song.id} className="rp-songcard" data-song={song.id}>
                  {/* Пюпитр: ▶ — соседняя ссылка в общей обёртке (в макете она внутри ссылки постера — так нельзя) */}
                  <div className="rp-songcard__media">
                    <a className="rp-songcard__poster-link" href={songHref(song.id)} aria-label={song.title}>
                      <Poster title={song.title} className="rp-songcard__poster">
                        <span className="rp-chip rp-chip--dot rp-chip--onart">{t('Synth')}</span>
                        {first && <span className="rp-songcard__tune">{first.tuning.name.toUpperCase()}</span>}
                        {first && <span className="rp-songcard__dur rp-num">{clock(durationOf(first))}</span>}
                      </Poster>
                    </a>
                    {first && (
                      <a className="rp-songcard__play" href={playHref(song.id, first.id)} aria-label={t('Play')} data-ui="library-play">
                        <GuitarIcon name="player-play-filled" />
                      </a>
                    )}
                  </div>
                  <div className="rp-songcard__body">
                    <h3>{song.title}</h3>
                    <p>{song.artist || '—'}</p>
                    <div className="rp-songcard__arr">
                      {arrangements.map((a) => (
                        <span key={a.id} className="rp-tag">
                          {t(ROLE[a.role].label)}
                        </span>
                      ))}
                    </div>
                    {confirm === song.id ? (
                      <div className="lib-confirm">
                        <span>{t('Delete the song and its progress from this computer?')}</span>
                        <button type="button" className="rp-btn rp-btn--danger rp-btn--sm" onClick={() => void remove(song.id)}>
                          {t('Delete')}
                        </button>
                        <button type="button" className="rp-btn rp-btn--ghost rp-btn--sm" onClick={() => setConfirm(null)}>
                          {t('Cancel')}
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="rp-btn rp-btn--ghost rp-btn--sm lib-delete" onClick={() => setConfirm(song.id)} aria-label={t('Delete')}>
                        <GuitarIcon name="trash" size="sm" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      <p className="lib-foot rp-faint">{t('Files stay on this computer')}</p>
    </div>
  );
}
