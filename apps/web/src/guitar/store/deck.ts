// Дека записи — одна на раздел и живёт вне экранов: запись и прослушивание не обрываются при переходе с «Тона» на игру
// или тюнер. Запись — сухой DI открытого входа и снимок тона на её начало; остановка сохраняет дубль; вход закрылся или
// потерян посреди записи — дубль сохраняется тем, что успели; за NO_AUDIO_MS не пришло ни куска — записи нет (ошибка).
// Прослушивание — с текущим тоном (ручки крутятся вживую — ре-ампинг), как записан или сухой DI; после конца дубля
// хвост дилея и комнаты доигрывает TAIL_MS. Каждый запуск прослушивания — со своим номером: устаревший (выбрали другой
// дубль, пока этот грузился) ничего не трогает. Выгрузка — WAV 24 бит (офлайн через ядро, с прогрессом), по одной.
// Живые числа (время, уровень) — функциями для кадров анимации; состояние — подпиской.
import { useSyncExternalStore } from 'react';
import { inputRecordable, startRecording, type Recording } from '../../audio/guitar/recorder';
import { getInputSnapshot, subscribeInput, type InputState } from '../../audio/instrument/session';
import { playTake, type TakePlayback } from '../../audio/guitar/takePlayer';
import { toneParams, utilitiesOn, type ToneShape } from '../../audio/guitar/tone';
import { renderTone } from '../../audio/guitar/toneRender';
import { encodeWav24 } from '../../audio/guitar/wav';
import { loadGuitarSettings, subscribeGuitarSettings } from './settings';
import { addTake, nextTakeName, takeSamples, takesNow, type TakeInfo } from './takes';

export type PlayMode = 'current' | 'recorded' | 'dry';
export type DeckPhase = 'idle' | 'recording' | 'saving' | 'loading' | 'playing';

export interface DeckSnapshot {
  phase: DeckPhase;
  /** Дубль под головкой: выбранный, играющий или только что записанный. */
  takeId: string | null;
  mode: PlayMode;
  /** Выгрузка: какой дубль и доля готовности. */
  rendering: { takeId: string; share: number } | null;
  /** Почему не вышло: 'no-input' — входа нет или он не умеет отдавать запись; 'no-audio' — вход открыт, но звук для
   *  записи не идёт; 'failed' — сбой чтения или вывода. */
  error: '' | 'no-input' | 'no-audio' | 'failed';
}

/** Короче — не дубль (случайное нажатие). */
const MIN_TAKE_S = 0.3;
/** Столько ждём первый кусок записи. */
const NO_AUDIO_MS = 1500;
/** После конца дубля ворклет ещё звучит — хвост дилея и комнаты. */
const TAIL_MS = 3000;
const OPEN: ReadonlySet<InputState> = new Set(['ok', 'no-signal', 'clipping']);

let snap: DeckSnapshot = { phase: 'idle', takeId: null, mode: 'current', rendering: null, error: '' };
let recording: Recording | null = null;
let recordTone: ToneShape | null = null;
let recordWord = 'Take';
let playback: TakePlayback | null = null;
/** Доигравший дубль, у которого ещё звенит хвост. */
let ringing: TakePlayback | null = null;
let followTone: (() => void) | null = null;
let playToken = 0;
let unwatchInput: (() => void) | null = null;
let noAudio: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(patch: Partial<DeckSnapshot>) {
  snap = { ...snap, ...patch };
  for (const fn of [...listeners]) fn();
}

function paramsFor(mode: PlayMode, take: TakeInfo | undefined): number[] {
  if (mode === 'dry') return toneParams(null);
  if (mode === 'recorded' && take) return toneParams({ ...take.tone, on: true });
  return toneParams(loadGuitarSettings().tone);
}

function stopPlayback() {
  followTone?.();
  followTone = null;
  playback?.stop();
  playback = null;
  ringing?.stop();
  ringing = null;
}

function stopWatching() {
  unwatchInput?.();
  unwatchInput = null;
  clearTimeout(noAudio);
}

/** Начать запись; word — «Дубль» на языке интерфейса (имя дубля — «Дубль N»). */
export function deckRecord(word: string): void {
  if (snap.phase === 'recording' || snap.phase === 'saving') return;
  stopPlayback();
  if (!inputRecordable()) {
    set({ phase: 'idle', error: 'no-input' });
    return;
  }
  playToken++;
  recordWord = word;
  recordTone = loadGuitarSettings().tone;
  recording = startRecording(() => void deckStop());
  // вход закрылся (ушли из раздела, переоткрытие) или потерян — дубль сохраняется тем, что успели
  unwatchInput = subscribeInput(() => {
    if (!OPEN.has(getInputSnapshot().state)) void deckStop();
  });
  noAudio = setTimeout(() => {
    if (!recording || recording.seconds() > 0) return;
    recording.stop();
    recording = null;
    stopWatching();
    set({ phase: 'idle', error: 'no-audio' });
  }, NO_AUDIO_MS);
  set({ phase: 'recording', error: '' });
}

