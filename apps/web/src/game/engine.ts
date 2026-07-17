// Игровой движок: мастер-часы (AudioContext), аккомпанемент, приём голоса,
// скоринг в реальном времени, пауза/резюм, итог.

import type { AnalysisFrame, AudioInput } from '../audio/AudioInput';
import { Synth } from '../audio/synth';
import { contourMidiAt } from '../lib/pitchline';
import type { SongMap, Difficulty } from '../lib/songMap';
import {
  matchPitch,
  judge,
  notePoints,
  summarize,
  type GameSummary,
  type NoteResult,
  type Judgement,
  type TechStats,
} from './scoring';

export type GamePhase = 'idle' | 'countdown' | 'playing' | 'paused' | 'finished';

export interface TrailPoint {
  songMs: number;
  /** дробный midi для отрисовки — ровно то, что спел голос, без октавных поправок */
  midi: number;
  inTolerance: boolean;
  /** сырой midi минус сглаженный: волнистость ленты (вибрато/шероховатость) */
  rawOffset: number;
  /** громкость, dBFS — толщина ленты */
  loudDb: number;
  /** вибрато активно в этом кадре */
  vibrato: boolean;
  /** score расщепления 0..1 — рваная текстура ленты */
  distortion: number;
}

export interface JudgementEvent {
  noteIndex: number;
  judgement: Judgement;
  points: number;
  atMs: number;
}

interface NoteState {
  inTolMs: number;
  lastFrameT: number | null;
  finalized: boolean;
}

export interface EngineOptions {
  ctx: AudioContext;
  input: AudioInput;
  map: SongMap;
  difficulty: Difficulty;
  latencyMs: number;
  guideNotes: boolean;
  metronome: boolean;
  backingBuffer?: AudioBuffer;
  /**
   * Режим «петь по линии»: целью при матчинге служит контур map.pitchline,
   * а map.notes — виртуальные фразы (см. contourSegments) для комбо/вердиктов.
   */
  lineTarget?: boolean;
  onFinish: (summary: GameSummary) => void;
}

const COUNTDOWN_SEC = 3;
const SEEK_LEAD_SEC = 0.8; // короткий разгон после перемотки вместо полного отсчёта
const MAX_FRAME_DT_MS = 40;

export class GameEngine {
  readonly map: SongMap;
  phase: GamePhase = 'idle';
  score = 0;
  combo = 0;
  maxCombo = 0;
  trail: TrailPoint[] = [];
  judgements: JudgementEvent[] = [];
  results: (NoteResult | null)[];
  /** последний голосовой кадр для HUD/индикаторов */
  lastFrame: { songMs: number; midi: number; voiced: boolean; cents: number | null } | null = null;
  /** последний полный кадр анализа — техники для бейджей ленты */
  lastAnalysis: AnalysisFrame | null = null;
  /** A/B-луп фразы: при достижении loopB песня мотается на loopA (см. tick) */
  loopA: number | null = null;
  loopB: number | null = null;
  /** суммарное время техник за игру (в итоги) */
  readonly techStats: TechStats = { vibratoMs: 0, distortionMs: 0 };

