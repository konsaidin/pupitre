// Клиент бэкенда песен (FastAPI за /api, см. vite proxy).
//
// В вебе база пустая — запросы идут на тот же хост (vite proxy / reverse proxy).
// В десктопном приложении (file://) база по умолчанию http://localhost:8000,
// и её можно сменить в настройках (см. getApiBase/setApiBase).

import { t } from './i18n';
import type { ExtractSettings, MapNote, Pitchline, SongMap } from './songMap';

const API_BASE_KEY = 'pupitre.apiBase.v1';

/** Мост из Electron-preload: адрес встроенного бэкенда и его статус. */
interface DesktopBridge {
  apiBase: string;
  onBackendStatus(cb: (s: { stage: string; detail?: string; progress?: number }) => void): () => void;
  /** повторить развёртывание после ошибки (есть в сборках с ретраем) */
  retrySetup?: () => void;
}
export function desktopBridge(): DesktopBridge | null {
  return (window as { desktop?: DesktopBridge }).desktop ?? null;
}

export function getApiBase(): string {
  const saved = localStorage.getItem(API_BASE_KEY);
  if (saved != null) return saved.replace(/\/+$/, '');
  return desktopBridge()?.apiBase ?? '';
}

/** Пустая строка = «как у сайта»; null/пусто в десктопе вернёт дефолт при чтении. */
export function setApiBase(url: string | null): void {
  if (url == null || url.trim() === '') localStorage.removeItem(API_BASE_KEY);
  else localStorage.setItem(API_BASE_KEY, url.trim().replace(/\/+$/, ''));
}

const api = (path: string): string => `${getApiBase()}${path}`;

export type SongStatus = 'queued' | 'processing' | 'done' | 'error';
export type SongStage = 'queued' | 'decode' | 'separate' | 'analyze' | 'done' | 'error';

export interface SongInfo {
  id: string;
  title: string;
  artist: string;
  status: SongStatus;
  stage: SongStage;
  /** сквозной прогресс 0..100 */
  progress: number;
  error: string;
  durationMs: number;
  noteCount: number;
  lowMidi: number;
  highMidi: number;
  /** false — Demucs недоступен, инструментал = полный микс */
  separated: boolean;
  /** причина, по которой вокал не отделён; '' — отделён */
  separationError: string;
  createdAt: number;
}

export interface SongDetail extends SongInfo {
  /** карта нот; есть только при status === 'done' */
  map?: SongMap;
}

async function jsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { detail?: string };
      if (body.detail) msg = body.detail;
    } catch {
      // тело не JSON
    }
    throw new Error(msg);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

export async function listSongs(): Promise<SongInfo[]> {
  return jsonOrThrow(await fetch(api('/api/songs')));
}

export async function uploadSong(file: File): Promise<SongInfo> {
  const form = new FormData();
  form.append('file', file);
  return jsonOrThrow(await fetch(api('/api/songs'), { method: 'POST', body: form }));
}

export async function getSong(id: string): Promise<SongDetail> {
  return jsonOrThrow(await fetch(api(`/api/songs/${id}`)));
}

export async function deleteSong(id: string): Promise<void> {
  await jsonOrThrow(await fetch(api(`/api/songs/${id}`), { method: 'DELETE' }));
}

export async function retrySong(id: string): Promise<SongInfo> {
  return jsonOrThrow(await fetch(api(`/api/songs/${id}/retry`), { method: 'POST' }));
}

export function instrumentalUrl(id: string): string {
  return api(`/api/songs/${id}/instrumental`);
}

export function vocalUrl(id: string): string {
  return api(`/api/songs/${id}/vocal`);
}

/** Оригинальный трек с вокалом (вариант исполнения «с вокалом»). */
export function mixUrl(id: string): string {
  return api(`/api/songs/${id}/mix`);
}

/** Контур высоты вокала. null — если бэкенд его не сохранил (старые карты). */
export async function getPitchline(id: string): Promise<Pitchline | null> {
  const resp = await fetch(api(`/api/songs/${id}/pitchline`));
  if (resp.status === 404) return null;
  return jsonOrThrow<Pitchline>(resp);
}

/**
 * Готовая к игре карта песни: map.json + контур + url инструментала.
 * Общий загрузчик для библиотеки и обновления после переснятия.
 */
export async function loadSongMap(id: string): Promise<SongMap> {
  const detail = await getSong(id);
  if (!detail.map) throw new Error(t('Map is not ready yet'));
  const pitchline = detail.map.hasPitchline ? await getPitchline(id).catch(() => null) : null;
  return {
    ...detail.map,
    title: detail.title || detail.map.title,
    subtitle: detail.artist || detail.map.subtitle,
    backing: { kind: 'url', url: instrumentalUrl(id) },
    pitchline: pitchline ?? undefined,
  };
}

/** Переснять мелодию с новыми настройками (без Demucs); дальше — поллинг статуса. */
export async function reextractSong(id: string, params: ExtractSettings): Promise<SongInfo> {
  return jsonOrThrow(
    await fetch(api(`/api/songs/${id}/reextract`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),
  );
}

/** Сохранить отредактированные ноты в карту песни на бэкенде. */
export async function saveMap(id: string, notes: MapNote[]): Promise<{ noteCount: number }> {
  const body = notes.map((n) => ({
    startMs: Math.round(n.startMs),
    durMs: Math.round(n.durMs),
    midi: Math.round(n.midi),
    ...(n.lyric ? { lyric: n.lyric } : {}),
  }));
  return jsonOrThrow(
    await fetch(api(`/api/songs/${id}/map`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: body }),
    }),
  );
}
