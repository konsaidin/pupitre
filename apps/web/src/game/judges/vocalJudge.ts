// Вокальное судейство: накопление времени попадания и след голоса.
import type { AnalysisFrame } from '../../audio/AudioInput';
import { contourMidiAt } from '../../lib/pitchline';
import type { SongMap } from '../../lib/songMap';
import type { JudgeHost, NoteJudge, JudgeVerdict } from '../judge';
import { matchPitch, judge, scoringDuration, summarize, type NoteResult, type TechStats } from '../scoring';

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

interface NoteState {
  inTolMs: number;
  lastFrameT: number | null;
  finalized: boolean;
}

const MAX_FRAME_DT_MS = 40;

export class VocalJudge implements NoteJudge<SongMap, AnalysisFrame> {
  readonly finalizeOrder = 'sequential';
  readonly map: SongMap;
  trail: TrailPoint[] = [];
  lastFrame: { songMs: number; midi: number; voiced: boolean; cents: number | null } | null = null;
  lastAnalysis: AnalysisFrame | null = null;
  readonly techStats: TechStats = { vibratoMs: 0, distortionMs: 0 };
  private noteStates: NoteState[];
  private lastVoicedT: number | null = null;
  private fromMs = 0;

  constructor(private opts: JudgeHost<SongMap>) {
    this.map = opts.map;
    this.noteStates = this.map.notes.map(() => ({ inTolMs: 0, lastFrameT: null, finalized: false }));
  }

  onBegin(fromMs: number): void {
    this.fromMs = fromMs;
    // после паузы/перемотки кадры шли мимо нас — шаг статистики техник заново
    this.lastVoicedT = null;
    for (const state of this.noteStates) state.lastFrameT = null;
  }

  onSeek(fromMs: number): void {
    this.trail = this.trail.filter((p) => p.songMs <= fromMs);
  }

  reset(i: number, fromMs: number): 'armed' | 'skipped' {
    const n = this.map.notes[i];
    const st = this.noteStates[i];
    if (n.startMs + n.durMs <= fromMs) {
      st.finalized = true;
      return 'skipped';
    }
    st.finalized = false;
    st.inTolMs = 0;
    st.lastFrameT = null;
    return 'armed';
  }

  progress(index: number): number {
    const st = this.noteStates[index];
    const n = this.map.notes[index];
    const duration = n ? scoringDuration(n) : 0;
    return st && duration > 0 ? Math.min(1, st.inTolMs / duration) : 0;
  }

  frameTime(f: AnalysisFrame): number { return f.t; }

  onRawFrame(f: AnalysisFrame): void { this.lastAnalysis = f; }

  onFrame(f: AnalysisFrame, songMs: number): void {
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
      this.lastVoicedT !== null ? Math.max(0, Math.min((f.t - this.lastVoicedT) * 1000, MAX_FRAME_DT_MS)) : 0;
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
        const elapsed = st.lastFrameT !== null ? Math.max(0, Math.min((f.t - st.lastFrameT) * 1000, MAX_FRAME_DT_MS)) : 0;
        const scoringStart = note.startMs + (note.tech ? note.techWarmupMs ?? 0 : 0);
        const dt = Math.max(0, Math.min(elapsed, songMs - Math.max(scoringStart, this.fromMs)));
        st.lastFrameT = f.t;
        if (inTol && !st.finalized) st.inTolMs += dt;
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

  closeAtMs(i: number): number {
    const n = this.map.notes[i];
    return n.startMs + n.durMs + 50;
  }

  finalize(i: number, forced?: boolean): JudgeVerdict {
    const st = this.noteStates[i];
    st.finalized = true;
    const hitRatio = this.progress(i);
    const j = judge(hitRatio);
    const verdict: JudgeVerdict = { judgement: j, hitRatio, points: j === 'miss' ? 0 : undefined };
    if (forced && st.inTolMs === 0) {
      verdict.kind = 'missed';
      verdict.detail = 'late-evidence';
    }
    return verdict;
  }

  summarize(results: NoteResult[], score: number, maxCombo: number) {
    return summarize(results, score, maxCombo, this.techStats);
  }
}
