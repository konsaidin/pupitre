// Полный журнал графа на ручных аудиочасах. Идентификаторы локальны сессии.
import { FakeCtx } from './fakeAudio';

type Node = ReturnType<FakeCtx['createGain']>;
export interface GraphEvent {
  at: number;
  id: string;
  action: string;
  args: unknown[];
}

export class RecordingGraphCtx extends FakeCtx {
  readonly events: GraphEvent[] = [];
  private nextId = 0;
  private ids = new WeakMap<object, string>();
  private sources: { node: Node; id: string; stopAt: number | null; ended: boolean }[] = [];

  constructor() {
    super();
    this.destination = this.instrument(this.destination, 'destination');
  }

  private log(id: string, action: string, ...args: unknown[]) {
    this.events.push({ at: this.currentTime, id, action, args });
  }

  private param(id: string, name: string) {
    let value = 0;
    const param: Record<string, unknown> = {};
    Object.defineProperty(param, 'value', {
      get: () => value,
      set: (next: number) => { value = next; this.log(id, `${name}.value`, next); },
      enumerable: true,
    });
    for (const method of [
      'setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
      'setTargetAtTime', 'cancelScheduledValues',
    ]) {
      param[method] = (...args: number[]) => {
        this.log(id, `${name}.${method}`, ...args);
        return param;
      };
    }
    return param;
  }

  private instrument(node: Node, kind: string): Node {
    const id = `${kind}-${this.nextId++}`;
    this.ids.set(node, id);
    this.log(id, 'create', kind);
    if (kind === 'gain') node.gain = this.param(id, 'gain');
    if (kind === 'oscillator') {
      node.frequency = this.param(id, 'frequency');
      let type = 'sine';
      Object.defineProperty(node, 'type', {
        get: () => type,
        set: (next: string) => { type = next; this.log(id, 'type', next); },
      });
    }
    node.connect = (target: object, ...args: number[]) => {
      const targetId = this.ids.get(target);
      if (!targetId) throw new Error('Unregistered audio destination');
      this.log(id, 'connect', targetId, ...args);
      return target; // WebAudio chaining returns the destination, not the source.
    };
    node.disconnect = (...args: (object | number)[]) => {
      this.log(id, 'disconnect', ...args.map(arg => typeof arg === 'object' ? this.ids.get(arg) : arg));
    };
    if (kind === 'buffer') {
      let buffer: AudioBuffer | null = null;
      Object.defineProperty(node, 'buffer', {
        get: () => buffer,
        set: (next: AudioBuffer | null) => {
          buffer = next;
          this.log(id, 'buffer', next && {
            duration: next.duration, sampleRate: next.sampleRate,
            length: next.length, numberOfChannels: next.numberOfChannels,
          });
        },
      });
    }
    if (kind === 'oscillator' || kind === 'buffer') {
      const source = { node, id, stopAt: null as number | null, ended: false };
      this.sources.push(source);
      node.start = (...args: number[]) => this.log(id, 'start', ...args);
      node.stop = (...args: number[]) => {
        this.log(id, 'stop', ...args);
        source.stopAt = args[0] ?? this.currentTime;
      };
    }
    return node;
  }

  // Явная доставка onended: не зависит от настоящего времени или таймеров.
  deliverEnded() {
    for (const source of this.sources) {
      if (source.ended || source.stopAt === null || source.stopAt > this.currentTime) continue;
      source.ended = true;
      this.log(source.id, 'ended');
      (source.node.onended as (() => void) | null)?.();
    }
  }

  override createGain() { return this.instrument(super.createGain(), 'gain'); }
  override createOscillator() { return this.instrument(super.createOscillator(), 'oscillator'); }
  override createBufferSource() { return this.instrument(super.createBufferSource(), 'buffer'); }
}
