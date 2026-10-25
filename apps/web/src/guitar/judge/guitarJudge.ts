// Гитарный судья (M2, первая версия): кадры входа — атаки и высота — сопоставляются с событиями партии по времени того,
// что игрок слышал (часы транспорта; перевод из времени звука — toClock сессии игры), и по высоте.
// - удар (attack): первая атака в окне [−early, +late] × windowScale от начала события; высота — медиана кадров
//   20–150 мс после атаки; совпала (с точностью до октавы — YIN у гитары путает октаву, у бенда — вверх до 2.6 полутона)
//   — попадание, не совпала — «не та нота», высоты нет (приглушённый удар, аккорд) — засчитан с долей 0.7;
// - удар не пойман (перебор: новая нота звучит поверх прошлой, огибающая почти не растёт), но высота в окне сменилась на
//   нужную (3 кадра подряд, ≈ 16 мс; кадр перед ними — другая высота или её нет) — засчитан с долей 0.9 по моменту смены;
// - аккорд: удар и хотя бы один звук аккорда (одна высота YIN — обычно бас или корень), высоты нет — засчитан;
// - легато (хаммер, пулл): атаки может не быть — достаточно смены высоты на нужную в окне;
// - только атака (глушёный «чк»): удар в окне; лига и «не оценивается» — пропуск.
// Точность — доля по числу событий (у вокального судьи — по длительности нот).
import type { InputFrame } from '../../audio/instrument/session';
import type { JudgeHost, JudgeVerdict, NoteJudge, VerdictKind } from '../../game/judge';
import { starsFor, type GameSummary, type NoteResult } from '../../game/scoring';
import type { Strictness, TabEvent, TabMap } from '../model/types';

/** Кадр входа (audio/instrument/session): атака или высота, время звука на часах страницы. */
export type GuitarFrame = InputFrame;

/** Отклик дорожке: none — событие снова ждёт (перемотка), attacked — удар замечен до вердикта. */
export type GuitarStatus = 'none' | 'attacked' | VerdictKind;

export interface GuitarJudgeOptions {
  /** Время звука (perf, мс) → часы транспорта (секунды контекста) того, что игрок слышал в этот момент. */
  toClock(atMs: number): number;
  a4Hz: number;
  strictness: Strictness;
  /**
   * Сколько ещё ждать кадров события после его окна: движок закрывает события по времени расписания минуса, а кадры —
   * во времени того, что слышно (позже на задержку вывода), и приходят с задержкой анализа и доставки.
   */
  finalizeDelayMs?: number;
  /** Отклик дорожке: событие атаковано (до вердикта), вердикт, снова ждёт после перемотки. */
  onStatus?(event: number, status: GuitarStatus): void;
}

/** Окна по строгости, мс: раньше начала, позже начала, «точно» (±). */
const WINDOWS: Record<Strictness, { early: number; late: number; perfect: number }> = {
  soft: { early: 150, late: 200, perfect: 60 },
  normal: { early: 110, late: 150, perfect: 45 },
  strict: { early: 80, late: 100, perfect: 30 },
};
/** Высота после атаки: окно сбора кадров, мс. */
const PITCH_FROM = 20;
const PITCH_TO = 150;
const MIN_CLARITY = 0.5;
const PITCH_TOL = 0.6;
/** Смена высоты как атака: кадров подряд с нужной высотой. */
const PITCH_RUN = 3;

interface State {
  attackMs: number;
  pitches: number[];
  legatoMs: number;
  /** Серия кадров с нужной высотой: длина, время первого кадра, была ли перед ней другая высота. */
  run: number;
  runFrom: number;
  runAfterOther: boolean;
  /** Момент смены высоты на нужную (вместо непойманной атаки). */
  pitchOnsetMs: number;
}

const fresh = (): State => ({ attackMs: NaN, pitches: [], legatoMs: NaN, run: 0, runFrom: NaN, runAfterOther: false, pitchOnsetMs: NaN });

/** Разница высот, сведённая в октаву [−6, 6). */
export function foldSemitones(diff: number): number {
  return diff - 12 * Math.round(diff / 12);
}

