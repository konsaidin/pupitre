// Таймлайн партитуры в порядке исполнения (§3.2 ScoreTimeline): MidiFileGenerator alphaTab с AlphaSynthMidiFileHandler,
// MidiFile формата 0 (SingleTrackMultiChannel — обход рекурсии multi-track в 1.8.4); tickLookup разворачивает повторы,
// вольты и D.C./D.S., каждый проход такта — свой (index, occ). Вызывать ПОСЛЕ prepareScore (конвертер fretfall).
import * as alphaTab from '@coderline/alphatab';
import { buildTempoMap, temposOf, type TempoMap } from '../model/tempo';
import { PPQ, type ScoreTimeline, type TimelineBar, type TimelineBeat } from '../model/types';

export interface BuiltTimeline {
  timeline: ScoreTimeline;
  tempo: TempoMap;
  tickLookup: alphaTab.midi.MidiTickLookup;
  /** Тот же MidiFile — для рендера синт-минуса (этап 11). */
  midiFile: alphaTab.midi.MidiFile;
}

export function buildTimeline(score: alphaTab.model.Score, settings: alphaTab.Settings): BuiltTimeline {
  const midiFile = new alphaTab.midi.MidiFile();
  midiFile.format = alphaTab.midi.MidiFileFormat.SingleTrackMultiChannel;
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile);
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  generator.generate();
  const tickLookup = generator.tickLookup;
  if (midiFile.division !== PPQ) throw Error(`Ожидалось ${PPQ} PPQ, alphaTab дал ${midiFile.division}`);

  const tempo = buildTempoMap(
    tickLookup.masterBars.flatMap((mb) => mb.tempoChanges.map((c) => ({ tick: c.tick, bpm: c.tempo }))),
    score.tempo,
  );
  const passes = new Map<number, number>();
  const bars: TimelineBar[] = [];
  const beats: TimelineBeat[] = [];
  for (const mb of tickLookup.masterBars) {
    const master = mb.masterBar;
    const occ = passes.get(master.index) ?? 0;
    passes.set(master.index, occ + 1);
    const num = master.timeSignatureNumerator;
    bars.push({
      index: master.index, occ, fromTick: mb.start, toTick: mb.end, num, den: master.timeSignatureDenominator,
      tripletFeel: master.tripletFeel, ...(master.section ? { section: master.section.text } : {}),
    });
    const perBeat = (mb.end - mb.start) / num;
    for (let beat = 0; beat < num; beat++)
      beats.push({ tick: mb.start + beat * perBeat, bar: master.index, occ, beat, downbeat: beat === 0 });
  }
  return {
    timeline: {
      ppq: PPQ, durationTicks: bars.at(-1)?.toTick ?? 0, bars, beats, tempos: temposOf(tempo), synthShiftTicks: handler.tickShift,
    },
    tempo, tickLookup, midiFile,
  };
}
