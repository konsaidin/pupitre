// Саундфонт синт-минуса гитарного раздела: MuseScore General (MIT; public/licenses/MuseScore_General-MIT.md) — живее
// встроенного в alphaTab SONiVOX. Лежит в public/soundfonts (≈ 40 МБ, в чанки не встраивается): в Electron под file://
// fetch не работает — байты отдаёт главный процесс (window.pupitreAssets), в браузере — fetch. Нет файла — null, рендер
// остаётся на SONiVOX. Загружается один раз на вкладку.
export const SOUND_FONT_PATH = 'soundfonts/MuseScore_General.sf3';

interface AssetsBridge {
  soundFont(): Promise<Uint8Array | null>;
}

let pending: Promise<Uint8Array | null> | null = null;

export function loadSoundFont(): Promise<Uint8Array | null> {
  pending ??= (async () => {
    try {
      const bridge = (window as { pupitreAssets?: AssetsBridge }).pupitreAssets;
      if (bridge) return await bridge.soundFont();
      if (location.protocol === 'file:') return null;
      const res = await fetch(new URL(SOUND_FONT_PATH, document.baseURI));
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  })();
  return pending;
}
