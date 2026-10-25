// Слои синт-минуса для транспорта (этап 11): PCM из воркера (операция render) → AudioBuffer минуса и гайда.
// Кэш — по (аранжировка, скорость, частота): повторный заход в песню и пауза не рендерят заново.
import { renderRateFor, stereoBuffer, type PlaybackContext } from '../../audio/guitar/playback';
import type { BackingLayer } from '../../audio/transport/Transport';
import type { Bytes, RenderRequest, RenderResult } from '../import/protocol';
import type { GuitarArrangement, GuitarSettings } from '../model/types';

export interface SynthSource {
  arr: GuitarArrangement;
  /** Байты оригинала партитуры (каждый раз новые: уходят воркеру без копии). */
  scoreBytes: () => Promise<Bytes>;
  render: (req: RenderRequest) => Promise<RenderResult>;
  speed: number;
}

// Два последних рендера: песня в 4 мин при 48 кГц — около 180 МБ на партию (минус + гайд), больше держать незачем.
const CACHE_SIZE = 2;
const cache = new Map<string, Promise<{ minus: AudioBuffer; guide: AudioBuffer }>>();

const toBuffer = (ctx: PlaybackContext, pcm: RenderResult['minus'], sampleRate: number) => stereoBuffer(ctx, pcm.left, pcm.right, sampleRate);

export async function synthBuffers(ctx: PlaybackContext, src: SynthSource): Promise<{ minus: AudioBuffer; guide: AudioBuffer }> {
  const sampleRate = renderRateFor(ctx.sampleRate);
  const key = `${src.arr.id}|${src.arr.source.converterVersion}|${src.speed}|${sampleRate}`;
  let hit = cache.get(key);
  if (hit) {
    cache.delete(key); // свежий — в конец очереди
    cache.set(key, hit);
  } else {
    hit = (async () => {
      const result = await src.render({
        bytes: await src.scoreBytes(), fileSha256: src.arr.source.fileSha256, trackIndex: src.arr.trackIndex,
        sampleRate, speed: src.speed, ...(src.arr.source.encoding ? { encoding: src.arr.source.encoding as RenderRequest['encoding'] } : {}),
      });
      return { minus: toBuffer(ctx, result.minus, sampleRate), guide: toBuffer(ctx, result.guide, sampleRate) };
    })();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

/** Слои транспорта: минус и гайд (партия игрока соло, тихо — ui-spec: −18 дБ по умолчанию). */
export function backingLayers(buffers: { minus: AudioBuffer; guide: AudioBuffer }, mix: GuitarSettings['mix']): BackingLayer[] {
  return [
    { id: 'minus', source: buffers.minus, gain: mix.backing },
    { id: 'guide', source: buffers.guide, gain: mix.guide },
  ];
}
