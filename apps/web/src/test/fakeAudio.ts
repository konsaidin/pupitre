// Заглушки WebAudio и AudioInput для тестов движка: часы двигаются вручную,
// кадры анализа подаются синтетически (тот же приём, что в e2e/vibrato-exercise).

import type { AnalysisFrame, AudioDevice, AudioInput, FrameListener, MicOptions } from '../audio/AudioInput';

function param() {
  return {
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {},
  };
}

function node() {
  const n: Record<string, unknown> = {
    gain: param(),
    frequency: param(),
    type: '',
    onended: null,
    buffer: null,
    start() {},
    stop() {},
    disconnect() {},
  };
  n.connect = () => n;
  return n;
}

/** AudioContext-заглушка: currentTime выставляется тестом напрямую. */
export class FakeCtx {
  currentTime = 0;
  destination = node();
  createGain() {
    return node();
  }
  createOscillator() {
    return node();
  }
  createBufferSource() {
    return node();
  }
  async resume() {}
}

export class FakeInput implements AudioInput {
  readonly kind = 'worklet' as const;
  private fn: FrameListener | null = null;
  async listDevices(): Promise<AudioDevice[]> {
    return [];
  }
  async start(_deviceId: string | null, _opts?: MicOptions) {}
  stop() {}
  setGate() {}
  latencyMs() {
    return 0;
  }
  onFrame(fn: FrameListener) {
    this.fn = fn;
    return () => {
      this.fn = null;
    };
  }
  /** Подать кадр движку, как будто он пришёл из ядра. */
  push(f: AnalysisFrame) {
    this.fn?.(f);
  }
}

export function frame(t: number, midi: number, over: Partial<AnalysisFrame> = {}): AnalysisFrame {
  return {
    t,
    hz: 440,
    midi,
    midiRaw: midi,
    clarity: 0.9,
    rms: 0.05,
    voiced: true,
    loudDb: -20,
    vibrato: { active: false, rateHz: 0, depthCents: 0, regularity: 0 },
    distortion: { active: false, score: 0 },
    breathiness: 0,
    ...over,
  };
}

export function unvoiced(t: number): AnalysisFrame {
  return frame(t, NaN, { voiced: false, midiRaw: NaN });
}
