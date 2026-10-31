// WAV дубля: заголовок PCM 24 бит моно, значения с краями шкалы; сырые сэмплы — в Blob и обратно без потерь.
import { describe, expect, it } from 'vitest';
import { blobSamples, encodeWav24, samplesBlob } from './wav';

describe('WAV и сырые сэмплы', () => {
  it('PCM 24 бит моно: заголовок и сэмплы, выше полной шкалы — к краю, NaN — тишина', async () => {
    const wav = new DataView(await encodeWav24(Float32Array.from([0, 1, -1, 2, Number.NaN, 0.5]), 48000).arrayBuffer());
    const text = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(at + i)));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect([wav.getUint16(20, true), wav.getUint16(22, true), wav.getUint32(24, true), wav.getUint16(34, true), wav.getUint32(40, true)]).toEqual([1, 1, 48000, 24, 18]);
    const sample = (i: number) => {
      const u = wav.getUint8(44 + i * 3) | (wav.getUint8(45 + i * 3) << 8) | (wav.getUint8(46 + i * 3) << 16);
      return u >= 0x800000 ? u - 0x1000000 : u;
    };
    expect([0, 1, 2, 3, 4, 5].map(sample)).toEqual([0, 8388607, -8388607, 8388607, 0, 4194304]);
  });

  it('сырые Float32 — туда и обратно', async () => {
    const x = Float32Array.from([0.1, -0.25, 1e-7, 0.999]);
    expect(await blobSamples(samplesBlob(x))).toEqual(x);
  });
});
