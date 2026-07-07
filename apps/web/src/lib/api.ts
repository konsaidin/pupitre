// Клиент бэкенда песен (FastAPI за /api, см. vite proxy).

import type { SongMap } from './songMap';

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
  return jsonOrThrow(await fetch('/api/songs'));
}

export async function uploadSong(file: File): Promise<SongInfo> {
  const form = new FormData();
  form.append('file', file);
  return jsonOrThrow(await fetch('/api/songs', { method: 'POST', body: form }));
}

export async function getSong(id: string): Promise<SongDetail> {
  return jsonOrThrow(await fetch(`/api/songs/${id}`));
}

export async function deleteSong(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/songs/${id}`, { method: 'DELETE' }));
}

export async function retrySong(id: string): Promise<SongInfo> {
  return jsonOrThrow(await fetch(`/api/songs/${id}/retry`, { method: 'POST' }));
}

export function instrumentalUrl(id: string): string {
  return `/api/songs/${id}/instrumental`;
}
