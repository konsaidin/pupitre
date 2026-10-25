// Слой вердиктов дорожки (ui-spec §9 «Вердикт», §10.2): над грифом на ладу ноты — «← −38 мс» (рано), «+52 мс →»
// (поздно), «✕ A♯2 · +1 лад» (не та нота; у аккорда — только услышанная нота, один чип на аккорд). Попадание вовремя и
// промах — без текста: вспышку и серую ноту рисует дорожка. Подпись появляется в момент вердикта (arr.statusAt),
// поднимается на 6 px за 240 мс (при reduce-движении — без подъёма) и живёт 600 мс; близкие по x не налезают — правая
// поднимается на строку. Чистые функции: кадр дорожки зовёт их на переиспользуемых объектах.
import { t } from '../../lib/i18n';
import { midiToName } from '../../lib/music';
import { STATUS } from '../vendor/fretfall/highway.js';
import { count } from '../i18n';
import { foldSemitones } from '../judge/guitarJudge';
import { firstNoteAt, type AdaptedMap } from './adapter';

export type VerdictChipKind = 'early' | 'late' | 'wrong';

export interface VerdictChip {
  /** Нота fretfall, на которой стоит подпись (у аккорда — первая нота события). */
  note: number;
  kind: VerdictChipKind;
  /** Секунды с вердикта. */
  age: number;
  text: string;
  /** Середина низа подписи, CSS-пиксели канваса (до подъёма и разведения — точка над грифом). */
  x: number;
  y: number;
}

export const CHIP_LIFE_S = 0.6;
const RISE_S = 0.24;
const RISE_PX = 6;
const FADE_S = 0.15;
const ROW_PX = 28;
/** Оценка ширины подписи без замера раскладки: моно 12 px ≈ 7.5 px на знак + иконка и поля. */
const charPx = 7.5;
const padPx = 34;

const KIND: Record<number, VerdictChipKind | undefined> = { [STATUS.early]: 'early', [STATUS.late]: 'late', [STATUS.wrong]: 'wrong' };

export const newChip = (): VerdictChip => ({ note: -1, kind: 'early', age: 0, text: '', x: 0, y: 0 });

/** Свежие вердикты с текстом — по одному на событие, не больше out.length (пул). Возвращает их число. */
export function collectChips(a: AdaptedMap, now: number, out: VerdictChip[]): number {
  const { notes, status, statusAt } = a.arr;
  let n = 0;
  for (let i = firstNoteAt(notes, now - 2.5); i < notes.length && notes[i].time <= now + 0.5 && n < out.length; i++) {
    const kind = KIND[status[i]];
    const age = now - statusAt[i];
    if (!kind || !(age >= 0 && age < CHIP_LIFE_S) || a.ffOfEvent[a.fromFf[i * 2]][0] !== i) continue;
    const c = out[n++];
    c.note = i;
    c.kind = kind;
    c.age = age;
  }
  return n;
}

const signed = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v)}`;

/** Текст подписи: «−38 мс» / «+52 мс»; «A♯2 · +1 лад» (одиночная нота) или «A♯2» (аккорд); нет данных — пусто. */
export function chipText(a: AdaptedMap, note: number, kind: VerdictChipKind): string {
  const event = a.fromFf[note * 2];
  if (kind !== 'wrong') {
    const ms = Math.round(a.offsetMs[event]);
    return Number.isFinite(ms) ? `${signed(ms)} ${t('ms')}` : '';
  }
  const heard = a.heardMidi[event];
  if (!Number.isFinite(heard)) return '';
  const name = midiToName(heard).replace('#', '♯');
  if (a.ffOfEvent[event].length > 1) return name;
  // на той же струне разница в полутонах — это лады; ошибку октавы YIN судья уже простил
  const frets = Math.round(foldSemitones(heard - a.midi[note]));
  if (!frets) return name;
  return `${name} · ${frets < 0 ? '−' : '+'}${count(Math.abs(frets), 'fret')}`;
}

/** Прозрачность подписи по возрасту: последние 150 мс гаснет. */
export function chipOpacity(age: number): number {
  return Math.max(0, Math.min(1, (CHIP_LIFE_S - age) / FADE_S));
}

const width = (c: VerdictChip) => c.text.length * charPx + padPx;

/**
 * Подъём и разведение: y — с подъёмом (ease-out за 240 мс), подписи сортируются по x; если соседние налезают, правая
 * встаёт на строку выше левой. Сортирует chips[0..n) на месте (вставками: n ≤ размера пула).
 */
export function layoutChips(chips: VerdictChip[], n: number, reduceMotion: boolean): void {
  for (let i = 0; i < n; i++) {
    const c = chips[i];
    if (!reduceMotion) {
      const u = Math.min(1, c.age / RISE_S);
      c.y += RISE_PX * (1 - u) * (1 - u) * (1 - u);
    }
  }
  for (let i = 1; i < n; i++) {
    const c = chips[i];
    let j = i - 1;
    while (j >= 0 && chips[j].x > c.x) {
      chips[j + 1] = chips[j];
      j--;
    }
    chips[j + 1] = c;
  }
  for (let i = 1; i < n; i++) {
    const a = chips[i - 1];
    const b = chips[i];
    if (b.x - a.x < (width(a) + width(b)) / 2 + 6 && Math.abs(a.y - b.y) < ROW_PX - 2) b.y = a.y - ROW_PX;
  }
}
