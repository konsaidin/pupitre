// «Играть вдоль»: время идёт, события закрываются без оценки и очков.
// Импортируется только фабрикой сессии, в вокальный вход не входит.
import type { SongMap } from '../../lib/songMap';
import type { JudgeHost, NoteJudge } from '../judge';
import { summarize } from '../scoring';

export function noneJudge<M extends SongMap, F>(host: JudgeHost<M>): NoteJudge<M, F> {
  return {
    map: host.map,
    finalizeOrder: 'any',
    onBegin() {},
    reset: (i, fromMs) => host.map.notes[i].startMs < fromMs ? 'skipped' : 'armed',
    onFrame() {},
    closeAtMs: (i) => host.map.notes[i].startMs + host.map.notes[i].durMs,
    finalize: () => ({ judgement: 'miss', hitRatio: 0, points: 0, kind: 'skipped' }),
    progress: () => 0,
    frameTime: () => NaN,
    summarize: () => summarize([], 0, 0),
  };
}
