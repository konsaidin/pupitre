// Игровой движок: мастер-часы (AudioContext), аккомпанемент, приём голоса,
// скоринг в реальном времени, пауза/резюм, итог.

import type { AnalysisFrame } from '../audio/AudioInput';
import type { Transport } from '../audio/transport/Transport';
import { WebAudioTransport } from '../audio/transport/WebAudioTransport';
import type { SongMap, Difficulty } from '../lib/songMap';
import { notePoints, type GameSummary, type NoteResult, type Judgement } from './scoring';
import type { FrameSource, JudgeHost, NoteJudge, VerdictKind } from './judge';
import { VocalJudge } from './judges/vocalJudge';
export type { TrailPoint } from './judges/vocalJudge';

/** waiting — ожидание ноты в режиме обучения гитары (wait/proceed): часы стоят, минус молчит, меню паузы не открыто. */
export type GamePhase = 'idle' | 'countdown' | 'playing' | 'paused' | 'waiting' | 'finished';

export interface JudgementEvent {
  noteIndex: number;
  judgement: Judgement;
  points: number;
  atMs: number;
  kind?: VerdictKind;
  offsetMs?: number;
  detail?: string;
}

export interface EngineOptions<M extends SongMap = SongMap, F = AnalysisFrame> {
  ctx: AudioContext;
  input: FrameSource<F>;
  map: M;
  difficulty: Difficulty;
  latencyMs: number;
  guideNotes: boolean;
  metronome: boolean;
  backingBuffer?: AudioBuffer;
  transport?: Transport;
  judge?: (host: JudgeHost<M>) => NoteJudge<M, F>;
  onLoopWrap?: (snapshot: { results: (NoteResult | null)[]; forced: number }) => void;
  /**
   * Режим «петь по линии»: целью при матчинге служит контур map.pitchline,
   * а map.notes — виртуальные фразы (см. contourSegments) для комбо/вердиктов.
   */
  lineTarget?: boolean;
  onFinish: (summary: GameSummary) => void;
}

const COUNTDOWN_SEC = 3;
const SEEK_LEAD_SEC = 0.8; // короткий разгон после перемотки вместо полного отсчёта

export class GameEngine<M extends SongMap = SongMap, F = AnalysisFrame> {
  readonly map: M;
  phase: GamePhase = 'idle';
  score = 0;
  combo = 0;
  maxCombo = 0;
  judgements: JudgementEvent[] = [];
  results: (NoteResult | null)[];
  get trail() { return (this.judge as unknown as VocalJudge).trail; }
  get lastFrame() { return (this.judge as unknown as VocalJudge).lastFrame; }
  get lastAnalysis() { return (this.judge as unknown as VocalJudge).lastAnalysis; }
  get techStats() { return (this.judge as unknown as VocalJudge).techStats; }
  /** A/B-луп фразы: при достижении loopB песня мотается на loopA (см. tick) */
  loopA: number | null = null;
  loopB: number | null = null;
  private contentEndMs?: number;

  private opts: EngineOptions<M, F>;
  private transport: Transport;
  private fromMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private pausedAtMs = 0;
  private closed: boolean[];
  private judge: NoteJudge<M, F>;
  private unsubscribe: (() => void) | null = null;
  private finished = false;

  constructor(opts: EngineOptions<M, F>) {
    this.opts = opts;
    this.map = opts.map;
    this.transport = opts.transport ?? new WebAudioTransport(opts.ctx);
    // Внешний транспорт уже загружен фабрикой сессии (слои, сетка долей).
    if (!opts.transport) this.transport.load({
      durationMs: this.map.durationMs, layers: [], bpm: this.map.bpm,
      guideEvents: this.map.guideEvents ?? this.map.notes, guideNotes: opts.guideNotes,
      metronome: opts.metronome, countIn: false,
      legacyBacking: this.map.backing, backingBuffer: opts.backingBuffer,
    });
    this.judge = opts.judge ? opts.judge(opts) : new VocalJudge(opts) as unknown as NoteJudge<M, F>;
    this.closed = opts.map.notes.map(() => false);
    this.results = opts.map.notes.map(() => null);
  }

