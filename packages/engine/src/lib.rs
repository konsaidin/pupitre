//! Нативный звуковой движок Пюпитра (01-architecture §8, этап 41): дуплекс JACK (у PipeWire — pipewire-jack), граф входа
//! (канал или смесь, DC-блок) и мониторинга (плавный гейн, мягкое ограничение, глушение), метры, замер задержки
//! туда-обратно, лестница буфера по срывам. N-API — фича addon (загрузчик apps/desktop/engine.js).
pub mod analysis;
pub mod engine;
pub mod graph;
pub mod io;
pub mod rtl;

#[cfg(feature = "addon")]
mod addon;