/** Остановить запись (сохранить дубль) или прослушивание. */
export async function deckStop(): Promise<void> {
  if (snap.phase === 'recording' && recording) {
    stopWatching();
    const audio = recording.stop();
    recording = null;
    if (!audio || audio.samples.length < MIN_TAKE_S * audio.sampleRate) {
      set({ phase: 'idle' });
      return;
    }
    set({ phase: 'saving' });
    try {
      const take = await addTake({ ...audio, tone: recordTone ?? loadGuitarSettings().tone, name: nextTakeName(takesNow(), recordWord) });
      set({ phase: 'idle', takeId: take.id });
    } catch {
      set({ phase: 'idle', error: 'failed' });
    }
    return;
  }
  playToken++;
  stopPlayback();
  if (snap.phase === 'playing' || snap.phase === 'loading') set({ phase: 'idle' });
}

/** Слушать дубль (по умолчанию — под головкой) с выбранным звуком. */
export async function deckPlay(takeId = snap.takeId ?? takesNow()[0]?.id ?? null): Promise<void> {
  if (!takeId || snap.phase === 'recording' || snap.phase === 'saving') return;
  const token = ++playToken;
  stopPlayback();
  const take = takesNow().find((t) => t.id === takeId);
  set({ phase: 'loading', takeId, error: '' });
  try {
    const samples = await takeSamples(takeId);
    if (token !== playToken) return;
    if (!samples || !take) {
      set({ phase: 'idle' });
      return;
    }
    const mine = await playTake(samples, take.sampleRate, paramsFor(snap.mode, take));
    if (token !== playToken) {
      mine.stop();
      return;
    }
    playback = mine;
    mine.onEnded = () => {
      if (playback !== mine) return;
      // дубль доиграл: хвост дилея и комнаты ещё звучит — узлы живут TAIL_MS (или до следующего запуска)
      followTone?.();
      followTone = null;
      playback = null;
      ringing = mine;
      setTimeout(() => {
        if (ringing !== mine) return;
        mine.stop();
        ringing = null;
      }, TAIL_MS);
      set({ phase: 'idle' });
    };
    // «с текущим тоном»: ручки крутятся — звук дубля меняется сразу
    followTone = subscribeGuitarSettings(() => {
      if (snap.mode === 'current') playback?.setTone(paramsFor('current', take));
    });
    set({ phase: 'playing' });
  } catch {
    if (token !== playToken) return;
    stopPlayback();
    set({ phase: 'idle', error: 'failed' });
  }
}

export function deckMode(mode: PlayMode): void {
  set({ mode });
  if (playback && snap.takeId) playback.setTone(paramsFor(mode, takesNow().find((t) => t.id === snap.takeId)));
}

export function deckSelect(takeId: string | null): void {
  if (snap.phase === 'recording' || snap.phase === 'saving' || takeId === snap.takeId) return;
  if (snap.phase === 'playing' || snap.phase === 'loading') {
    void deckPlay(takeId ?? undefined);
    return;
  }
  set({ takeId });
}

/** Дубль удалён: если он под головкой — головка свободна. */
export function deckForget(takeId: string): void {
  if (snap.takeId !== takeId) return;
  stopPlayback();
  set({ phase: snap.phase === 'recording' || snap.phase === 'saving' ? snap.phase : 'idle', takeId: null });
}

/** WAV дубля с выбранным звуком; вернёт Blob (выгрузку делает экран). Хвост — пока звенят дилей или комната. */
export async function deckRender(takeId: string, mode: PlayMode): Promise<Blob | null> {
  // выгрузки — по одной: прогресс у деки один
  if (snap.rendering) return null;
  const take = takesNow().find((t) => t.id === takeId);
  const samples = await takeSamples(takeId);
  if (!take || !samples) return null;
  if (mode === 'dry') return encodeWav24(samples, take.sampleRate);
  if (snap.rendering) return null;
  const tone = mode === 'recorded' ? { ...take.tone, on: true } : loadGuitarSettings().tone;
  const on = utilitiesOn(tone);
  const tailSec = tone.on && (on.delay || on.room) ? 2.5 : 0.25;
  set({ rendering: { takeId, share: 0 } });
  try {
    const out = await renderTone(samples, take.sampleRate, toneParams(tone), {
      tailSec, onProgress: (share) => set({ rendering: { takeId, share } }),
    });
    return encodeWav24(out, take.sampleRate);
  } finally {
    set({ rendering: null });
  }
}

/** Живое время: запись — записано, прослушивание — позиция; иначе 0. */
export const deckSeconds = (): number => recording?.seconds() ?? playback?.position() ?? 0;
/** Длина играющего дубля, с; 0 — не играет. */
export const deckDuration = (): number => playback?.duration ?? 0;
/** Живой уровень: запись — вход, прослушивание — выход; dBFS. */
export const deckLevelDb = (): number => recording?.levelDb() ?? playback?.levelDb() ?? -Infinity;

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const useDeck = (): DeckSnapshot => useSyncExternalStore(subscribe, () => snap, () => snap);
export const deckNow = (): DeckSnapshot => snap;