  get ctxNow(): number {
    return this.transport.clockNow();
  }

  /** Текущее время песни в мс (отрицательное во время отсчёта). */
  songMs(): number {
    if (this.phase === 'paused' || this.phase === 'idle' || this.phase === 'waiting') return this.pausedAtMs;
    if (this.phase === 'finished') return this.map.durationMs;
    return this.transport.songMs();
  }

  countdownRemaining(): number {
    return this.phase === 'countdown' ? this.transport.countdownRemaining() : 0;
  }

  /** Накопленная доля попадания по ноте (для заливки прогресса на ролле). */
  noteHitRatio(index: number): number {
    return this.judge.progress(index);
  }

  async start(): Promise<void> {
    if (this.phase !== 'idle') return;
    await this.opts.ctx.resume();
    if (this.phase !== 'idle') return;
    this.beginAt(0);
  }

  pause(): void {
    if (this.phase === 'waiting') {
      this.phase = 'paused';
      return;
    }
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    this.pausedAtMs = Math.max(this.fromMs, this.songMs());
    this.phase = 'paused';
    this.transport.halt();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopClock();
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.beginAt(this.pausedAtMs);
  }

  /**
   * Ожидание ноты (режим обучения): часы песни встают на atMs, минус и метроном молчат, кадры входа судье не идут —
   * сыграно ли, решает вызывающий (и отмечает в своём судье). Только из «играет».
   */
  wait(atMs: number): void {
    if (this.phase !== 'playing') return;
    this.pausedAtMs = Math.max(this.fromMs, atMs);
    this.phase = 'waiting';
    this.transport.halt();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopClock();
  }

  /** Продолжить после ожидания с той же точки — без отсчёта, с коротким разгоном расписания минуса. */
  proceed(leadSec = 0.05): void {
    if (this.phase !== 'waiting') return;
    this.beginAt(this.pausedAtMs, leadSec);
  }

