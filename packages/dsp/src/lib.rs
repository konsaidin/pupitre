// DSP-ядро Pupitre: f0 (YIN) + вокальные техники (вибрато, расщепление,
// громкость, придыхание) и гитарный процессор (tone.rs). Одно на все платформы:
//   - wasm32-unknown-unknown → AudioWorklet (веб/Electron);
//   - cdylib → нативный захват (Electron N-API, Android JNI).
//
// Экспорт — чистый C-ABI без wasm-bindgen: в AudioWorkletGlobalScope нет
// TextDecoder/fetch, bindgen-глю там не живёт. Протокол: JS пишет сэмплы в
// in_ptr, зовёт dsp_process(n), читает n_frames × FRAME_FLOATS f32 из out_ptr.
// Процессор — отдельный tone.wasm (фича tone; dsp.wasm — фича analysis): своё состояние и функции tone_*: сэмплы →
// tone_buf_ptr, tone_process(n) обрабатывает их на месте.

mod analyzer;
mod decimate;
mod distortion;
mod loudness;
mod smooth;
pub mod tone;
mod vibrato;
mod yin;

pub use analyzer::{Analyzer, AnalysisFrame, FRAME_FLOATS, HOP};
pub use tone::Tone;

use core::ptr::addr_of_mut;

/// максимум сэмплов на один вызов dsp_process
const IN_CAP: usize = 4096;
#[cfg(feature = "analysis")]
const OUT_CAP_FRAMES: usize = IN_CAP / HOP + 2;

#[cfg(feature = "analysis")]
struct State {
    analyzer: Analyzer,
    input: [f32; IN_CAP],
    output: [f32; OUT_CAP_FRAMES * FRAME_FLOATS],
}

#[cfg(feature = "analysis")]
static mut STATE: Option<Box<State>> = None;

// WASM в AudioWorklet однопоточный; static mut безопасен по построению.
#[cfg(feature = "analysis")]
unsafe fn state() -> &'static mut Option<Box<State>> {
    &mut *addr_of_mut!(STATE)
}

#[cfg(feature = "analysis")]
#[no_mangle]
pub extern "C" fn dsp_init(sample_rate: f32) {
    unsafe {
        *state() = Some(Box::new(State {
            analyzer: Analyzer::new(sample_rate),
            input: [0.0; IN_CAP],
            output: [0.0; OUT_CAP_FRAMES * FRAME_FLOATS],
        }));
    }
}

#[cfg(feature = "analysis")]
#[no_mangle]
pub extern "C" fn dsp_in_ptr() -> *mut f32 {
    unsafe { state().as_mut().map_or(core::ptr::null_mut(), |s| s.input.as_mut_ptr()) }
}

#[cfg(feature = "analysis")]
#[no_mangle]
pub extern "C" fn dsp_out_ptr() -> *const f32 {
    unsafe { state().as_ref().map_or(core::ptr::null(), |s| s.output.as_ptr()) }
}

#[cfg(feature = "analysis")]
#[no_mangle]
pub extern "C" fn dsp_frame_floats() -> usize {
    FRAME_FLOATS
}

#[cfg(feature = "analysis")]
#[no_mangle]
pub extern "C" fn dsp_latency_ms() -> f32 {
    unsafe { state().as_ref().map_or(0.0, |s| s.analyzer.latency_ms()) }
}

#[cfg(feature = "analysis")]
#[no_mangle]
pub extern "C" fn dsp_set_gate(gate_rms: f32, gate_clarity: f32) {
    unsafe {
        if let Some(s) = state().as_mut() {
            s.analyzer.set_gate(gate_rms, gate_clarity);
        }
    }
}

/// Обработать n сэмплов из входного буфера; вернуть число готовых кадров
/// в выходном буфере (каждый — FRAME_FLOATS f32 подряд).
#[cfg(feature = "analysis")]
#[no_mangle]
pub extern "C" fn dsp_process(n: usize) -> usize {
    unsafe {
        let Some(s) = state().as_mut() else { return 0 };
        let n = n.min(IN_CAP);
        let mut count = 0usize;
        let State { analyzer, input, output } = s.as_mut();
        analyzer.process(&input[..n], |frame| {
            if count < OUT_CAP_FRAMES {
                frame.write(&mut output[count * FRAME_FLOATS..(count + 1) * FRAME_FLOATS]);
                count += 1;
            }
        });
        count
    }
}

// ——— гитарный процессор (tone.wasm) ———

#[cfg(feature = "tone")]
struct ToneState {
    tone: Tone,
    buf: [f32; IN_CAP],
}

#[cfg(feature = "tone")]
static mut TONE: Option<Box<ToneState>> = None;

#[cfg(feature = "tone")]
unsafe fn tone_state() -> &'static mut Option<Box<ToneState>> {
    &mut *addr_of_mut!(TONE)
}

#[cfg(feature = "tone")]
#[no_mangle]
pub extern "C" fn tone_init(sample_rate: f32) {
    unsafe {
        *tone_state() = Some(Box::new(ToneState { tone: Tone::new(sample_rate), buf: [0.0; IN_CAP] }));
    }
}

#[cfg(feature = "tone")]
#[no_mangle]
pub extern "C" fn tone_buf_ptr() -> *mut f32 {
    unsafe { tone_state().as_mut().map_or(core::ptr::null_mut(), |s| s.buf.as_mut_ptr()) }
}

#[cfg(feature = "tone")]
#[no_mangle]
pub extern "C" fn tone_set(id: u32, value: f32) {
    unsafe {
        if let Some(s) = tone_state().as_mut() {
            s.tone.set(id, value);
        }
    }
}

/// Обработать на месте n сэмплов буфера (не больше его ёмкости).
#[cfg(feature = "tone")]
#[no_mangle]
pub extern "C" fn tone_process(n: usize) {
    unsafe {
        if let Some(s) = tone_state().as_mut() {
            let ToneState { tone, buf } = s.as_mut();
            tone.process(&mut buf[..n.min(IN_CAP)]);
        }
    }
}
