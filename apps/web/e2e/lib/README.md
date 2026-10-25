# Обвязка e2e

Node.js, системный `/usr/bin/firefox`, установленный Vite в `apps/web/node_modules`.
Инструменты ставятся **вне репозитория**, package.json и lock приложения не меняются:

```sh
npm i --prefix ~/.cache/pupitre/tools/e2e puppeteer-core@24.43.1 pixelmatch@8.0.0 pngjs@7.0.0
node apps/web/e2e/smoke-vocal-home.mjs
node apps/web/e2e/vocal-ribbon.mjs
node apps/web/e2e/run-legacy.mjs live-tract.cjs
node apps/web/e2e/guitar-shots.mjs --self-test
node apps/web/e2e/guitar-shots.mjs
node tools/gates/check-vocal.mjs --browser
```

Установлены указанные версии: puppeteer-core 24.43.1, pixelmatch 8.0.0, pngjs 7.0.0.
ESM загружается через createRequire из `~/.cache/pupitre/tools/e2e/node_modules`;
легаси получает тот же каталог через NODE_PATH. При отсутствии пакета выводится команда установки.

`startVite({port})` возвращает `{url, close}`. Без порта выбирается свободный порт ОС
(Vite 6 сам заменяет 0 на 5173); при заданном порте действует strictPort.
`launchFirefox({phone, reducedMotion, prefs})` возвращает Browser с фейковым микрофоном.
Сначала `page.goto(url)`, затем `seedAndReload(page, {lang, profile, guitar})`:
язык и профиль читаются при старте React. Пустой профиль дополняется DEFAULTS в
`src/lib/profile.ts`; по умолчанию язык ru. Телефон 844×390 требует грубого указателя,
а не только изменения viewport: префы `ui.primaryPointerCapabilities` и
`ui.allPointerCapabilities` равны 1. Reduced motion: `ui.prefersReducedMotion = 1`.

`journal(page)` подключается **до навигации**; `all()`, `errors()`, `print()`, `detach()`.
`shoot(page, path, {width, height})` ждёт шрифты и два кадра, снимает viewport при DPR 1.
`scenario(async track => {...})` печатает последней строкой E2E_PASS либо E2E_FAIL
и выставляет 0/1. Подключите журнал через `track(page)`, ресурсы закрывайте в finally.
Предупреждения и запросы сохраняются; pageerror, console.error и requestfailed входят в errors().
Легаси сохраняет исходный вывод и код, его PNG лежат в `~/.cache/pupitre/e2e/legacy-*`.
Порт 5173 должен быть свободен. Фейковый микрофон не требует физического устройства;
живому тракту всё ещё нужен работающий AudioContext в системном Firefox.

## Снимки и будущие экраны

`PUPITRE_DESIGN_DIR` заменяет `~/.claude/plans/pupitre/guitar-mode/design`.
Там нужны mockups.html, fonts/ и shots/. Артефакты лежат в
`~/.cache/pupitre/shots/<ISO-время>-<pid>/`. Эталоны не перезаписываются.
Самопроверка снимает file://mockups.html#system: viewport 1440×900, scroll 0,
DPR 1, document.fonts.ready; это не system-1440x900-full.png.
Pixelmatch threshold 0.1, максимум 2 % пикселей вне масок; маски при самопроверке не нужны.

Каркас: `node apps/web/e2e/guitar-shots.mjs system [--lang en]`.
Реальные экраны и сиды добавляются с этапа 8; сейчас без аргументов SHOTS 0/0 и UI-REG 0/0.
Неизвестный/нереализованный экран проваливается, не считается пройденным.
В `shots-masks.json` у `screens.<имя>` можно задать:

```json
{
  "route": "#/guitar/_system",
  "seed": "system",
  "guitar": {},
  "cta": ".rp-button--primary",
  "boxes": [".rp-topbar"],
  "masks": [{"x": 10, "y": 20, "width": 30, "height": 40, "size": "1440x900", "why": "Живое число"}]
}
```

`size` у маски необязателен. Маски исключаются и из числителя, и из знаменателя.
Рамки `.rp-*` сверяются с DOM макета ±6 px. CTA обязателен для проверки Tab/фокуса.
RU: корень, телефонный режим, реальные загруженные и вычисленные шрифты, отсутствие
легаси/select, Tab, сохранение текста в отдельном reduced-motion Firefox, снимок и рамки.
EN: проверка переполнений без сравнения с русским эталоном. Ошибки страницы/сети/консоли
проваливают оба режима. Для canvas play/play-tab каркас явно требует будущий структурный гейт.
Дополнительные размеры, отбор по этапу-владельцу и e2e-позиции реестра добавляются вместе
с экранами: пока проверяются все DOM-позиции выбранного экрана на обоих размерах.
Форма DOM-позиции `ui-registry.json`: `{ "screen": "system", "dataUi": "system.example",
"seed": "system", "check": "dom" }`; иные виды проверки сейчас явно проваливаются.

## Electron и окружение

```sh
VITE_PUPITRE_GUITAR=1 npm --prefix apps/web run build
node apps/desktop/copy-web.mjs
cd apps/desktop
env -u ELECTRON_RUN_AS_NODE npx electron e2e/<сценарий>.js
```

VSCode часто выставляет ELECTRON_RUN_AS_NODE: его надо удалить из окружения Electron.
`const { guitarApp } = require('./lib/guitar-app')`; вызов до app.whenReady():
`const helper = await guitarApp({scaleFactor: 1})`, затем
`await helper.scenario(async () => { await helper.run('...'); })`.
Доступны win, userData, run(js), pass(), fail(error). loadFile открывает dist-web;
таймаут 30 с, профиль временный и сохраняется для диагностики, аудиобэкенд не запускается.

На Firefox 151.0.1 текущий вокальный emoji.woff2 вызывает pageerror «no supported glyph
 data table(s) present» / «rejected by sanitizer». Шрифт не меняем: smoke и vocal-ribbon
явно передают `track(page, {knownPreexisting: [emojiWoff2Firefox]})`.
`journal(page, {knownPreexisting})` принимает список `{id, why, match: {type, textIncludes}}`:
тип и **все** непустые подстроки должны совпасть. Такое событие сохраняется в `all()`
с `knownPreexisting: id`, сразу печатается `KNOWN_PREEXISTING <id>: …`, исключается
из `errors()`. Любая другая ошибка остаётся ошибкой. По умолчанию список пуст,
включая все проверки гитарных экранов. Допуск не скрывает событие из полного журнала.
Без API также возможен серверный ECONNREFUSED /api/songs; он не является pageerror.

Защищённый ribbon.cjs не меняется: его `.card-head .btn.primary` устарел с коммита
3174d86. В `check-vocal.mjs --browser` он явно SKIPPED с причиной и заменён
vocal-ribbon.mjs, затем запускается legacy live-tract.cjs. Новый сценарий использует
`.exercise-card-actions .btn.primary`, `.setup-start` и прежние переключатели игры.
Профиль явно выбирает ribbon и прокрутку (текущий дефолт — roll); сохраняются старые
проверки: >2000 цветных пикселей слева от «сейчас», >500 светлых пикселей клавиатуры,
переключение на roll и обратно. Фейковый микрофон — 1 кГц, снимки 1280×800 сохраняются
в `~/.cache/pupitre/e2e/vocal-ribbon-*`.