  /**
   * Перемотка. Ноты впереди новой позиции переигрываются заново, не начатые
   * позади — помечаются «пропущено» (results[i] = null, в итог не попадают).
   * Счёт пересобирается из оставшихся вердиктов, комбо сбрасывается.
   */
  seekTo(ms: number): void {
    if (this.phase === 'finished' || this.phase === 'idle') return;
    const target = Math.max(0, Math.min(ms, this.map.durationMs - 1));
    const wasPlaying = this.phase === 'playing' || this.phase === 'countdown' || this.phase === 'waiting';
    if (wasPlaying) {
      this.transport.halt();
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
    const notes = this.map.notes;
    for (let i = 0; i < notes.length; i++) {
      const skipped = this.judge.reset(i, target) === 'skipped';
      if (!skipped || !this.closed[i]) this.results[i] = null;
      this.closed[i] = skipped;
    }
    this.judgements = this.judgements.filter((j) => j.atMs <= target);
    this.judge.onSeek?.(target);
    this.combo = 0;
    this.score = this.results.reduce((s, r) => s + (r?.points ?? 0), 0);
    this.pausedAtMs = target;
    if (wasPlaying) this.beginAt(target, SEEK_LEAD_SEC);
    // на паузе остаёмся на паузе: ролл перерисуется от pausedAtMs
  }

  quit(): void {
    this.phase = 'finished';
    this.finished = true;
    this.transport.halt();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopClock();
  }

  /**
   * A/B-луп для отработки фразы. a=null выключает; b подтягивается в границы
   * песни, вырожденный интервал (< 200 мс) игнорируется.
   */
  setLoop(a: number | null, b: number | null, opts?: { contentEndMs?: number }): void {
    if (a === null || b === null) {
      this.contentEndMs = undefined;
      this.loopA = null;
      this.loopB = null;
      this.rescheduleBacking();
      return;
    }
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(this.map.durationMs, Math.max(a, b));
    if (hi - lo < 200) return;
    this.contentEndMs = opts?.contentEndMs;
    this.loopA = lo;
    this.loopB = hi;
    this.rescheduleBacking();
  }

  /** Часы движка независимы от Canvas/rAF; также вызываются на аудиокадрах. */
  tick(): void {
    if (this.phase === 'countdown' && this.transport.countdownRemaining() === 0) this.phase = 'playing';
    if (this.phase !== 'playing') return;
    const ms = this.songMs();
    if (this.loopA !== null && this.loopB !== null && ms >= this.loopB) {
      const forced = this.contentEndMs === undefined ? 0 : this.finalizePassed(ms, this.contentEndMs);
      this.opts.onLoopWrap?.({ results: this.results.slice(), forced });
      this.seekTo(this.loopA);
      return;
    }
    this.finalizePassed(ms - Math.max(0, this.opts.latencyMs));
    this.judge.onTick?.(ms, this.generation);
    if (ms >= this.map.durationMs + Math.max(300, this.opts.latencyMs + 100)) this.finish();
  }

  private stopClock(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private rescheduleBacking(): void {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    this.generation++;
    this.transport.reschedule(Math.max(this.fromMs, this.songMs()), this.loopB ?? this.map.durationMs);
  }

  private beginAt(fromMs: number, leadSec: number = COUNTDOWN_SEC): void {
    this.fromMs = fromMs;
    this.generation++;
    this.phase = 'countdown';
    this.judge.onBegin(fromMs);
    this.transport.begin(fromMs, leadSec, this.loopB ?? this.map.durationMs);
    this.unsubscribe = this.opts.input.onFrame((f) => this.onPitchFrame(f));
    this.stopClock();
    this.timer = setInterval(() => this.tick(), 20);
  }

  private onPitchFrame(f: F): void {
    const generation = this.generation;
    this.tick();
    if (generation !== this.generation) return;
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    this.judge.onRawFrame?.(f);
    // компенсация задержки тракта: голос "звучал" чуть раньше, чем дошёл до нас
    const songMs = this.transport.frameToSongMs(this.judge.frameTime(f), this.opts.latencyMs);
    if (songMs < this.fromMs || songMs >= this.map.durationMs || !Number.isFinite(songMs)) return;

    this.judge.onFrame(f, songMs);
  }

  private finalizePassed(songMs: number, contentEndMs?: number): number {
    const forced = contentEndMs !== undefined;
    const due: number[] = [];
    for (let i = 0; i < this.map.notes.length; i++) {
      if (forced ? this.map.notes[i].startMs >= contentEndMs : this.judge.closeAtMs(i) > songMs) {
        if (!forced && this.judge.finalizeOrder === 'sequential') break;
        continue;
      }
      if (!this.closed[i]) due.push(i);
    }
    if (this.judge.finalizeOrder === 'any') due.sort((a, b) => this.judge.closeAtMs(a) - this.judge.closeAtMs(b));
    for (const i of due) this.finalize(i, songMs, forced);
    return due.length;
  }

  private finalize(i: number, songMs: number, forced?: boolean): void {
    this.closed[i] = true;
    const { judgement: j, hitRatio, points: ownPoints, ...detail } = this.judge.finalize(i, forced);
    if (detail.kind === 'skipped') return;
    if (j === 'miss') this.combo = 0;
    else this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const points = ownPoints ?? notePoints(hitRatio, this.combo);
    this.score += points;
    this.results[i] = { note: this.map.notes[i], hitRatio, judgement: j, points };
    this.judgements.push({ noteIndex: i, judgement: j, points, atMs: songMs, ...detail });
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    // финализируем всё, что осталось
    this.finalizePassed(Number.MAX_SAFE_INTEGER);
    this.phase = 'finished';
    this.transport.halt();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopClock();
    const results = this.results.filter((r): r is NoteResult => r !== null);
    this.opts.onFinish(this.judge.summarize(results, this.score, this.maxCombo));
  }
}
