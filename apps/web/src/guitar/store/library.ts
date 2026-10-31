// Библиотека приложения: одна база на вкладку (лениво, при первом обращении). Воркер разбора с alphaTab — отдельный
// чанк, который грузится только при первом импорте или рендере минуса: список песен читается из IndexedDB без него.
import type { ParseRequest, RenderRequest } from '../import/protocol';
import { loadDrumKit, loadSoundFont } from '../../lib/soundFont';
import { openGuitarDB } from './db';
import { createRepo, type GuitarRepo } from './repo';

const worker = () => import('../import/scoreClient').then((m) => m.scoreClient);
const parser = { parse: async (req: ParseRequest) => (await worker()).parse(req) };

/** Рендер синт-минуса в том же воркере (этап 11). */
export const renderBacking = async (req: RenderRequest) => {
  const [soundFont, drumKit] = await Promise.all([loadSoundFont(), loadDrumKit()]);
  return (await worker()).render({ ...req, ...(soundFont ? { soundFont } : {}), ...(drumKit ? { drumKit } : {}) });
};

let library: Promise<GuitarRepo> | null = null;

export function guitarLibrary(): Promise<GuitarRepo> {
  // соединение закрыто ради обновления схемы в другой вкладке — следующее обращение откроет новое
  library ??= openGuitarDB(undefined, () => (library = null)).then((db) => createRepo(db, parser));
  return library;
}
