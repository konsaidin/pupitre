// Все входы выбранного набора: без выборки и без усечения до ожидаемого N.
import { inspect } from '../../../tools/datasets/verify.mjs';

export async function run(ctx) {
  const result = { metrics: {}, registry: {}, failures: [] as string[] };
  for (const id of ctx.sets) {
    const set = ctx.registry[id];
    if (set.localOnly) { ctx.skip(id, 'localOnly'); continue; }
    const found = await inspect(id, ctx.dataRoot, false);
    if (!found.fetched) { ctx.skip(id, 'NOT FETCHED'); continue; }
    result.failures.push(...found.failures);
    for (const [part, list] of Object.entries(found.parts)) {
      result.registry[`${id}/${part}`] = { n: (list as string[]).length, expected: set.parts[part].expect };
    }
    if (id === 'guitarset') {
      const labels = { 'mono-mic': 'gs_mic', 'mono-pickup': 'gs_pickup', annotation: 'annotation' };
      ctx.log(Object.entries(labels).map(([part, label]) => `${label} ${found.parts[part].length}/${set.parts[part].expect}`).join(', '));
      const ids = Object.fromEntries(Object.entries(found.parts).map(([part, list]) => [part,
        new Set((list as string[]).map(p => p.split('/').pop()!.replace(/(?:_mic\.wav|_mix\.wav|\.jams)$/, ''))),
      ]));
      const union = new Set(Object.values(ids).flatMap(s => [...s]));
      for (const record of [...union].sort()) {
        const absent = Object.keys(ids).filter(part => !ids[part].has(record));
        if (absent.length) result.failures.push(`${id}: непарная/лишняя запись ${record}; нет: ${absent.join(', ')}`);
      }
    } else {
      ctx.log(`${id}: ` + Object.entries(found.parts).map(([part, list]) => `${part} ${(list as string[]).length}/${set.parts[part].expect}`).join(', '));
    }
  }
  return result;
}
