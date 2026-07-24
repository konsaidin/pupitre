# pupitre-dsp

DSP-ядро на Rust: f0 (YIN) + вокальные техники (вибрато, расщепление, громкость,
придыхание). Одно на все платформы: WASM для веба/Electron, cdylib для
нативного захвата (Electron N-API, Android JNI — этапы 4–5 PLAN.md).

## Сборка и тесты

```bash
cargo test                # юнит-тесты на синтетике (тон, вибрато, субгармоника)
npm run build:dsp         # из apps/web: wasm-сборка + копия в src/assets/dsp.wasm
```

Артефакт `apps/web/src/assets/dsp.wasm` закоммичен, чтобы сборка фронта не
требовала Rust-тулчейна. После правок ядра — пересобрать и закоммитить вместе.

## Контракты

- Экспорт — чистый C-ABI (без wasm-bindgen: в AudioWorkletGlobalScope нет
  TextDecoder). Протокол: сэмплы → `dsp_in_ptr`, вызов `dsp_process(n)`,
  чтение кадров из `dsp_out_ptr`.
- Раскладка кадра (`FRAME_FLOATS` f32) — контракт между `AnalysisFrame::write`
  (analyzer.rs) и декодером в `apps/web/src/audio/WorkletAudioInput.ts`. Меняются
  только синхронно.
- Инвариант: детекторы техник читают СЫРОЙ f0-контур (midi_raw), медиана+EMA —
  только для сглаженного центра (midi).
