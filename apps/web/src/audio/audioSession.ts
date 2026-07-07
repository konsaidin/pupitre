// Единственный AudioContext и PitchTracker на всё приложение.

import { PitchTracker } from './PitchTracker';

let ctx: AudioContext | null = null;
let tracker: PitchTracker | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  return ctx;
}

export function getTracker(): PitchTracker {
  if (!tracker) tracker = new PitchTracker(getAudioContext());
  return tracker;
}

/** Запустить микрофон (запросит разрешение при первом вызове). */
export async function ensureMic(deviceId?: string | null): Promise<PitchTracker> {
  const t = getTracker();
  await getAudioContext().resume();
  await t.start(deviceId);
  return t;
}

export function stopMic(): void {
  tracker?.stop();
}
