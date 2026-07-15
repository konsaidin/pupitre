/// <reference types="vite/client" />

// WASM DSP-ядра инлайнится в бандл как data-URI:
// под file:// в Electron fetch ассетов не работает
declare module '*.wasm?inline' {
  const dataUri: string;
  export default dataUri;
}
