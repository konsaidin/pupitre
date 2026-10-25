// Библиотека приложения: одна база на вкладку (лениво, при первом обращении). Воркер разбора с alphaTab — отдельный
// чанк, который грузится только при первом импорте или рендере минуса: список песен читается из IndexedDB без него.
import type { ParseRequest, RenderRequest } from '../import/protocol';
import { openGuitarDB } from './db';
import { createRepo, type GuitarRepo } from './repo';

const worker = () => import('../import/scoreClient').then((m) => m.scoreClient);
const parser = { parse: async (req: ParseRequest) => (await worker()).parse(req) };

/** Рендер синт-минуса в том же воркере (этап 11). */
export const renderBacking = async (req: RenderRequest) => (await worker()).render(req);

let library: Promise<GuitarRepo> | null = null;

export function guitarLibrary(): Promise<GuitarRepo> {
  library ??= openGuitarDB().then((db) => createRepo(db, parser));
  return library;
}
