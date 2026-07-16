// E2E скоринга вибрато-упражнения: настоящая карта buildVibratoHold →
// настоящий GameEngine → синтетические кадры анализа. Три прогона:
// с вибрато (perfect), точный тон без вибрато (miss), вибрато мимо нот (miss).
import { GameEngine } from '../src/game/engine';
import { EXERCISES } from '../src/game/exercises';
import type { AnalysisFrame, AudioInput } from '../src/audio/AudioInput';
import type { GameSummary } from '../src/game/scoring';

// --- заглушка WebAudio: движку нужны только часы, синту — узлы-пустышки ---
function stubParam() {
  return {
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {},
  };
}
function stubNode() {
  const n: Record<string, unknown> = {
    gain: stubParam(),
    frequency: stubParam(),
    type: '',
    onended: null,
    start() {},
    stop() {},
    disconnect() {},
  };
  n.connect = () => n;
  return n;
}
class FakeCtx {
  currentTime = 0;
  destination = stubNode();
  createGain() { return stubNode(); }
  createOscillator() { return stubNode(); }
  async resume() {}
}

class FakeInput implements AudioInput {
  readonly kind = 'worklet' as const;
  private fn: ((f: AnalysisFrame) => void) | null = null;
  async listDevices() { return []; }
  async start() {}
  stop() {}
  setGate() {}
  latencyMs() { return 0; }
  onFrame(fn: (f: AnalysisFrame) => void) { this.fn = fn; return () => { this.fn = null; }; }
  push(f: AnalysisFrame) { this.fn?.(f); }
}

const def = EXERCISES.find((e) => e.id === 'vibrato-hold')!;
const map = def.build({ lowMidi: 48, highMidi: 67 }, { bpm: 60, repeats: 3 });
if (!map.notes.every((n) => n.tech === 'vibrato')) throw new Error('ноты без tech=vibrato');

function frame(t: number, midi: number, vib: boolean): AnalysisFrame {
  return {
    t, hz: 440 * 2 ** ((midi - 69) / 12), midi, midiRaw: midi, clarity: 0.9, rms: 0.05,
    voiced: true, loudDb: -20,
    vibrato: { active: vib, rateHz: vib ? 5.5 : 0, depthCents: vib ? 40 : 0, regularity: 0.8 },
    distortion: { active: false, score: 0 },
    breathiness: 0.1,
  };
}

async function run(sing: (noteMidi: number, t: number) => AnalysisFrame): Promise<GameSummary> {
  const ctx = new FakeCtx();
  const input = new FakeInput();
  let summary: GameSummary | null = null;
  const engine = new GameEngine({
    ctx: ctx as unknown as AudioContext,
    input,
    map,
    difficulty: 'medium',
    latencyMs: 0,
    guideNotes: false,
    metronome: false,
    onFinish: (s) => { summary = s; },
  });
  await engine.start();
  // время идёт шагом кадра 5.3 мс; кадры подаём только внутри нот
  const step = 0.00533;
  const total = (map.durationMs + 400) / 1000 + 3; // + отсчёт 3 с
  for (let t = 0; t < total; t += step) {
    ctx.currentTime = t;
    const songMs = (t - 3) * 1000;
    const note = map.notes.find((n) => songMs >= n.startMs && songMs < n.startMs + n.durMs);
    if (note) input.push(sing(note.midi, t));
    engine.tick();
    if (summary) break;
  }
  if (!summary) throw new Error('игра не завершилась');
  return summary;
}

const withVib = await run((midi, t) => frame(t, midi + 0.15 * Math.sin(t * 34.6), true));
const noVib = await run((midi, t) => frame(t, midi, false));
const vibOffPitch = await run((midi, t) => frame(t, midi + 4, true));

console.log('с вибрато:      ', { perfect: withVib.perfect, miss: withVib.miss, acc: +withVib.accuracy.toFixed(2), vibratoMs: Math.round(withVib.tech.vibratoMs) });
console.log('без вибрато:    ', { perfect: noVib.perfect, miss: noVib.miss, acc: +noVib.accuracy.toFixed(2), vibratoMs: Math.round(noVib.tech.vibratoMs) });
console.log('вибрато мимо нот:', { perfect: vibOffPitch.perfect, miss: vibOffPitch.miss });

if (withVib.perfect !== map.notes.length) throw new Error('FAIL: с вибрато не все ноты perfect');
if (withVib.tech.vibratoMs < 3000 * map.notes.length * 0.8) throw new Error('FAIL: vibratoMs в статистике мал');
if (noVib.miss !== map.notes.length) throw new Error('FAIL: без вибрато должны быть miss');
if (vibOffPitch.miss !== map.notes.length) throw new Error('FAIL: мимо нот должны быть miss');
console.log('OK: вибрато-упражнение сквозной тест пройден');
