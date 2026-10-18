# pupitre-native-audio

Нативный захват звука для Electron (этап 4 курса 2): cpal (WASAPI на Windows,
ALSA→PipeWire на Linux) + DSP-ядро `packages/dsp` прямо в аудиопотоке драйвера.
Наружу — N-API (napi-rs): `listDevices` / `start` / `setGate` / `stop`;
кадры анализа уходят батчами в раскладке `FRAME_FLOATS` (контракт
`AnalysisFrame::write` ↔ `decodeFrame` в `apps/web/src/audio/AudioInput.ts`).

## Сборка

```bash
node build.mjs   # cargo build --release → pupitre-native-audio.<platform>-<arch>.node
```

Linux: нужен `alsa-devel` (openSUSE) / `libasound2-dev` (Debian). Если dev-пакета
нет, build.mjs строит локальный shim (`.alsa-shim/`) поверх системной
`libasound.so.2` — alsa-sys использует pkg-config только для линковки,
биндинги предгенерены.

Windows: собирать на Windows-машине (`node build.mjs`, нужны Rust с таргетом
`x86_64-pc-windows-msvc` и Build Tools/MSVC) — получится
`pupitre-native-audio.win32-x64.node`, его подхватят dev-режим и
electron-builder (extraResources). Windows-релизы CI пока используют Worklet:
загрузка N-API-модуля в Electron на реальной Windows ещё не проверена.
Кросс-сборка с Linux не настроена: дистрибутивный Rust без windows-std
(нужны rustup + cargo-xwin), а замер задержки всё равно возможен только
на реальной Windows. Без `.node` приложение честно падает на worklet-путь.

## Как загружается

`apps/desktop/native-audio.js` ищет `.node` рядом с крейтом (dev) или в
`resources/native/` (packaged, см. extraResources в package.json десктопа).
Если аддона нет — рендерер остаётся на AudioWorklet-пути (фолбэк в
`audioSession.ensureMic`).

## Часы и задержка

`t` кадров — секунды от старта потока (счётчик сэмплов). Батч несёт `ageMs`
(возраст последнего кадра по таймстампам драйвера) и `postedAtMs` (epoch-мс) —
рендерер привязывает кадры к AudioContext-времени EMA-якорем
(`NativeAudioInput`). `StartInfo.analysisLatencyMs` включает оценку задержки
YIN, медианы/EMA и ФНЧ из ядра; UI добавляет возраст доставки. Старый замер
~12.9 мс не учитывал сглаживание и не отражал задержку видимого контура.

Моно-буфер захвата фиксированного размера, без выделения `Vec` на каждый
аудиоколбэк. Преобразование кадра в JS-массив выполняется в N-API-колбэке.

## E2E

```bash
cd apps/desktop
env -u ELECTRON_RUN_AS_NODE npx electron e2e/native-audio-main.js
```

Грабля: в терминалах VSCode стоит `ELECTRON_RUN_AS_NODE=1` — без `env -u`
electron стартует как голый node и `require('electron')` не даёт API.