  private opts: EngineOptions;
  private synth: Synth;
  private backingSource: AudioBufferSourceNode | null = null;
  private startCtxTime = 0; // ctx-время, соответствующее songMs = 0
  private pausedAtMs = 0;
  private noteStates: NoteState[];
  private unsubscribe: (() => void) | null = null;
  private finished = false;
  /** t предыдущего голосового кадра — шаг времени для статистики техник */
  private lastVoicedT: number | null = null;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.map = opts.map;
    this.synth = new Synth(opts.ctx, 0.5);
    this.noteStates = opts.map.notes.map(() => ({ inTolMs: 0, lastFrameT: null, finalized: false }));
    this.results = opts.map.notes.map(() => null);
  }

  get ctxNow(): number {
    return this.opts.ctx.currentTime;
  }

  /** Текущее время песни в мс (отрицательное во время отсчёта). */
  songMs(): number {
    if (this.phase === 'paused' || this.phase === 'idle') return this.pausedAtMs;
    if (this.phase === 'finished') return this.map.durationMs;
    return (this.ctxNow - this.startCtxTime) * 1000;
  }

  countdownRemaining(): number {
    return Math.max(0, -this.songMs() / 1000);
  }

  /** Накопленная доля попадания по ноте (для заливки прогресса на ролле). */
  noteHitRatio(index: number): number {
    const st = this.noteStates[index];
    const n = this.map.notes[index];
    return st && n ? Math.min(1, st.inTolMs / n.durMs) : 0;
  }

  async start(): Promise<void> {
    if (this.phase !== 'idle') return;
    await this.opts.ctx.resume();
    this.beginAt(0);
  }

  pause(): void {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    this.pausedAtMs = Math.max(0, this.songMs());
    this.phase = 'paused';
    this.synth.cancelAll();
    this.stopBacking();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.beginAt(this.pausedAtMs);
  }

  /**
   * Перемотка. Ноты впереди новой позиции переигрываются заново, не начатые
   * позади — помечаются «пропущено» (results[i] = null, в итог не попадают).
   * Счёт пересобирается из оставшихся вердиктов, комбо сбрасывается.
   */
  seekTo(ms: number): void {
    if (this.phase === 'finished' || this.phase === 'idle') return;
    const target = Math.max(0, Math.min(ms, this.map.durationMs - 1));
    const wasPlaying = this.phase === 'playing' || this.phase === 'countdown';
    if (wasPlaying) {
      this.synth.cancelAll();
      this.stopBacking();
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
    const notes = this.map.notes;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const st = this.noteStates[i];
      if (n.startMs + n.durMs <= target) {
        if (!st.finalized) {
          st.finalized = true; // прощёлкнута перемоткой вперёд — не судим
          this.results[i] = null;
        }
      } else {
        st.finalized = false;
        st.inTolMs = 0;
        st.lastFrameT = null;
        this.results[i] = null;
      }
    }
    this.judgements = this.judgements.filter((j) => j.atMs <= target);
    this.trail = this.trail.filter((p) => p.songMs <= target);
    this.combo = 0;
    this.score = this.results.reduce((s, r) => s + (r?.points ?? 0), 0);
    this.pausedAtMs = target;
    if (wasPlaying) this.beginAt(target, SEEK_LEAD_SEC);
    // на паузе остаёмся на паузе: ролл перерисуется от pausedAtMs
  }

  quit(): void {
    this.phase = 'finished';
    this.finished = true;
    this.synth.cancelAll();
    this.stopBacking();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * A/B-луп для отработки фразы. a=null выключает; b подтягивается в границы
   * песни, вырожденный интервал (< 200 мс) игнорируется.
   */
  setLoop(a: number | null, b: number | null): void {
    if (a === null || b === null) {
      this.loopA = null;
      this.loopB = null;
      return;
    }
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(this.map.durationMs, Math.max(a, b));
    if (hi - lo < 200) return;
    this.loopA = lo;
    this.loopB = hi;
  }

  /** Вызывать каждый кадр рендера: двигает фазы и финализирует ноты. */
  tick(): void {
    if (this.phase === 'countdown' && this.songMs() >= 0) this.phase = 'playing';
    if (this.phase !== 'playing') return;
    const ms = this.songMs();
    if (this.loopA !== null && this.loopB !== null && ms >= this.loopB) {
      this.seekTo(this.loopA);
      return;
    }
    this.finalizePassed(ms);
    if (ms >= this.map.durationMs + 300) this.finish();
  }

  private beginAt(fromMs: number, leadSec: number = COUNTDOWN_SEC): void {
    const ctx = this.opts.ctx;
    this.startCtxTime = ctx.currentTime + leadSec - fromMs / 1000;
    this.phase = 'countdown';
    // после паузы/перемотки кадры шли мимо нас — шаг статистики техник заново
    this.lastVoicedT = null;
    this.scheduleBacking(fromMs);
    this.unsubscribe = this.opts.input.onFrame((f) => this.onPitchFrame(f));
  }

  private scheduleBacking(fromMs: number): void {
    const { map, ctx, guideNotes, metronome, backingBuffer } = this.opts;
    const startAt = this.startCtxTime; // ctx-время songMs=0
    if (map.backing.kind === 'url' && backingBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = backingBuffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      src.connect(gain).connect(ctx.destination);
      if (fromMs <= 0) src.start(startAt, 0);
      else src.start(startAt + fromMs / 1000, fromMs / 1000);
      this.backingSource = src;
    }
    if (map.backing.kind === 'synth') {
      if (guideNotes) {
        for (const n of map.guideEvents ?? map.notes) {
          if (n.startMs + n.durMs <= fromMs) continue;
          const t = startAt + Math.max(n.startMs, fromMs) / 1000;
          const dur = (n.startMs + n.durMs - Math.max(n.startMs, fromMs)) / 1000;
          this.synth.playNote(n.midi, Math.max(t, ctx.currentTime + 0.02), dur, 0.7);
        }
      }
      if (metronome && map.bpm) {
        const beatMs = 60000 / map.bpm;
        const firstBeat = Math.ceil(fromMs / beatMs);
        for (let b = firstBeat; b * beatMs < this.map.durationMs; b++) {
          this.synth.playClick(startAt + (b * beatMs) / 1000, b % 4 === 0);
        }
      }
    }
  }

  private stopBacking(): void {
    try {
      this.backingSource?.stop();
    } catch {
      // не стартовал
    }
    this.backingSource = null;
  }

  private onPitchFrame(f: AnalysisFrame): void {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    this.lastAnalysis = f;
    // компенсация задержки тракта: голос "звучал" чуть раньше, чем дошёл до нас
    const songMs = (f.t - this.startCtxTime) * 1000 - this.opts.latencyMs;
    if (songMs < 0) return;

    const noteIdx = this.findActiveNote(songMs);
    const note = noteIdx >= 0 ? this.map.notes[noteIdx] : null;

    if (!f.voiced) {
      this.lastFrame = { songMs, midi: NaN, voiced: false, cents: null };
      if (note) this.noteStates[noteIdx].lastFrameT = f.t;
      this.lastVoicedT = null;
      return;
    }
    // статистика техник: время с активным вибрато/расщеплением
    const techDt =
      this.lastVoicedT !== null ? Math.min((f.t - this.lastVoicedT) * 1000, MAX_FRAME_DT_MS) : 11;
    this.lastVoicedT = f.t;
    if (f.vibrato.active) this.techStats.vibratoMs += techDt;
    if (f.distortion.active) this.techStats.distortionMs += techDt;

    // в режиме линии цель — дробная высота контура в этот момент, не плашка
    const target = note
      ? this.opts.lineTarget && this.map.pitchline
        ? contourMidiAt(this.map.pitchline, songMs)
        : note.midi
      : null;

    let inTol = false;
    let cents: number | null = null;
    if (note) {
      const st = this.noteStates[noteIdx];
      if (target !== null) {
        const m = matchPitch(f.midi, target, this.opts.difficulty);
        cents = m.cents;
        // нота с требуемой техникой: попадание только пока техника активна —
        // и в счёте времени, и в цвете ленты (обратная связь честная)
        const techOk = note.tech !== 'vibrato' || f.vibrato.active;
        inTol = m.inTolerance && techOk;
        const dt = st.lastFrameT !== null ? Math.min((f.t - st.lastFrameT) * 1000, MAX_FRAME_DT_MS) : 11;
        st.lastFrameT = f.t;
        if (inTol) st.inTolMs += dt;
      } else {
        // разрыв контура внутри фразы: время не считаем ни в плюс, ни в минус
        st.lastFrameT = f.t;
      }
    }
    // Точка рисуется РОВНО там, где голос: никаких октавных поправок
    // отображения. Прощение октавы (beginner/medium) живёт только в скоринге
    // (matchPitch) — глазам всегда правда, телепортов не существует.
    const displayMidi = f.midi;
    this.lastFrame = { songMs, midi: displayMidi, voiced: true, cents };
    // rawOffset — дельта сырого контура к сглаженному: волна вибрато/
    // шероховатость для ленты
    const rawOffset =
      Number.isNaN(f.midiRaw) || Number.isNaN(f.midi) ? 0 : f.midiRaw - f.midi;
    this.trail.push({
      songMs,
      midi: displayMidi,
      inTolerance: inTol,
      rawOffset,
      loudDb: f.loudDb,
      vibrato: f.vibrato.active,
      distortion: f.distortion.score,
    });
  }

  private findActiveNote(songMs: number): number {
    // ноты отсортированы по startMs; линейный проход с небольшим окном
    const notes = this.map.notes;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (songMs >= n.startMs && songMs < n.startMs + n.durMs) return i;
      if (n.startMs > songMs) break;
    }
    return -1;
  }

  private finalizePassed(songMs: number): void {
    const notes = this.map.notes;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.startMs + n.durMs > songMs - 50) break;
      const st = this.noteStates[i];
      if (st.finalized) continue;
      st.finalized = true;
      const hitRatio = Math.min(1, st.inTolMs / n.durMs);
      const j = judge(hitRatio);
      if (j === 'miss') this.combo = 0;
      else this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const points = j === 'miss' ? 0 : notePoints(hitRatio, this.combo);
      this.score += points;
      const result: NoteResult = { note: n, hitRatio, judgement: j, points };
      this.results[i] = result;
      this.judgements.push({ noteIndex: i, judgement: j, points, atMs: songMs });
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    // финализируем всё, что осталось
    this.finalizePassed(Number.MAX_SAFE_INTEGER);
    this.phase = 'finished';
    this.synth.cancelAll();
    this.stopBacking();
    this.unsubscribe?.();
    this.unsubscribe = null;
    const results = this.results.filter((r): r is NoteResult => r !== null);
    this.opts.onFinish(summarize(results, this.score, this.maxCombo, this.techStats));
  }
}
