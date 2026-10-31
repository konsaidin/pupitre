// WAV для экспорта дублей: моно PCM 24 бит (без клиппинга: выше полной шкалы — к краю) и сырые Float32 дубля в Blob
// хранилища и обратно.

/** Моно PCM 24 бит, little-endian. */
export function encodeWav24(samples: Float32Array, sampleRate: number): Blob {
  const bytes = samples.length * 3;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // моно
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 3, true);
  v.setUint16(32, 3, true);
  v.setUint16(34, 24, true);
  text(36, 'data');
  v.setUint32(40, bytes, true);
  const out = new Uint8Array(buf, 44);
  for (let i = 0, o = 0; i < samples.length; i++, o += 3) {
    const s = samples[i];
    const x = Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0;
    const q = Math.round(x * 8388607);
    const u = q < 0 ? q + 16777216 : q;
    out[o] = u & 0xff;
    out[o + 1] = (u >> 8) & 0xff;
    out[o + 2] = (u >> 16) & 0xff;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Сырые сэмплы дубля для хранилища (Float32, порядок байт платформы — little-endian у всех наших). */
export const samplesBlob = (samples: Float32Array<ArrayBuffer>): Blob => new Blob([samples.buffer], { type: 'application/octet-stream' });

export async function blobSamples(blob: Blob): Promise<Float32Array<ArrayBuffer>> {
  const buf = await blob.arrayBuffer();
  return new Float32Array(buf, 0, Math.floor(buf.byteLength / 4));
}
