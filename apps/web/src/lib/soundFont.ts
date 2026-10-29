// Саундфонты синт-минуса гитарного раздела: MuseScore General (MIT; public/licenses/MuseScore_General-MIT.md) — живее
// встроенного в alphaTab SONiVOX — и кит ударных AVL Black Pearl (CC BY-SA 3.0; public/licenses/AVL-Drumkits.md).
// Лежат в public/soundfonts (≈ 40 и 19 МБ, в чанки не встраиваются): в Electron под file:// fetch не работает — байты
// отдаёт главный процесс (window.pupitreAssets), в браузере — fetch. Нет файла — null: рендер остаётся на SONiVOX и
// ударных саундфонта. Каждый загружается один раз на вкладку.
export const SOUND_FONT_PATH = 'soundfonts/MuseScore_General.sf3';
export const DRUM_KIT_PATH = 'soundfonts/Black_Pearl_4_LV2.sf2';

interface AssetsBridge {
  soundFont(): Promise<Uint8Array | null>;
  /** Нет у сборок до кита ударных. */
  drumKit?(): Promise<Uint8Array | null>;
}

async function asset(path: string, viaBridge: (bridge: AssetsBridge) => Promise<Uint8Array | null> | undefined): Promise<Uint8Array | null> {
  try {
    const bridge = (window as { pupitreAssets?: AssetsBridge }).pupitreAssets;
    if (bridge) return (await viaBridge(bridge)) ?? null;
    if (location.protocol === 'file:') return null;
    const res = await fetch(new URL(path, document.baseURI));
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

let soundFont: Promise<Uint8Array | null> | null = null;
let drumKit: Promise<Uint8Array | null> | null = null;

export function loadSoundFont(): Promise<Uint8Array | null> {
  soundFont ??= asset(SOUND_FONT_PATH, (b) => b.soundFont());
  return soundFont;
}

export function loadDrumKit(): Promise<Uint8Array | null> {
  drumKit ??= asset(DRUM_KIT_PATH, (b) => b.drumKit?.());
  return drumKit;
}