/** Совпадает ли высота с одной из ожидаемых (до октавы; у бенда — до 2.6 полутона вверх). */
export function pitchMatches(midi: number, expected: number[], bend: boolean): boolean {
  return expected.some((m) => {
    const d = foldSemitones(midi - m);
    return Math.abs(d) <= PITCH_TOL || (bend && d > 0 && d <= 2 + PITCH_TOL);
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : NaN;
}

export function guitarSummary(results: NoteResult[], score: number, maxCombo: number): GameSummary {
  let perfect = 0;
  let good = 0;
  let miss = 0;
  let ratio = 0;
  for (const r of results) {
    ratio += r.hitRatio;
    if (r.judgement === 'perfect') perfect++;
    else if (r.judgement === 'good') good++;
    else miss++;
  }
  const accuracy = results.length ? ratio / results.length : 0;
  return { score, accuracy, stars: starsFor(accuracy), perfect, good, miss, maxCombo, results, tech: { vibratoMs: 0, distortionMs: 0 } };
}

export function guitarJudge(host: JudgeHost<TabMap>, options: GuitarJudgeOptions): NoteJudge<TabMap, GuitarFrame> {
  const events = host.map.notes;
  const win = WINDOWS[options.strictness];
  // поправка эталона: YIN считает от A4 = 440
  const tune = 12 * Math.log2(options.a4Hz / 440);
  const states: State[] = events.map(fresh);
  const expected = events.map((e) => e.notes.map((n) => n.midi));
  const bends = events.map((e) => e.notes.some((n) => n.techs.includes('bend') || n.techs.includes('prebend')));
  const early = (e: TabEvent) => win.early * e.windowScale;
  const late = (e: TabEvent) => win.late * e.windowScale;
  const judged = (e: TabEvent) => e.judge !== 'none' && e.judge !== 'tie';
  /** Первое событие, которое ещё может получить кадр (атаку или высоту после атаки); события — по startMs. */
  let cursor = 0;

  const firstOpen = (ms: number) => {
    // курсор только растёт во время игры (кадры приходят по порядку); перемотка сбрасывает его в onBegin
    while (cursor < events.length && events[cursor].startMs + late(events[cursor]) + PITCH_TO < ms) cursor++;
    return cursor;
  };

  const onset = (ms: number) => {
    let best = -1;
    let bestDist = Infinity;
    for (let i = firstOpen(ms); i < events.length && events[i].startMs - early(events[i]) <= ms; i++) {
      const e = events[i];
      if (!judged(e) || !Number.isNaN(states[i].attackMs)) continue;
      if (ms < e.startMs - early(e) || ms > e.startMs + late(e)) continue;
      const dist = Math.abs(ms - e.startMs);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    if (best < 0) return;
    states[best].attackMs = ms;
    states[best].pitches = [];
    options.onStatus?.(best, 'attacked');
  };

  /** Высота прошлого кадра (NaN — её не было): «другая высота перед серией». */
  let lastPitch = NaN;

  const pitch = (ms: number, midi: number) => {
    const previous = lastPitch;
    lastPitch = midi;
    for (let i = firstOpen(ms); i < events.length && events[i].startMs - early(events[i]) <= ms; i++) {
      const s = states[i];
      const e = events[i];
      if (!Number.isNaN(s.attackMs) && ms >= s.attackMs + PITCH_FROM && ms <= s.attackMs + PITCH_TO) s.pitches.push(midi);
      // смена высоты на нужную — атака, если удар не пойман
      if (e.judge === 'attack' && Number.isNaN(s.attackMs) && Number.isNaN(s.pitchOnsetMs)) {
        if (Number.isFinite(midi) && pitchMatches(midi, expected[i], bends[i])) {
          if (s.run === 0) {
            s.runFrom = ms;
            s.runAfterOther = Number.isNaN(previous) || !pitchMatches(previous, expected[i], bends[i]);
          }
          s.run++;
          if (s.run >= PITCH_RUN && s.runAfterOther && s.runFrom >= e.startMs - early(e) && s.runFrom <= e.startMs + late(e)) {
            s.pitchOnsetMs = s.runFrom;
            options.onStatus?.(i, 'attacked');
          }
        } else s.run = 0;
      }
      // легато: смена высоты на нужную в окне, атаки может не быть
      if (e.judge === 'legato' && Number.isNaN(s.legatoMs) && ms >= e.startMs - early(e) && ms <= e.startMs + late(e) + PITCH_TO &&
          pitchMatches(midi, expected[i], bends[i])) s.legatoMs = ms;
    }
  };

  const verdict = (i: number): JudgeVerdict => {
    const e = events[i];
    const s = states[i];
    if (!judged(e)) return { judgement: 'miss', hitRatio: 0, points: 0, kind: 'skipped' };
    const timed = (at: number, ratio: number): JudgeVerdict => {
      const offsetMs = at - e.startMs;
      const exact = Math.abs(offsetMs) <= win.perfect;
      return {
        judgement: exact && ratio === 1 ? 'perfect' : 'good',
        hitRatio: exact ? ratio : Math.min(ratio, 0.8),
        kind: exact ? 'hit' : offsetMs < 0 ? 'early' : 'late',
        offsetMs,
      };
    };
    if (e.judge === 'legato' && !Number.isNaN(s.legatoMs)) return timed(Number.isNaN(s.attackMs) ? e.startMs : s.attackMs, 1);
    if (Number.isNaN(s.attackMs)) {
      if (!Number.isNaN(s.pitchOnsetMs)) return timed(s.pitchOnsetMs, 0.9);
      return { judgement: 'miss', hitRatio: 0, kind: 'missed' };
    }
    if (e.judge === 'onsetOnly') return timed(s.attackMs, 1);
    const heard = median(s.pitches);
    if (Number.isNaN(heard)) return timed(s.attackMs, 0.7);
    if (pitchMatches(heard, expected[i], bends[i])) return timed(s.attackMs, 1);
    return { judgement: 'miss', hitRatio: 0, kind: 'wrong', offsetMs: s.attackMs - e.startMs, heardMidi: heard };
  };

  return {
    map: host.map,
    finalizeOrder: 'any',
    onBegin() {
      cursor = 0;
      lastPitch = NaN;
    },
    reset(i, fromMs) {
      states[i] = fresh();
      if (events[i].startMs < fromMs) return 'skipped';
      options.onStatus?.(i, 'none');
      return 'armed';
    },
    onFrame(f, songMs) {
      if (f.onset) onset(songMs);
      else pitch(songMs, Number.isFinite(f.midi) && f.clarity >= MIN_CLARITY ? f.midi - tune : NaN);
    },
    closeAtMs: (i) => events[i].startMs + late(events[i]) + PITCH_TO + 50 + (options.finalizeDelayMs ?? 0),
    finalize(i) {
      const v = verdict(i);
      if (v.kind) options.onStatus?.(i, v.kind);
      return v;
    },
    progress: (i) => (Number.isNaN(states[i].attackMs) ? 0 : 1),
    frameTime: (f) => options.toClock(f.atMs),
    summarize: guitarSummary,
  };
}
