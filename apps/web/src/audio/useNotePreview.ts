import { useCallback, useEffect, useRef, useState } from 'react';
import { useMobileLandscape } from '../components/MobileLandscape';
import { t } from '../lib/i18n';
import type { MapNote } from '../lib/songMap';
import { getAudioContext } from './audioSession';
import { Synth } from './synth';

let activePreviewStop: (() => void) | null = null;
const EMPTY = { playing: false, activeIndex: -1, midi: null as number | null, progress: 0, error: '' };

/** A short, user-triggered audition. Only one preview can play at a time. */
export function useNotePreview() {
  const [state, setState] = useState(EMPTY);
  const synthRef = useRef<Synth | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const { blocked } = useMobileLandscape();
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const stop = useCallback(() => {
    generation.current++;
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    synthRef.current?.cancelAll();
    if (activePreviewStop === stop) activePreviewStop = null;
    if (mounted.current) setState(EMPTY);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      stop();
      synthRef.current?.dispose();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [stop]);
  useEffect(() => {
    if (blocked) stop();
  }, [blocked, stop]);

  const play = useCallback(
    async (source: MapNote[]) => {
      stop();
      if (blockedRef.current || !source.length) return;
      const request = generation.current;
      const origin = source[0].startMs;
      const notes = source
        .slice(0, 15)
        .filter((n) => Number.isFinite(n.midi) && n.durMs > 0 && n.startMs - origin < 8000);
      if (!notes.length) return;
      try {
        const ctx = getAudioContext();
        await ctx.resume();
        if (!mounted.current || request !== generation.current || blockedRef.current) return;
        activePreviewStop?.();
        activePreviewStop = stop;
        const synth = (synthRef.current ??= new Synth(ctx, 0.32));
        const startAt = ctx.currentTime + 0.03;
        const duration = Math.min(8000, notes.at(-1)!.startMs + notes.at(-1)!.durMs - origin);
        for (const n of notes) {
          const offset = n.startMs - origin;
          synth.playNote(
            n.midi,
            startAt + offset / 1000,
            Math.max(0.05, Math.min(n.durMs, duration - offset) / 1000),
            0.65,
          );
        }
        setState({ ...EMPTY, playing: true, activeIndex: 0, midi: notes[0].midi });
        timerRef.current = setInterval(() => {
          const elapsed = (ctx.currentTime - startAt) * 1000;
          if (elapsed >= duration + 50) {
            stop();
            return;
          }
          const activeIndex = notes.findIndex(
            (n) => elapsed >= n.startMs - origin && elapsed < n.startMs - origin + n.durMs,
          );
          setState({
            playing: true,
            activeIndex,
            midi: notes[activeIndex]?.midi ?? null,
            progress: Math.min(1, Math.max(0, elapsed / duration)),
            error: '',
          });
        }, 50);
      } catch {
        stop();
        if (mounted.current) setState({ ...EMPTY, error: t('Could not play the preview. Try again.') });
      }
    },
    [stop],
  );

  return { ...state, play, stop };
}
