// DSP-ядро Pupitre: f0 (YIN) + вокальные техники (вибрато, расщепление,
// громкость, придыхание). Одно на все платформы:
//   - wasm32-unknown-unknown → AudioWorklet (веб/Electron);
//   - cdylib → нативный захват (Electron N-API, Android JNI).
//
// Экспорт — чистый C-ABI без wasm-bindgen: в AudioWorkletGlobalScope нет
// TextDecoder/fetch, bindgen-глю там не живёт. Протокол: JS пишет сэмплы в
// in_ptr, зовёт dsp_process(n), читает n_frames × FRAME_FLOATS f32 из out_ptr.

mod analyzer;
mod distortion;
mod loudness;
mod smooth;
mod vibrato;
mod yin;

pub use analyzer::{Analyzer, AnalysisFrame, FRAME_FLOATS, HOP};

use core::ptr::addr_of_mut;

/// максимум сэмплов на один вызов dsp_process
const IN_CAP: usize = 4096;
const OUT_CAP_FRAMES: usize = IN_CAP / HOP + 2;

struct State {
    analyzer: Analyzer,
    input: [f32; IN_CAP],
    output: [f32; OUT_CAP_FRAMES * FRAME_FLOATS],
}

static mut STATE: Option<Box<State>> = None;

// WASM в AudioWorklet однопоточный; static mut безопасен по построению.
unsafe fn state() -> &'static mut Option<Box<State>> {
    &mut *addr_of_mut!(STATE)
}

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

#[no_mangle]
pub extern "C" fn dsp_in_ptr() -> *mut f32 {
    unsafe { state().as_mut().map_or(core::ptr::null_mut(), |s| s.input.as_mut_ptr()) }
}

#[no_mangle]
pub extern "C" fn dsp_out_ptr() -> *const f32 {
    unsafe { state().as_ref().map_or(core::ptr::null(), |s| s.output.as_ptr()) }
}

#[no_mangle]
pub extern "C" fn dsp_frame_floats() -> usize {
    FRAME_FLOATS
}

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
