// Гитарный судья (M2, первая версия): кадры входа — атаки и высота — сопоставляются с событиями партии по времени того,
// что игрок слышал (часы транспорта; перевод из времени звука — toClock сессии игры), и по высоте.
// - удар (attack): первая атака в окне [−early, +late] × windowScale от начала события; высота — медиана кадров
//   20–150 мс после атаки (кадры без высоты не в счёт); совпала (с точностью до октавы — YIN у гитары путает октаву, у
//   бенда — вверх до 2.6 полутона) — попадание; не совпала — «не та нота», но только по устойчивой высоте (≥ PITCH_RUN
//   кадров рядом с медианой: у низких нот и аккордов YIN даёт редкие ложные кадры); высоты нет или она случайная
//   (приглушённый удар, аккорд) — засчитан с долей 0.7;
// - удар не пойман (перебор: новая нота звучит поверх прошлой, огибающая почти не растёт), но высота в окне сменилась на
//   нужную (3 кадра подряд, ≈ 16 мс; кадр перед ними — другая высота или её нет) — засчитан с долей 0.9 по моменту смены;
// - аккорд: удар и звук аккорда — медиана или хотя бы треть кадров (YIN прыгает между звуками), высоты нет — засчитан;
// - легато (хаммер, пулл): атаки может не быть — достаточно смены высоты на нужную в окне;
// - только атака (глушёный «чк»): удар в окне; лига и «не оценивается» — пропуск.
// Точность — доля по числу событий (у вокального судьи — по длительности нот).
// Отклик дорожке — как только вердикт ясен, а не при закрытии события (оно ждёт задержку вывода и доставку кадров,
// ≈ полсекунды после ноты): попадание — по PITCH_RUN кадрам нужной высоты подряд после удара (первые кадры атаки YIN часто
// врёт — ложный низ), аккорд — по удару (его высота ненадёжна), не та нота — по концу окна высоты, промах — когда окно
// удара прошло с тем же запасом на доставку (onTick). Итог для счёта — по-прежнему в finalize; если он разошёлся с ранним
// откликом (поздние кадры), дорожка получает исправленный.
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
  /** Отклик дорожке: событие атаковано (до вердикта), вердикт (с подробностями — смещение, высота), снова ждёт. */
  onStatus?(event: number, status: GuitarStatus, verdict?: JudgeVerdict): void;
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
  /** Что сообщено дорожке (вердикт), кадров нужной высоты подряд после удара, закрыто ли окно высоты. */
  told: GuitarStatus;
  hitRun: number;
  settled: boolean;
}

