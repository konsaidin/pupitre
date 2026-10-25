// Сессия игры (этап 13a; оценка — M2): аранжировка → играбельная карта (синт) → транспорт со слоями минуса и гайда →
// движок GameEngine<TabMap>. С оценкой — гитарный судья на кадрах входа (время звука → часы того, что слышно; вердикты —
// статусами нот дорожки), без неё — судья none (время идёт, события закрываются без очков). Отсчёт по долям карты —
// транспорт. dispose — освобождение транспорта и движка; вызывается из того же эффекта, что создал сессию.
import type { InputFrame } from '../../audio/instrument/session';
import { heardClock, outputDelayMs, type PlaybackContext } from '../../audio/guitar/playback';
import { learnController, type LearnController } from './learn';
import { WebAudioTransport } from '../../audio/transport/WebAudioTransport';
import type { BackingLayer } from '../../audio/transport/Transport';
import { GameEngine } from '../../game/engine';
import type { FrameSource } from '../../game/judge';
import { noneJudge } from '../../game/judges/noneJudge';
import type { GameSummary } from '../../game/scoring';
import { adaptMap, setVerdict, type AdaptedMap } from '../highway/adapter';
import { guitarJudge, type GuitarJudge, type GuitarStatus } from '../judge/guitarJudge';
import { buildPlayableMap } from '../model/playable';
import type { GuitarArrangement, Strictness, TabMap } from '../model/types';
import { STATUS } from '../vendor/fretfall/highway.js';

export interface PlaySession {
  map: TabMap;
  adapted: AdaptedMap;
  engine: GameEngine<TabMap, InputFrame>;
  transport: WebAudioTransport;
  /** Идёт ли оценка (выбран вход). */
  scoring: boolean;
  /** Режим обучения (только с оценкой): ждёт ли игра несыгранную ноту, какую сейчас (−1 — не ждёт). */
  learn: LearnController | null;
  setLearn(on: boolean): void;
  learnOn(): boolean;
  dispose(): void;
}

export interface PlayScoring {
  frames: FrameSource<InputFrame>;
  a4Hz: number;
  strictness: Strictness;
  /** Учить песню: не пускать дальше несыгранной ноты. */
  learn?: boolean;
}

export interface PlaySessionOptions {
  ctx: PlaybackContext;
  arr: GuitarArrangement;
  layers: BackingLayer[];
  speed: number;
  metronome: boolean;
  /** Вход с анализом — оценка игры; нет — «играть вдоль». */
  scoring?: PlayScoring;
  onFinish: (summary: GameSummary) => void;
}

// Источник кадров «нет входа»: судья none кадров не ждёт.
const NO_INPUT: FrameSource<InputFrame> = { onFrame: () => () => {} };

const STATUS_CODE: Record<GuitarStatus, number> = {
  none: STATUS.none, attacked: STATUS.attacked, hit: STATUS.hit, early: STATUS.early, late: STATUS.late, wrong: STATUS.wrong,
  missed: STATUS.missed, skipped: STATUS.none,
};
/** Запас на анализ и доставку кадров сверх задержки вывода, мс. */
const FRAME_SLACK_MS = 120;

export function createPlaySession({ ctx, arr, layers, speed, metronome, scoring, onFinish }: PlaySessionOptions): PlaySession {
  const map = buildPlayableMap(arr, { kind: 'synth', speed, leadInMs: 0 }, { mode: 'max' });
  const transport = new WebAudioTransport(ctx);
  if (transport.clockDomain !== 'audiocontext') throw Error(`Домены часов не совпадают: транспорт ${transport.clockDomain}, вход — audiocontext`);
  transport.load({
    durationMs: map.durationMs, layers, bpm: map.bpm, beats: map.beats.map((b) => ({ ms: b.ms, downbeat: b.downbeat })),
    metronome, countIn: true,
  });
  const adapted = adaptMap(map);
  let judge: GuitarJudge | null = null;
  const engine = new GameEngine<TabMap, InputFrame>({
    ctx, input: scoring?.frames ?? NO_INPUT, map, difficulty: 'medium', latencyMs: 0, guideNotes: false, metronome, transport,
    judge: scoring
      ? (host) =>
          (judge = guitarJudge(host, {
            toClock: heardClock(ctx), a4Hz: scoring.a4Hz, strictness: scoring.strictness,
            // события закрываются по расписанию минуса, кадры — во времени слышимого (позже на вывод) и с доставкой
            finalizeDelayMs: Math.max(60, outputDelayMs(ctx)) + FRAME_SLACK_MS,
            onStatus: (event, status, v) => setVerdict(adapted, event, STATUS_CODE[status], v?.offsetMs, v?.heardMidi),
          }))
      : (host) => noneJudge<TabMap, InputFrame>(host),
    onFinish,
  });
  // Режим обучения: свой шаг часов (движок своих колбэков на шаг не даёт) и своя подписка на вход — во время ожидания
  // движок кадры судье не передаёт.
  const HIT_CODES: readonly number[] = [STATUS.hit, STATUS.early, STATUS.late];
  let learnOn = !!scoring?.learn;
  const learn =
    scoring && (judge as GuitarJudge | null)
      ? learnController({
          events: map.notes,
          hit: (i) => HIT_CODES.includes(adapted.arr.status[adapted.ffOfEvent[i][0]] ?? STATUS.none),
          attacked: (i) => adapted.arr.status[adapted.ffOfEvent[i][0]] === STATUS.attacked,
          heardMs: () => transport.heardSongMs(),
          phase: () => engine.phase,
          wait: (atMs) => engine.wait(atMs),
          proceed: () => engine.proceed(),
          markHeld: (i) => (judge as GuitarJudge | null)?.markHeld(i),
          a4Hz: scoring.a4Hz,
          enabled: () => learnOn,
        })
      : null;
  const learnTimer = learn ? setInterval(() => learn.tick(), 15) : null;
  const learnOff = learn ? scoring!.frames.onFrame((f) => learn.onFrame(f)) : null;
  return {
    map, adapted, engine, transport, scoring: !!scoring, learn,
    setLearn: (on) => {
      learnOn = on && !!learn;
      // выключили во время ожидания — едем дальше без этой ноты
      if (!learnOn && engine.phase === 'waiting') engine.proceed();
    },
    learnOn: () => learnOn,
    dispose: () => {
      if (learnTimer !== null) clearInterval(learnTimer);
      learnOff?.();
      engine.quit();
      transport.halt();
    },
  };
}
