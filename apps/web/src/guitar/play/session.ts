// Сессия игры (этап 13a; оценка — M2): аранжировка → играбельная карта (синт) → транспорт со слоями минуса и гайда →
// движок GameEngine<TabMap>. С оценкой — гитарный судья на кадрах входа (время звука → часы того, что слышно; вердикты —
// статусами нот дорожки), без неё — судья none (время идёт, события закрываются без очков). Отсчёт по долям карты —
// транспорт. dispose — освобождение транспорта и движка; вызывается из того же эффекта, что создал сессию.
import type { InputFrame } from '../../audio/instrument/session';
import { heardClock, outputDelayMs, type PlaybackContext } from '../../audio/guitar/playback';
import { WebAudioTransport } from '../../audio/transport/WebAudioTransport';
import type { BackingLayer } from '../../audio/transport/Transport';
import { GameEngine } from '../../game/engine';
import type { FrameSource } from '../../game/judge';
import { noneJudge } from '../../game/judges/noneJudge';
import type { GameSummary } from '../../game/scoring';
import { adaptMap, type AdaptedMap } from '../highway/adapter';
import { guitarJudge, type GuitarStatus } from '../judge/guitarJudge';
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
  dispose(): void;
}

export interface PlayScoring {
  frames: FrameSource<InputFrame>;
  a4Hz: number;
  strictness: Strictness;
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
  const engine = new GameEngine<TabMap, InputFrame>({
    ctx, input: scoring?.frames ?? NO_INPUT, map, difficulty: 'medium', latencyMs: 0, guideNotes: false, metronome, transport,
    judge: scoring
      ? (host) =>
          guitarJudge(host, {
            toClock: heardClock(ctx), a4Hz: scoring.a4Hz, strictness: scoring.strictness,
            // события закрываются по расписанию минуса, кадры — во времени слышимого (позже на вывод) и с доставкой
            finalizeDelayMs: Math.max(60, outputDelayMs(ctx)) + FRAME_SLACK_MS,
            onStatus: (event, status) => {
              for (const ff of adapted.ffOfEvent[event]) adapted.arr.status[ff] = STATUS_CODE[status];
            },
          })
      : (host) => noneJudge<TabMap, InputFrame>(host),
    onFinish,
  });
  return {
    map, adapted, engine, transport, scoring: !!scoring,
    dispose: () => {
      engine.quit();
      transport.halt();
    },
  };
}
