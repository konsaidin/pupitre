// Музыкальная теория: конвертации MIDI ↔ Hz ↔ имена нот, центы.

export const A4_MIDI = 69;
export const A4_HZ = 440;

export function hzToMidi(hz: number): number {
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ);
}

export function midiToHz(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Разница в центах между частотой и MIDI-нотой (может быть дробной). */
export function centsOff(hz: number, midi: number): number {
  return (hzToMidi(hz) - midi) * 100;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToName(midi: number): string {
  const m = Math.round(midi);
  const octave = Math.floor(m / 12) - 1;
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${octave}`;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((Math.round(midi) % 12) + 12) % 12);
}

/** Свернуть midi-высоту к ближайшей октаве целевой ноты. */
export function foldToOctaveOf(midi: number, targetMidi: number): number {
  return midi + 12 * Math.round((targetMidi - midi) / 12);
}

/** Человекочитаемое имя диапазона: примерная классификация голоса. */
export function classifyRange(lowMidi: number, highMidi: number): string {
  const center = (lowMidi + highMidi) / 2;
  // английские ключи — при показе оборачиваются в t()
  if (center < 48) return 'bass';
  if (center < 53) return 'baritone';
  if (center < 58) return 'tenor';
  if (center < 63) return 'alto';
  if (center < 68) return 'mezzo-soprano';
  return 'soprano';
}

export interface VocalRange {
  lowMidi: number;
  highMidi: number;
}

/** Комфортная зона — диапазон, поджатый на полтона с краёв. */
export function comfortZone(range: VocalRange): VocalRange {
  const low = range.lowMidi + 1;
  const high = range.highMidi - 1;
  return high - low >= 5 ? { lowMidi: low, highMidi: high } : { ...range };
}