const fresh = (): State => ({
  attackMs: NaN, pitches: [], legatoMs: NaN, run: 0, runFrom: NaN, runAfterOther: false, pitchOnsetMs: NaN, told: 'none', hitRun: 0, settled: false,
});

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
  /** Первое событие, чей промах ещё не проверен по часам (onTick), и начало игры (раньше — пропуск). */
  let missCursor = 0;
  let fromMs = 0;
  /** Окно, в котором событие ещё может получить свидетельство: у легато высота ждётся и после окна удара. */
  const openUntil = (e: TabEvent) => e.startMs + late(e) + (e.judge === 'legato' ? PITCH_TO : 0);

  /** Сообщить дорожке вердикт, как только он ясен (повтор того же — молча). */
  const tell = (i: number, v: JudgeVerdict) => {
    if (!v.kind || v.kind === states[i].told) return;
    states[i].told = v.kind;
    options.onStatus?.(i, v.kind, v);
  };

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
    // только атака и аккорд ясны по удару (у аккорда до итога — по времени удара, высота уточнит)
    if (events[best].judge === 'onsetOnly' || (events[best].judge === 'attack' && expected[best].length > 1)) tell(best, verdict(best));
    // «удар замечен» — только пока вердикта нет (поздняя атака не затирает показанное попадание легато или по высоте)
    else if (states[best].told === 'none') options.onStatus?.(best, 'attacked');
  };

  /** Высота прошлого кадра (NaN — её не было): «другая высота перед серией». */
  let lastPitch = NaN;

  const pitch = (ms: number, midi: number) => {
    const previous = lastPitch;
    lastPitch = midi;
    for (let i = firstOpen(ms); i < events.length && events[i].startMs - early(events[i]) <= ms; i++) {
      const s = states[i];
      const e = events[i];
      if (!Number.isNaN(s.attackMs)) {
        // кадры без высоты в медиану не идут (NaN ломает сортировку); удар: попадание ясно по PITCH_RUN кадрам нужной
        // высоты подряд, остальное — когда окно высоты прошло (не та нота, удар без высоты)
        const attack = e.judge === 'attack';
        if (ms >= s.attackMs + PITCH_FROM && ms <= s.attackMs + PITCH_TO) {
          // кадр без высоты обрывает серию «подряд»
          s.hitRun = Number.isFinite(midi) && pitchMatches(midi, expected[i], bends[i]) ? s.hitRun + 1 : 0;
          if (Number.isFinite(midi)) s.pitches.push(midi);
          if (attack && s.told === 'none' && s.hitRun >= PITCH_RUN) tell(i, timedAt(i, s.attackMs, 1));
        }
        if (attack && !s.settled && ms > s.attackMs + PITCH_TO) {
          s.settled = true;
          tell(i, verdict(i));
        }
      }
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
            tell(i, verdict(i));
          }
        } else s.run = 0;
      }
      // легато: смена высоты на нужную в окне, атаки может не быть
      if (e.judge === 'legato' && Number.isNaN(s.legatoMs) && ms >= e.startMs - early(e) && ms <= openUntil(e) &&
          pitchMatches(midi, expected[i], bends[i])) {
        s.legatoMs = ms;
        tell(i, verdict(i));
      }
    }
  };

  /** Засчитано: удар (или смена высоты) в момент at с долей ratio; вне «точно» — рано/поздно и доля не выше 0.8. */
  const timedAt = (i: number, at: number, ratio: number): JudgeVerdict => {
    const offsetMs = at - events[i].startMs;
    const exact = Math.abs(offsetMs) <= win.perfect;
    return {
      judgement: exact && ratio === 1 ? 'perfect' : 'good',
      hitRatio: exact ? ratio : Math.min(ratio, 0.8),
      kind: exact ? 'hit' : offsetMs < 0 ? 'early' : 'late',
      offsetMs,
    };
  };

  const verdict = (i: number): JudgeVerdict => {
    const e = events[i];
    const s = states[i];
    if (!judged(e)) return { judgement: 'miss', hitRatio: 0, points: 0, kind: 'skipped' };
    const timed = (at: number, ratio: number) => timedAt(i, at, ratio);
    if (e.judge === 'legato' && !Number.isNaN(s.legatoMs)) return timed(Number.isNaN(s.attackMs) ? e.startMs : s.attackMs, 1);
    if (Number.isNaN(s.attackMs)) {
      if (!Number.isNaN(s.pitchOnsetMs)) return timed(s.pitchOnsetMs, 0.9);
      return { judgement: 'miss', hitRatio: 0, kind: 'missed' };
    }
    if (e.judge === 'onsetOnly') return timed(s.attackMs, 1);
    const heard = median(s.pitches);
    if (Number.isNaN(heard)) return timed(s.attackMs, 0.7);
    if (pitchMatches(heard, expected[i], bends[i])) return timed(s.attackMs, 1);
    const tones = expected[i];
    if (tones.length > 1 && s.pitches.filter((m) => pitchMatches(m, tones, bends[i])).length * 3 >= s.pitches.length) return timed(s.attackMs, 1);
    if (s.pitches.filter((m) => Math.abs(m - heard) <= PITCH_TOL).length < PITCH_RUN) return timed(s.attackMs, 0.7);
    return { judgement: 'miss', hitRatio: 0, kind: 'wrong', offsetMs: s.attackMs - e.startMs, heardMidi: heard };
  };

  return {
    map: host.map,
    finalizeOrder: 'any',
    onBegin(from) {
      cursor = 0;
      missCursor = 0;
      fromMs = from;
      lastPitch = NaN;
    },
    reset(i, fromMs) {
      states[i] = fresh();
      // и пропущенным — «ждёт»: иначе после перемотки дорожка повторила бы их старые вспышки и подписи
      options.onStatus?.(i, 'none');
      return events[i].startMs < fromMs ? 'skipped' : 'armed';
    },
    onFrame(f, songMs) {
      if (f.onset) onset(songMs);
      else pitch(songMs, Number.isFinite(f.midi) && f.clarity >= MIN_CLARITY ? f.midi - tune : NaN);
    },
    onTick(songMs) {
      // промах ясен, когда окно события прошло с запасом на вывод и доставку кадров — раньше закрытия события
      const slack = options.finalizeDelayMs ?? 0;
      while (missCursor < events.length && openUntil(events[missCursor]) + slack < songMs) {
        const i = missCursor++;
        const s = states[i];
        if (!judged(events[i]) || events[i].startMs < fromMs) continue;
        if (Number.isNaN(s.attackMs) && Number.isNaN(s.pitchOnsetMs) && Number.isNaN(s.legatoMs)) tell(i, verdict(i));
      }
    },
    closeAtMs: (i) => events[i].startMs + late(events[i]) + PITCH_TO + 50 + (options.finalizeDelayMs ?? 0),
    finalize(i) {
      const v = verdict(i);
      tell(i, v);
      return v;
    },
    progress: (i) => (Number.isNaN(states[i].attackMs) ? 0 : 1),
    frameTime: (f) => options.toClock(f.atMs),
    summarize: guitarSummary,
  };
}
