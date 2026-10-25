// Записываем вызовы в порядке исполнения; null отличает пропущенный аргумент от нуля.
import { FakeCtx } from './fakeAudio';

export interface AudioScheduleEvent {
  id: number;
  node: 'buffer' | 'oscillator';
  action: 'start' | 'stop';
  when: number | null;
  offset: number | null;
  duration: number | null;
  type: string | null;
  frequency: number | null;
}

export class RecordingCtx extends FakeCtx {
  readonly events: AudioScheduleEvent[] = [];
  private nextId = 0;

  private record(node: ReturnType<FakeCtx['createOscillator']>, kind: AudioScheduleEvent['node']) {
    const id = this.nextId++;
    const record = (action: AudioScheduleEvent['action'], when?: number, offset?: number, duration?: number) => {
      this.events.push({
        id, node: kind, action, when: when ?? null, offset: offset ?? null, duration: duration ?? null,
        type: kind === 'oscillator' ? node.type as string : null,
        frequency: kind === 'oscillator' ? (node.frequency as { value: number }).value : null,
      });
    };
    node.start = (when?: number, offset?: number, duration?: number) => record('start', when, offset, duration);
    node.stop = (when?: number) => record('stop', when);
    return node;
  }

  override createOscillator() {
    return this.record(super.createOscillator(), 'oscillator');
  }

  override createBufferSource() {
    return this.record(super.createBufferSource(), 'buffer');
  }
}
