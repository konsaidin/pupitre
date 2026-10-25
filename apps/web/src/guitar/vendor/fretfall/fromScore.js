// Конвертер партитуры alphaTab → модель песни fretfall (секунды, струна 0 — НИЖНЯЯ). Вырезка из апстримного
// player.js проекта fretfall/player (MIT, © 2026 Angelo Dini — см. LICENSE рядом) на коммите
// ed2bc3bbb52e4ce7c840c28d8ffbd54d7e34670f. Код апстрима перенесён построчно и НЕ переформатирован: тело
// createConverter не сдвинуто вправо, кавычки и отступы — апстримные, чтобы сравнение с player.js показывало только
// патчи. Диапазоны строк, патчи и SHA-256 — в VENDOR.md; каждый патч помечен «ПАТЧ Пюпитра».
// Без DOM и сети: модуль alphaTab передаётся параметром (импортирует его воркер разбора, этап 6).

import { tempoMap, tickToMs } from "./music.js";
import { suggestPositions } from "./fingering.js";

// ПАТЧ Пюпитра (а): player.js берёт глобальный alphaTab (скрипт с CDN) — здесь он параметр фабрики.
export function createConverter(alphaTab) {

// --- player.js:1439-1445 ---
// A track's part is read from its first staff with strings, wherever it sits: MuseScore's MusicXML puts the notation
// staff first and the tab under it. It is played from there alone too: the staves around it are the same notes written as
// notation, which the synth would play over them again. They are kept aside for their lyrics (see songFromScore).
// ponytail: every staff without strings in such a track goes quiet, not only a copy of the tab; compare their notes
// should a file ever pair a tab with other music
const partStaff = (track) =>
    track.staves.find((s) => s.isStringed && !s.isPercussion);

// --- ПАТЧ Пюпитра (а): предобработка из обработчика api.scoreLoaded (player.js:1446-1451) — отдельной функцией.
// Мутирует партитуру: у дорожек со струнным станом нотные станы уходят в track.unplayed (оттуда берётся текст песни),
// станы перенумеровываются. Вызывать один раз на партитуру, до MidiFileGenerator (как в player.js).
function prepareScore(score) {
    for (const track of score.tracks.filter(partStaff)) {
        track.unplayed = track.staves.filter((s) => !s.isStringed);
        track.staves = track.staves.filter((s) => s.isStringed);
        track.staves.forEach((s, i) => (s.index = i));
    }
    return score;
}

// --- player.js:1551-1625 (строка 1627 `let builtCache` — состояние плеера, не берётся) ---
// alphaTab score → the song model the highway draws, as a page's formats hand it over too (see fretfall.addFormat):
// seconds, string 0 = lowest, with Guitar Pro's notation named the way the highway draws it
const GP = alphaTab.model;
const words = (name = "") =>
    name.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase(); // "AmiTriplet" → "ami triplet"
const curve = (points) =>
    points?.length
        ? points.map((p) => [p.offset / 60, p.value / 4])
        : null; // [share of the note, steps]
const HARMONICS = [
    null,
    "natural",
    "artificial",
    "pinch",
    "tap",
    "semi",
    "feedback",
];
const ACCENTS = [null, "accent", "heavy", "tenuto"];
const ORNAMENTS = [
    null,
    "inverted turn",
    "turn",
    "upper mordent",
    "lower mordent",
];
const OTTAVAS = ["15ma", "8va", null, "8vb", "15mb"];
const KEYS = {
    major: [
        "C♭",
        "G♭",
        "D♭",
        "A♭",
        "E♭",
        "B♭",
        "F",
        "C",
        "G",
        "D",
        "A",
        "E",
        "B",
        "F♯",
        "C♯",
    ],
    minor: [
        "A♭",
        "E♭",
        "B♭",
        "F",
        "C",
        "G",
        "D",
        "A",
        "E",
        "B",
        "F♯",
        "C♯",
        "G♯",
        "D♯",
        "A♯",
    ],
};
const jump = (direction) =>
    GP.Direction[direction]
        .replace(/^(Target|Jump)/, "")
        .replace("DaCapo", "D.C.")
        .replace("DalSegnoSegno", "D.S.S.")
        .replace("DalSegno", "D.S.")
        .replace(/^DaDoubleCoda$/, "To double coda")
        .replace(/^DaCoda$/, "To coda")
        .replace("SegnoSegno", "Segno segno")
        .replace("DoubleCoda", "Double coda")
        .replace(/Al(.*)$/, " al $1")
        .replace(" al Double", " al double");

// --- player.js:1628-2149 ---
function songFromScore(score, cache) {
    const tempo = tempoMap(
        cache.masterBars.flatMap((mb) => mb.tempoChanges),
        score.tempo,
    );
    const sec = (tick) => tickToMs(tempo, tick) / 1000;
    const arrangements = score.tracks
        .filter(partStaff)
        .map((track) => {
            const staff = partStaff(track),
                notes = [],
                chords = [],
                anchors = [],
                phrases = [],
                beats = [],
                sections = [],
                handShapes = [],
                lastOnString = {};
            const markers = [],
                hairpins = [],
                rhythm = [],
                meters = [],
                keys = [],
                capos = staff.capo ? [{ time: 0, fret: staff.capo }] : [], // the file's own capo is simply one from the start
                passes = {};
            let meter = "4/4",
                key = "0:0",
                bpm = score.tempo,
                feel = 0,
                ottava = null,
                swell = null;
            for (const mb of cache.masterBars) {
                const master = mb.masterBar,
                    bar = staff.bars[master.index],
                    start = sec(mb.start),
                    end = sec(mb.end),
                    perBeat =
                        (mb.end - mb.start) /
                        master.timeSignatureNumerator;
                for (
                    let i = 0;
                    i < master.timeSignatureNumerator;
                    i++
                )
                    beats.push({
                        time: sec(mb.start + i * perBeat),
                        measure: i ? -1 : master.index + 1, // counted from 1
                    });
                if (master.section)
                    sections.push({
                        time: start,
                        name: master.section.text,
                    });

                // What the bar line says: meter, key, tempo, feel, repeats, endings, jumps
                const mark = (text, time = start) =>
                    markers.push({ time, text });
                const pass = (passes[master.index] =
                    (passes[master.index] ?? 0) + 1);
                const barMeter = `${master.timeSignatureNumerator}/${master.timeSignatureDenominator}`;
                if (barMeter !== meter) mark((meter = barMeter));
                if (meters.at(-1)?.text !== barMeter)
                    meters.push({ time: start, text: barMeter }); // the tab staff's own head, the first bar's included
                const barKey = `${bar.keySignature}:${bar.keySignatureType}`,
                    mode = bar.keySignatureType ? "minor" : "major";
                if (keys.at(-1)?.fifths !== bar.keySignature) keys.push({ time: start, fifths: bar.keySignature }); // the staff's signature
                if (barKey !== key) {
                    mark(
                        `${KEYS[mode][bar.keySignature + 7]} ${mode}`,
                    );
                    key = barKey;
                }
                for (const change of mb.tempoChanges) {
                    // every bar repeats its tempo: mark only a change
                    if (
                        Math.round(change.tempo) === Math.round(bpm)
                    )
                        continue;
                    bpm = change.tempo;
                    mark(
                        `♩ = ${Math.round(bpm)}`,
                        sec(change.tick),
                    );
                }
                if (master.tripletFeel !== feel) {
                    mark(
                        master.tripletFeel
                            ? `${words(GP.TripletFeel[master.tripletFeel])} feel`
                            : "straight",
                    );
                    feel = master.tripletFeel;
                }
                if (master.isRepeatStart)
                    mark(`repeat · pass ${pass}`);
                if (master.repeatCount > 0)
                    mark(`repeat ×${master.repeatCount}`, end);
                if (master.alternateEndings)
                    mark(
                        `ending ${[0, 1, 2, 3, 4, 5, 6, 7]
                            .filter(
                                (i) =>
                                    master.alternateEndings &
                                    (1 << i),
                            )
                            .map((i) => i + 1)
                            .join(", ")}`,
                    );
                for (const direction of master.directions ?? [])
                    mark(jump(direction));
                if (master.isFreeTime) mark("free time");

                const inBar = [];
                bar.voices.forEach((voice, v) => {
                    for (const beat of voice.beats) {
                        const t0 = sec(
                                mb.start + beat.playbackStart,
                            ),
                            t1 = sec(
                                mb.start +
                                    beat.playbackStart +
                                    beat.playbackDuration,
                            );
                        if (!v) {
                            // beat-wide marks from the first voice only: free text, ottava, crescendo hairpins, and the
                            // rhythm the tab view writes over the staff: the beat's written value, its dots, whether it
                            // is a rest. ponytail: the first voice's rhythm alone, as one lane can only carry one
                            if (
                                beat.graceType ===
                                GP.GraceType.None
                            )
                                rhythm.push({
                                    time: t0,
                                    value: beat.duration, // 1 whole, 2 half, 4 quarter, 8 eighth, and on down
                                    dots: beat.dots,
                                    rest: beat.isRest,
                                    tuplet: beat.hasTuplet
                                        ? beat.tupletNumerator
                                        : 0,
                                });
                            if (beat.text) {
                                mark(beat.text, t0);
                                const capo =
                                    /^\s*capo\s*(\d+|off)\s*$/i.exec(
                                        beat.text,
                                    ); // as a tab writes it over the staff
                                if (capo)
                                    capos.push({
                                        time: t0,
                                        fret: /off/i.test(capo[1])
                                            ? 0
                                            : +capo[1],
                                    });
                            }
                            if (OTTAVAS[beat.ottava] !== ottava) {
                                ottava = OTTAVAS[beat.ottava];
                                mark(ottava ?? "loco", t0);
                            }
                            const kind = [null, "cresc", "dim"][
                                beat.crescendo
                            ];
                            if (swell && swell.kind !== kind)
                                swell = null;
                            if (kind && !swell)
                                hairpins.push(
                                    (swell = {
                                        time: t0,
                                        endTime: t1,
                                        kind,
                                    }),
                                );
                            if (swell) swell.endTime = t1;
                        }
                        let chord = null;
                        if (beat.notes.length > 1) {
                            // the same chord back to back is one held shape; its repeats show as outlines
                            const frets = Array(
                                    staff.tuning.length,
                                ).fill(-1),
                                fingers = [...frets];
                            for (const x of beat.notes)
                                [
                                    frets[x.string - 1],
                                    fingers[x.string - 1],
                                ] = [
                                    x.fret,
                                    Math.max(-1, x.leftHandFinger),
                                ];
                            const held = handShapes.at(-1),
                                repeat =
                                    !!held &&
                                    held.frets.join() ===
                                        frets.join() &&
                                    Math.abs(held.endTime - t0) <
                                        0.01;
                            const barred = beat.barreShape
                                ? beat.notes
                                      .filter(
                                          (x) =>
                                              x.fret ===
                                              beat.barreFret,
                                      )
                                      .map((x) => x.string - 1)
                                : [];
                            chord =
                                chords.push({
                                    time: t0,
                                    name: beat.chord?.name ?? "",
                                    notes: [],
                                    frets,
                                    fingers,
                                    highDensity: repeat,
                                    palmMute: beat.notes.every(
                                        (x) => x.isPalmMute,
                                    ),
                                    fretHandMute: beat.notes.every(
                                        (x) => x.isDead,
                                    ),
                                    accent: ACCENTS[
                                        Math.max(
                                            ...beat.notes.map(
                                                (x) =>
                                                    x.accentuated ===
                                                    GP
                                                        .AccentuationType
                                                        .Tenuto
                                                        ? 0
                                                        : x.accentuated,
                                            ),
                                        )
                                    ], // pressed harder: accented or heavy
                                    strum:
                                        [
                                            null,
                                            "up",
                                            "down",
                                            null,
                                            null,
                                        ][beat.brushType] ??
                                        [null, "up", "down"][
                                            beat.pickStroke
                                        ] ??
                                        null,
                                    roll:
                                        [
                                            null,
                                            null,
                                            null,
                                            "up",
                                            "down",
                                        ][beat.brushType] ?? null,
                                    barre: barred.length
                                        ? {
                                              fret: beat.barreFret,
                                              from: Math.min(
                                                  ...barred,
                                              ),
                                              to: Math.max(
                                                  ...barred,
                                              ),
                                              half:
                                                  beat.barreShape ===
                                                  GP.BarreShape
                                                      .Half,
                                          }
                                        : undefined,
                                }) - 1;
                            if (repeat) held.endTime = t1;
                            else
                                handShapes.push({
                                    startTime: t0,
                                    endTime: t1,
                                    name: chords[chord].name,
                                    frets,
                                    fingers,
                                });
                        }
                        for (const nt of beat.notes) {
                            const tied =
                                nt.isTieDestination &&
                                lastOnString[nt.string];
                            if (tied) {
                                tied.sustain = t1 - tied.time;
                                tied.duration = t1 - tied.time; // ПАТЧ Пюпитра (г): лига удлиняет и нотную длительность
                                continue;
                            }
                            const origin = nt.hammerPullOrigin,
                                harmonic =
                                    HARMONICS[nt.harmonicType];
                            const note = {
                                time: t0,
                                // ПАТЧ Пюпитра (г): нотная длительность каждой ноты (сустейн у коротких — 0), лиги слиты
                                duration: t1 - t0,
                                sustain:
                                    nt.slideTarget ||
                                    nt.hasBend ||
                                    t1 - t0 >= 0.4
                                        ? t1 - t0
                                        : 0,
                                string: nt.string - 1,
                                fret: nt.fret,
                                chord,
                                hammerOn:
                                    !!origin &&
                                    nt.fret > origin.fret,
                                pullOff:
                                    !!origin &&
                                    nt.fret < origin.fret,
                                slideTo:
                                    nt.slideTarget &&
                                    (nt.fret || nt.slideTarget.fret) // from an open string to another is no slide
                                        ? nt.slideTarget.fret
                                        : null,
                                slideUnpitchTo: null,
                                slideIn:
                                    [null, "below", "above"][
                                        nt.slideInType
                                    ] ?? null,
                                slideOut:
                                    [
                                        null,
                                        null,
                                        null,
                                        "up",
                                        "down",
                                        "down",
                                        "up",
                                    ][nt.slideOutType] ?? null,
                                bend: nt.hasBend
                                    ? (nt.maxBendPoint?.value ??
                                          0) / 4
                                    : 0,
                                bendCurve: nt.hasBend
                                    ? curve(nt.bendPoints)
                                    : null,
                                whammy: curve(beat.whammyBarPoints),
                                harmonic:
                                    !!harmonic &&
                                    harmonic !== "pinch",
                                harmonicPinch: harmonic === "pinch",
                                harmonicType: harmonic,
                                palmMute: nt.isPalmMute,
                                mute: nt.isDead || beat.deadSlapped,
                                ghost: nt.isGhost,
                                staccato: nt.isStaccato,
                                letRing: nt.isLetRing,
                                accent:
                                    ACCENTS[nt.accentuated] ?? null,
                                dynamic: words(
                                    GP.DynamicValue[nt.dynamics],
                                ),
                                vibrato:
                                    nt.vibrato > 0 ||
                                    beat.vibrato > 0,
                                vibratoWide:
                                    nt.vibrato ===
                                        GP.VibratoType.Wide ||
                                    beat.vibrato ===
                                        GP.VibratoType.Wide,
                                trill:
                                    nt.trillValue >= 0
                                        ? nt.trillValue
                                        : null,
                                ornament:
                                    ORNAMENTS[nt.ornament] ?? null,
                                grace:
                                    beat.graceType !==
                                    GP.GraceType.None,
                                tremolo: beat.isTremolo,
                                tap: beat.tap,
                                tapLeft: nt.isLeftHandTapped,
                                slap: beat.slap,
                                pop: beat.pop,
                                golpe:
                                    [null, "thumb", "finger"][
                                        beat.golpe
                                    ] ?? null,
                                rasgueado: beat.rasgueado
                                    ? words(
                                          GP.Rasgueado[
                                              beat.rasgueado
                                          ],
                                      )
                                    : null,
                                fade:
                                    [
                                        null,
                                        "fade in",
                                        "fade out",
                                        "swell",
                                    ][beat.fade] ?? null,
                                wah:
                                    [null, "open", "closed"][
                                        beat.wahPedal
                                    ] ?? null,
                                fermata: !!beat.fermata,
                                pick:
                                    beat.notes.length > 1
                                        ? null
                                        : ([null, "up", "down"][
                                              beat.pickStroke
                                          ] ?? null),
                                showString: nt.showStringNumber,
                                finger:
                                    nt.leftHandFinger >= 0
                                        ? nt.leftHandFinger
                                        : null,
                                rightFinger:
                                    "pimac"[nt.rightHandFinger] ??
                                    null,
                                // ПАТЧ Пюпитра (в): звучащая высота по alphaTab (капо стана, строй, транспозиция,
                                // флажолет) и место ноты в порядке исполнения: такт (MasterBar.index) и проход (с 0)
                                realValue: nt.realValue,
                                harmonicValue: nt.harmonicValue,
                                // легато-слайд: целевая нота звучит без удара (у Shift — с ударом)
                                slideLegato: nt.slideOutType === GP.SlideOutType.Legato,
                                barIndex: master.index,
                                passIndex: pass - 1,
                            };
                            notes.push(
                                (lastOnString[nt.string] = note),
                            );
                            inBar.push(note);
                        }
                    }
                });
                phrases.push({
                    time: start,
                    endTime: end,
                    name: "",
                    maxDifficulty: inBar.length,
                });
            }
            notes.sort(
                (a, b) => a.time - b.time || a.string - b.string,
            );
            notes.forEach(
                (x, i) =>
                    x.chord !== null &&
                    chords[x.chord].notes.push(i),
            );
            if (staff.capo) {
                // Guitar Pro counts a capo'd chart's frets from the capo. Everything here is where the finger goes on the
                // board instead, so lift them onto it before the hand positions are worked out from them
                const up = (fret) =>
                    fret > 0 ? fret + staff.capo : fret; // an open string stays open: the capo is fretting it
                for (const x of notes) {
                    x.fret = up(x.fret);
                    if (x.slideTo !== null) x.slideTo = up(x.slideTo);
                    if (x.slideUnpitchTo !== null)
                        x.slideUnpitchTo = up(x.slideUnpitchTo);
                    if (typeof x.trill === "number")
                        x.trill = up(x.trill);
                }
                for (const c of chords) {
                    c.frets = c.frets.map(up);
                    if (c.barre) c.barre.fret = up(c.barre.fret);
                }
                for (const h of handShapes) h.frets = h.frets.map(up);
            }
            const suggested = suggestPositions(notes); // Guitar Pro files rarely say where the hand goes or which finger presses
            anchors.push(...suggested.anchors);
            for (const x of notes)
                x.finger ??= suggested.fingers.get(x) ?? null;
            for (const c of chords)
                for (const j of c.notes)
                    if (
                        c.fingers[notes[j].string] < 0 &&
                        notes[j].finger !== null
                    )
                        c.fingers[notes[j].string] =
                            notes[j].finger;
            const name = (
                track.name || `Track ${track.index + 1}`
            ).replace(/\s+-\s+.*$/, ""); // "Farin Gitarre - Electric Guitar (clean)" → "Farin Gitarre"
            return {
                name,
                program: track.playbackInfo.program,
                strings: staff.tuning.length,
                open: [...staff.tuning].reverse(),
                notes,
                chords,
                anchors,
                phrases,
                sections,
                beats,
                handShapes,
                markers,
                hairpins,
                rhythm,
                meters,
                keys,
                capos,
                // ПАТЧ Пюпитра (б): вместо ссылки на объект alphaTab `track` — его индекс и индекс стана
                // (staff.index — после prepareScore, среди станов со струнами); выход — чистые данные
                trackIndex: track.index,
                staffIndex: staff.index,
            };
        });
    // Lyrics from the first staff that has any, a syllable a beat: usually a vocal line, which gets no part of its
    // own. They read like this: "-" joins a syllable to the next, a "+" at its end ends the line.
    const lyrics = [];
    for (const staff of score.tracks.flatMap((track) => [
        ...track.staves,
        ...(track.unplayed ?? []), // a tab's notation staff, which is where MuseScore writes the words
    ])) {
        for (const mb of cache.masterBars)
            for (const beat of staff.bars[
                mb.masterBar.index
            ].voices.flatMap((voice) => voice.beats)) {
                if (!beat.lyrics?.[0]) continue;
                const time = sec(mb.start + beat.playbackStart);
                lyrics.push({
                    time,
                    length:
                        sec(
                            mb.start +
                                beat.playbackStart +
                                beat.playbackDuration,
                        ) - time,
                    text: beat.lyrics[0],
                });
            }
        if (lyrics.length) break;
    }
    lyrics.sort((a, b) => a.time - b.time); // sung in more voices than one: in the order they're heard
    for (const a of arrangements) a.lyrics = lyrics; // the notation page writes them under its systems
    return {
        title: score.title,
        artist: score.artist,
        bpm: score.tempo,
        length: sec(cache.masterBars.at(-1)?.end ?? 0),
        arrangements,
        lyrics,
        tempo,
    };
}

return { partStaff, prepareScore, songFromScore };
}
