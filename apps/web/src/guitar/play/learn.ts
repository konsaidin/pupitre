// Режим обучения («Учить песню», ui-spec §11.6): игра не пускает дальше несыгранной ноты. Когда слышимое время доходит
// до начала события, которое ещё не засчитано, движок встаёт (engine.wait) — нота стоит на линии удара, минус молчит.
// Пока ждём, вход слушает этот модуль: удар или смена высоты, а затем нужная высота PITCH_RUN кадров подряд (у аккорда
// по кадрам 20–150 мс после удара — chordEvidence, как у судьи; у глушёного удара — сам удар) → судья отмечает «сыграно» (markHeld) → движок продолжает с той же точки (proceed).
// Прыжки времени (перемотка, луп) ожидание не запускают: встаём только на событиях, которые часы пересекли плавно.
import type { InputFrame } from '../../audio/instrument/session';
import type { GamePhase } from '../../game/engine';
import { chordEvidence, pitchMatches } from '../judge/guitarJudge';
import type { TabEvent } from '../model/types';

const PITCH_RUN = 3;
const MIN_CLARITY = 0.5;
/** Шаг часов больше этого — прыжок (перемотка), а не игра. */
const JUMP_MS = 300;
/** Удар замечен, а высота ещё подтверждается (судье нужно ≈ 40 мс кадров) — фора, прежде чем встать. */
const GRACE_MS = 180;

export interface LearnHost {
  events: TabEvent[];
  /** Засчитано ли событие (попадание, рано, поздно) — тогда не ждём. */
  hit(i: number): boolean;
  /** Удар по событию уже замечен (вердикт ещё не вынесен). */
  attacked(i: number): boolean;
  heardMs(): number;
  phase(): GamePhase;
  wait(atMs: number): void;
  proceed(): void;
  markHeld(i: number): void;
  a4Hz: number;
  /** Режим включён (переключается на лету). */
  enabled(): boolean;
}

export interface LearnController {
  /** Кадр входа (всегда; используется только во время ожидания). */
  onFrame(f: InputFrame): void;
  /** Шаг часов: встать на пересечённой несыгранной ноте. */
  tick(): void;
  /** Событие, которого ждём, или −1. */
  waitingFor(): number;
}

const judgedEvent = (e: TabEvent) => e.judge !== 'none' && e.judge !== 'tie';

export function learnController(host: LearnHost): LearnController {
  const tune = 12 * Math.log2(host.a4Hz / 440);
  let lastHeard = NaN;
  let waiting = -1;
  // во время ожидания: был ли удар, длина серии нужной высоты, была ли перед серией другая высота
  let onset = false;
  let run = 0;
  let afterOther = false;
  let lastMatched = false;
  /** Пересечённое событие с замеченным ударом: ждём вердикт судьи до startMs + GRACE_MS. */
  let pending = -1;
  /** Аккорд: время удара (perf, мс) и кадры после него. */
  let chordAt = NaN;
  const chordPitches: number[] = [];
  const chordClarities: number[] = [];

  const startWaiting = (i: number, struck = false) => {
    waiting = i;
    pending = -1;
    // удар уже был (судья заметил) — звучащей нужной высоты достаточно
    onset = struck;
    chordAt = NaN;
    run = 0;
    afterOther = false;
    // прошлая нота ещё может звучать той же высотой: «смена высоты» — только после другой высоты или тишины
    lastMatched = true;
    host.wait(host.events[i].startMs);
  };

  const played = (i: number) => {
    waiting = -1;
    host.markHeld(i);
    host.proceed();
  };

  return {
    waitingFor: () => waiting,
    tick() {
      const phase = host.phase();
      if (phase === 'waiting') return;
      if (waiting >= 0 && phase !== 'paused') waiting = -1; // продолжили из меню паузы или перемотали
      if (!host.enabled() || phase !== 'playing') {
        lastHeard = NaN;
        pending = -1;
        return;
      }
      const now = host.heardMs();
      const prev = lastHeard;
      if (now === prev) return; // часы вывода стоят между отметками — ждём следующую
      lastHeard = now;
      if (Number.isNaN(prev) || now < prev || now - prev > JUMP_MS) {
        pending = -1;
        return;
      }
      const { events } = host;
      if (pending >= 0) {
        if (host.hit(pending)) pending = -1;
        else if (now >= events[pending].startMs + GRACE_MS) {
          startWaiting(pending, true);
          return;
        }
      }
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.startMs <= prev) continue;
        if (e.startMs > now) break;
        if (!judgedEvent(e) || host.hit(i)) continue;
        if (host.attacked(i)) {
          if (pending < 0) pending = i;
          continue;
        }
        if (pending >= 0) return; // сначала — вердикт по предыдущему
        startWaiting(i);
        return;
      }
    },
    onFrame(f) {
      if (waiting < 0 || host.phase() !== 'waiting') return;
      const e = host.events[waiting];
      const expected = e.notes.map((n) => n.midi);
      const bend = e.notes.some((n) => n.techs.includes('bend') || n.techs.includes('prebend'));
      if (f.onset) {
        onset = true;
        if (e.judge === 'onsetOnly') played(waiting);
        else if (e.notes.length > 1) {
          chordAt = f.atMs;
          chordPitches.length = 0;
          chordClarities.length = 0;
        }
        return;
      }
      const midi = Number.isFinite(f.midi) && f.clarity >= MIN_CLARITY ? f.midi - tune : NaN;
      if (e.notes.length > 1) {
        // аккорд: кадры 20–150 мс после удара, затем вердикт; не он — ждём следующий удар
        if (Number.isNaN(chordAt)) return;
        if (f.atMs >= chordAt + 20 && f.atMs <= chordAt + 150 && Number.isFinite(midi)) {
          chordPitches.push(midi);
          chordClarities.push(f.clarity);
        }
        if (f.atMs > chordAt + 150) {
          chordAt = NaN;
          if (chordEvidence(chordPitches, chordClarities, expected, bend).kind === 'hit') played(waiting);
        }
        return;
      }
      const match = Number.isFinite(midi) && pitchMatches(midi, expected, bend);
      if (match) {
        if (run === 0) afterOther = !lastMatched;
        run++;
      } else run = 0;
      lastMatched = match;
      // серия нужной высоты после удара или смены высоты (держать прошлую такую же ноту — не считается)
      if (run >= PITCH_RUN && (onset || afterOther)) played(waiting);
    },
  };
}
