// Ударные GP7/8 от сторонних экспортёров: <InstrumentArticulation> у нот — не индекс в списке артикуляций дорожки (так
// пишет Guitar Pro), а ID ударного GP7; у ID 35–59 он совпадает с нотой GM (36 — бочка, 38 — малый, 46 — открытый хэт).
// alphaTab читает его как индекс, и в стандартном списке кита GP на этих местах бонги, тимбалес и конги — вместо ударных
// играет «ложечная» перкуссия. Признак: по индексам у дорожки нет ни бочки, ни малого, а все значения — ID кита и среди
// них есть и бочка, и малый. Тогда ноты переводятся на артикуляцию дорожки с той же нотой GM (нет такой — добавляется).
import * as alphaTab from '@coderline/alphatab';

const KICK = [35, 36];
const SNARE = [37, 38, 40];
const KIT_IDS = { min: 35, max: 59 };
/** Перкуссия, а не кит: у неё бонги и конги по индексам — настоящие. */
const PERCUSSION_NAME = /perc|bongo|conga|latin|перкус/i;

function* notesOf(track: alphaTab.model.Track): Generator<alphaTab.model.Note> {
  for (const staff of track.staves)
    for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) yield* beat.notes;
}

/** Переводит ID ударных GP7 в индексы артикуляций дорожки; число исправленных дорожек. */
export function fixDrumArticulationIds(score: alphaTab.model.Score): number {
  let fixed = 0;
  for (const track of score.tracks) {
    const list = track.percussionArticulations;
    if (!list.length || PERCUSSION_NAME.test(track.name)) continue;
    const notes = [...notesOf(track)].filter((n) => n.percussionArticulation >= 0);
    const values = new Set(notes.map((n) => n.percussionArticulation));
    const byIndex = [...values].map((v) => list[v]?.outputMidiNumber ?? -1);
    if (!values.size || byIndex.some((m) => KICK.includes(m) || SNARE.includes(m))) continue;
    if (![...values].every((v) => v >= KIT_IDS.min && v <= KIT_IDS.max)) continue;
    if (![...values].some((v) => KICK.includes(v)) || ![...values].some((v) => SNARE.includes(v))) continue;
    const indexOf = new Map<number, number>();
    for (const v of values) {
      let i = list.findIndex((a) => a.outputMidiNumber === v);
      if (i < 0) i = list.push(new alphaTab.model.InstrumentArticulation('', 0, v)) - 1;
      indexOf.set(v, i);
    }
    for (const n of notes) n.percussionArticulation = indexOf.get(n.percussionArticulation)!;
    fixed++;
  }
  return fixed;
}
