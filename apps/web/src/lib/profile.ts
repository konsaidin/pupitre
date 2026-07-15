// Профиль пользователя в localStorage: диапазон голоса, настройки, результаты.

import { DEFAULT_MIC, type MicOptions } from '../audio/AudioInput';
import type { VocalRange } from './music';
import type { Difficulty } from './songMap';

export interface ScoreRecord {
  /** id песни/упражнения */
  mapId: string;
  title: string;
  score: number;
  accuracy: number; // 0..1
  stars: 0 | 1 | 2 | 3;
  difficulty: Difficulty;
  playedAt: number; // Date.now()
}

export interface Profile {
  range: VocalRange | null;
  difficulty: Difficulty;
  /** задержка вывода звука в мс, вычитается из времени голоса при скоринге */
  latencyMs: number;
  micDeviceId: string | null;
  /** браузерная обработка микрофона + нойзгейт детектора */
  micNoiseSuppression: boolean;
  micEchoCancellation: boolean;
  micAutoGain: boolean;
  micGateRms: number;
  micGateClarity: number;
  guideNotes: boolean;
  metronome: boolean;
  headphonesWarned: boolean;
  /** главный вид игры: лента вокала (курс 2) или классический пиано-ролл */
  vocalView: 'ribbon' | 'roll';
  scores: ScoreRecord[];
}

const KEY = 'slopsician.profile.v1';

const DEFAULTS: Profile = {
  range: null,
  difficulty: 'beginner',
  latencyMs: 0,
  micDeviceId: null,
  micNoiseSuppression: DEFAULT_MIC.noiseSuppression,
  micEchoCancellation: DEFAULT_MIC.echoCancellation,
  micAutoGain: DEFAULT_MIC.autoGain,
  micGateRms: DEFAULT_MIC.gateRms,
  micGateClarity: DEFAULT_MIC.gateClarity,
  guideNotes: true,
  metronome: true,
  headphonesWarned: false,
  vocalView: 'ribbon',
  scores: [],
};

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function addScore(p: Profile, rec: ScoreRecord): Profile {
  const scores = [rec, ...p.scores].slice(0, 500);
  const next = { ...p, scores };
  saveProfile(next);
  return next;
}

/** Настройки микрофона из профиля — для AudioInput.start. */
export function micOptions(p: Profile): MicOptions {
  return {
    noiseSuppression: p.micNoiseSuppression,
    echoCancellation: p.micEchoCancellation,
    autoGain: p.micAutoGain,
    gateRms: p.micGateRms,
    gateClarity: p.micGateClarity,
  };
}

export function bestScore(p: Profile, mapId: string): ScoreRecord | null {
  let best: ScoreRecord | null = null;
  for (const s of p.scores) {
    if (s.mapId === mapId && (!best || s.score > best.score)) best = s;
  }
  return best;
}
