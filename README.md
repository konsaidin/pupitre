# Pupitre

**English** · [Русский](README.ru.md)

**Pupitre** is a practice app for voice and guitar. Sing into the mic or play your guitar, and the app hears your notes
in real time and shows whether you hit them. It runs in the browser and as a desktop app (Linux, Windows). The
interface is available in English and Russian.

| Voice | Guitar |
|---|---|
| ![Voice mode: overview](docs/screens/voice.png) | ![Guitar mode: 3D highway](docs/screens/guitar.png) |

## Features

**Voice**
- A one-minute range wizard: exercises and songs adapt to your voice.
- Warm-ups and exercises (long tones, sirens, scales, intervals, vibrato) are generated for your range; tempo, key and
  repeats are adjustable.
- Your own songs: upload mp3/wav/flac — the server separates the vocals (Demucs), extracts the melody (pYIN) and moves
  it into your octave. Sing over the instrumental, the original or the isolated vocal; notes can be fixed in an editor.
- Vocal ribbon and piano roll, techniques (vibrato, distortion), score, streak and results.

**Guitar**
- Import Guitar Pro (GP3–GP8, GPX) and MusicXML; a 3D note highway and a tablature view.
- The backing track is synthesized from the score: MuseScore General soundfont, the AVL Black Pearl drum kit, an amp
  model for distorted guitars. Your own part can be muted, quiet or as loud as the rest.
- Note and chord recognition with scoring: feedback on every hit, "early / late", "wrong note".
- Learn mode: the song waits on every note until you play it.
- "Input and sound" screen: interface and channel, level, monitoring. The Linux desktop app has a low-latency native
  engine (JACK/PipeWire, ≈ 7 ms round trip).
- Tuner: chromatic or by string, tuning presets (Standard, Drop D, D Standard, E♭, Drop C, 7-string, 4- and 5-string
  bass), adjustable A4; the measured tuning is saved.
- "Tone": a processor for hearing yourself — amp (clean, crunch, high gain), tone stack, 4×12 cabinet, noise gate,
  delay and room. One Rust core (`packages/dsp`) runs in the native engine and in the browser (WebAssembly).

## Download

Ready-made builds for Linux (`.AppImage`) and Windows (installer and portable `.exe`) are on the
[Releases](../../releases) page. They are built and published locally with `node tools/release.mjs X.Y.Z`
(checks, Linux and Windows packages, tag and GitHub Release); the GitHub Actions workflows in `.github/` are kept but
disabled.

macOS builds (`.dmg` for Apple Silicon and Intel) are made on a Mac with `npm run dist:mac` and attached to a release
when available. They are not notarized by Apple: after copying Pupitre to Applications, run
`xattr -cr /Applications/Pupitre.app` once, otherwise macOS says the app is damaged.

Warm-ups, exercises and guitar work right away. The song processing server is set up by the app itself the first time
you open "My songs": it downloads a Python environment, dependencies (≈ 2.5 GB, once) and ffmpeg. You can also point it
to an external server in Settings → Song processing server.

## Development

You need Node 22+, Rust (version in `rust-toolchain.toml`, target `wasm32-unknown-unknown`), and for the song server
Python 3.11+ and ffmpeg.

### Web

```bash
cd apps/web
npm install
npm run build:dsp                      # DSP core (Rust → WASM)
node ../../tools/soundfont/fetch.mjs   # guitar backing soundfont (≈ 40 MB, not stored in git)
npm run dev                            # http://localhost:5173
```

Browsers only allow microphone access on `localhost` or over HTTPS.

### Song server

```bash
cd services/api
python3 -m venv .venv
.venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000
```

The web dev server proxies `/api` to `127.0.0.1:8000`. The first Demucs run downloads the htdemucs model weights.
Without torch/demucs the server still works — the melody is taken from the full mix. On aarch64 (ARM servers) install
`demucs==4.0.1`: 4.1 has no prebuilt wheels for that platform. For access from other hosts set `PUPITRE_API_TOKEN` and
`PUPITRE_ALLOWED_ORIGINS` (see `services/api/README.md`).

### Desktop

```bash
cd apps/desktop
npm install
npm run dev     # builds the web app and native modules (Linux), then starts Electron
npm run dist    # packages in apps/desktop/release/
npm run dist:mac  # on a Mac: .dmg for Apple Silicon and Intel (Xcode Command Line Tools, rustup)
```

`dist:mac` signs with a Developer ID certificate if one is in the keychain (or `CSC_LINK`), otherwise ad-hoc.

### Self-hosting the browser version

`node apps/desktop/build-web.mjs` builds `apps/web/dist` (including the soundfont). Any static server with HTTPS will
do; `tools/deploy/static-https.mjs` is a minimal dependency-free server that also proxies `/api` to the song server.

## Repository layout

```
apps/web               web app (React + TypeScript + Vite): voice, guitar, the "Rampa" design system
apps/desktop           Electron shell, bundled song server, bridges to native modules
packages/dsp           Rust DSP core (YIN, vocal techniques) → WASM and a native library
packages/engine        low-latency guitar audio engine (Rust, JACK, N-API)
packages/native-audio  native voice capture (Rust, cpal, N-API)
services/api           song server (FastAPI, Demucs, pYIN)
tools/gates            build checks: bundle budget, source rules, licenses, vocal-mode protection
content                license registry for fonts, icons and soundfonts
```

## Checks

```bash
cd apps/web && npm test                    # unit tests (vitest)
node tools/gates/check-build.mjs           # build + entry bundle budget
node tools/gates/check-sources.mjs         # guitar section source rules
node tools/gates/check-licenses.mjs        # dependency and content licenses
node tools/gates/check-vocal.mjs --browser # vocal mode intact (golden files + Firefox e2e)
```

End-to-end scenarios for Firefox and Electron live in `apps/web/e2e` and `apps/desktop/e2e` (see
`apps/web/e2e/lib/README.md`). Code comments and internal docs are in Russian.

## License

[MIT](LICENSE). Third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
