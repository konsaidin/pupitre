# Вендор fretfall/player

Рендерер 3D-дорожки, музыкальные помощники, аппликатура, синхронизация и конвертер партитуры из открытого проекта
[fretfall/player](https://github.com/fretfall/player) (MIT, © 2026 Angelo Dini — `LICENSE` рядом).

- Версия: `@fretfall/player` 0.5.0
- Коммит: `ed2bc3bbb52e4ce7c840c28d8ffbd54d7e34670f`
- Источник копии: архив коммита с GitHub, распакован вне репозитория в
  `~/.cache/pupitre/vendor-src/fretfall-ed2bc3bbb52e4ce7c840c28d8ffbd54d7e34670f/`
- Не вендорятся: `player.js` (кроме вырезки ниже), `mount.js`, `mount.d.ts`, демо, документация, скрипты.

## Файлы без изменений

| Файл | SHA-256 | Сверка |
|---|---|---|
| `LICENSE` | `560cb98de97e83fc25542efdd90e7ab60fa0f824bb9a3d0152c0141b97935da3` | как в апстриме |
| `music.js` | `5f259fd72a820def80d7b0ba2c9bec2d8b98105b295a573711ab6e2bc54cd6a3` | как в апстриме |
| `fingering.js` | `9e6a93281efb53e4ef8d83a93cd615dd24e0ff4adf0351621a4484eac8b7953c` | как в апстриме |
| `sync.js` | `7beacf9103eb7b192b108a61730ec8ec186cdcc0e8f9c37a54c4793046601c7b` | как в апстриме |
| `perf.js` | `e262d76b7e68be68345f6d682d0eabfa801db15b41e1978f1fa2ebaa398eb204` | как в апстриме |
| `highway.test.mjs` | `9407f2d88a2a7304fd8c2790825909917bf335eedb6f9fefe7bd9cbdf7a4757c` | как в апстриме |
| `themes.test.mjs` | `a382ba95cfe6fe408159b31841873396f1a00699936bfe3103bd455b5b5c195a` | как в апстриме |
| `music.test.mjs` | `6810eff0c19e884517ba10d7f31ca26707a7641596993771b815580329b5e045` | как в апстриме |
| `fingering.test.mjs` | `64696e67a36c2f3376289563ca1cca3c63e8914c18a385132e585bad0a9c0c08` | как в апстриме |
| `sync.test.mjs` | `b0447d16f41c47cce10044a79916bd4826cda5a45618a868e5209406a0083fc9` | как в апстриме |

Апстрим-тесты запускаются как есть: `npm --prefix apps/web run test:vendor` (`node --test`). Ожидания апстрим-тестов
не менялись — патчи их не задевают.

## Файлы с патчами

| Файл | SHA-256 | Апстрим |
|---|---|---|
| `themes.js` | `2caf217de54cb63564457cd496abab4cb8a8bdbc10e670f8606546f1168e12ed` | `src/themes.js` — `96600546fe3701d69ce38138c6536e4e4dfb7046957165004ed9f87d5ee16260` |
| `highway.js` | `35ea089e6f50c84f7116ed3c3f95f9f8cec18f5fe7f83428c6f0b0b5ff2a4e79` | `src/highway.js` — `8e4fb621e52d1e79a06850a19adb1476fc9b3a84ec6f2b7ae24aeb076b8e4357` |
| `fromScore.js` | `736d109626a12f6aa34f7733efe5c953f7d10d03fcebbdf164fbd7e9019d0bc5` | вырезка из `src/player.js` — `e83a4e18d1e1f9657d9acc0faa86dbb1094cec7d6eb6bbe7a3ffdb44df900cdf` |

### Патч 1 — `themes.js`: без Google Fonts

`FONTS.*.href` (3 строки, `src/themes.js:48,52,56`) → `null`. Инвариант 20: под file:// никаких CDN; шрифты раздела —
локальные (`guitar/ui/fonts/`). `themes.test.mjs` проверяет только имена и цвета — проходит без изменений.

### Патчи этапа 10 — `themes.js` (6) и `highway.js` (1–5, 7–9)

Каждое место помечено «ПАТЧ Пюпитра (N)». Апстрим-тесты (`highway.test.mjs`, `themes.test.mjs`) проходят без изменения
ожиданий.

1. **Лад или палец на ноте, DOM-слой меток.** `t.gemLabel` — `'fret'` (Рампа) или палец (апстрим) — и на ноте, и на метке
   «куда нажимать» на грифе (иначе нота «7», долетев, становилась «1» — пальцем позиции). При `t.gemSink` цифры
   на нотах не рисуются на канвасе: в массив уходят `{ text, x, y, size, alpha }` в CSS-пикселях — их рисует DOM-слой,
   чёткий при любом масштабе рендера.
2. **Статусы событий.** `arr.status` — `Uint8Array` по индексу ноты в `arr.notes`, коды `STATUS` (none, attacked, hit,
   early, late, wrong, missed). Есть `arr.status` — струна горит и вспыхивает только у попаданий (белое ядро → цвет струны
   → прозрачно, кольцо расходится за 180 мс); промах и не та нота — серая нота с красной кромкой. Нет — как в апстриме.
3. **Проекция для DOM-слоёв.** `cam.project(fret, string, sec)` → `{ x, y, k }` в CSS-пикселях канваса последнего кадра.
4. **Масштаб рендера вместо DPR.** `clearCanvas(canvas, t.renderScale)`: буфер = CSS-размер × renderScale (≤ 2; без него —
   DPR ≤ 2) — во всех трёх видах.
5. **Левша.** Зеркало экрана в `P()` после расчёта сдвигов камеры; подписи меняют сторону выравнивания, глифы текста на
   полу не зеркалятся (ось x их матрицы обращена). Не доделано: строка разметки тактов у левши остаётся выровненной вправо.
6. **Тема Рампы.** `COLORS.rampa`, `FONTS.rampa` (`href: null`), `STRINGS.cb`, `DEFAULT_STYLE` — ровно ui-spec §10.1.
7. **Камера без доводки.** `moveCamera(…, snap)`; `drawHighway` передаёт `t.reduceMotion` — кадр встаёт сразу.
8. **«Софит» позиции руки.** Свет на полу от линии удара с затуханием и еле заметный конус к точке схода — два кэшируемых
   градиента; `t.soffit === false` выключает (адаптивное качество).
9. **Без размытия тени.** В нотном листе и табулатуре `shadowBlur` заменён ореолом из широких полупрозрачных обводок
   (как `glow` в 3D-дорожке) — инвариант 19; в файле его больше нет.
10. **Отклик от момента вердикта.** `arr.statusAt` — `Float64Array` секунд песни, когда сменился статус ноты (NaN — не
   менялся; отмечает вызывающий, `stampStatuses` в `guitar/highway/adapter.ts`). Есть `arr.statusAt` — вспышка попадания
   (и слабая «удар замечен») ведётся от него 200 мс и рисуется поверх нот; промах и не та нота гаснут на грифе серыми с
   красной кромкой 450 мс — и у нот, уже ушедших с дорожки (вердикт приходит после удара). `cam.projectAbove(i)` — место
   подписи вердикта над грифом на ладу ноты. Без `arr.statusAt` — как в патче (2).

### Вырезка `fromScore.js` из `player.js`

Код апстрима перенесён построчно, без переформатирования (тело `createConverter` не сдвинуто вправо), чтобы сравнение
показывало только патчи. Диапазоны — по содержимому на коммите `ed2bc3b`:

| Строки `player.js` | Что | В `fromScore.js` |
|---|---|---|
| 1439–1445 | комментарий и `partStaff` | как есть |
| 1446–1451 | тело обработчика `api.scoreLoaded` (станы со струнами, `track.unplayed`, перенумерация) | функция `prepareScore(score)` (патч а) |
| 1452–1455 | выбор дорожки для отрисовки alphaTab (`api.renderTracks`) | не берётся — это UI плеера |
| 1551–1625 | `GP`, `words`, `curve`, `HARMONICS`, `ACCENTS`, `ORNAMENTS`, `OTTAVAS`, `KEYS`, `jump` | как есть |
| 1627 | `let builtCache` — состояние плеера | не берётся |
| 1628–2149 | `songFromScore(score, cache)` | патчи б, в, г |

Импорты вырезки: `tempoMap`, `tickToMs` — из `music.js`; `suggestPositions` — из `fingering.js` (в `player.js` — те же
модули).

- **Патч (а) — фабрика.** `player.js` берёт глобальный `alphaTab` (скрипт с CDN). Здесь всё обёрнуто в
  `export function createConverter(alphaTab)`, наружу — `{ partStaff, prepareScore, songFromScore }`. Нужен только
  `alphaTab.model`; модуль alphaTab импортирует вызывающий (воркер разбора, этап 6).
- **Патч (б) — без ссылки на объект alphaTab.** В партии вместо `track` — `trackIndex: track.index` и
  `staffIndex: staff.index` (индекс после `prepareScore`). Выход — чистые данные: переживает `structuredClone`
  и `postMessage` из воркера (тест «патч (б)»).
- **Патч (в) — поля нот.** Каждая нота несёт `realValue` и `harmonicValue` alphaTab (звучащая высота: капо стана, строй,
  транспозиция, флажолет), `slideLegato` (слайд Legato — целевая нота без удара) и место в порядке исполнения: `barIndex`
  (`MasterBar.index`) и `passIndex` (проход такта, с 0).
  Ноты для дорожки адаптер строит без `barIndex`/`passIndex`: `markRepeats` сравнивает поля нот (см. `fromScore.d.ts`).
- **Патч (г) — нотная длительность.** У каждой ноты — `duration` (секунды, `t1 − t0` бита), лига удлиняет её вместе с
  `sustain`. Конвертер отдаёт только `sustain`, а он у коротких нот 0 — модели нужна нотная длительность (`TabNote.durTicks`).
  Внутри `songFromScore` поля нот не сравниваются (`markRepeats` вызывает адаптер дорожки), поэтому патч на выход не влияет.

## Объявления типов

Свои, по факту исходника (tsconfig без `allowJs`): `fromScore.d.ts`, `highway.d.ts`, `music.d.ts`, `fingering.d.ts`,
`sync.d.ts`, `themes.d.ts`. У `perf.js` объявлений нет: его импортирует только `highway.js`. Согласованность объявлений
с кодом проверяет `fromScore.test.ts` (vitest, своя alphaTex-фраза).

## Исключения grep-гейта

`perf.js` только читает `shadowBlur` в своём счётчике (исключение в `tools/gates/sources-allowlist.json`); в `highway.js`
его нет с патча 9 (этап 10).

## Как сверить с апстримом

```sh
V=~/.cache/pupitre/vendor-src/fretfall-ed2bc3bbb52e4ce7c840c28d8ffbd54d7e34670f
diff "$V/src/themes.js" themes.js                       # только патч 1
{ sed -n '1439,1451p' "$V/src/player.js"; sed -n '1551,1625p' "$V/src/player.js"; sed -n '1628,2149p' "$V/src/player.js"; } \
  | diff -b - fromScore.js                              # шапка, обёртка (а) и патчи б, в
```
