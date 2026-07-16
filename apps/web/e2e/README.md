# E2E-проверки (курс 2)

Запуск: системный Firefox + puppeteer-core (WebDriver BiDi), фейковый микрофон
Firefox даёт непрерывный тон 1 кГц.

```bash
# dev-сервер (нужен обоим скриптам)
cd apps/web && npx vite --port 5173 &

# зависимость (один раз, в любой временной папке рядом со скриптом)
npm install puppeteer-core

node e2e/live-tract.cjs   # живой тракт: WorkletAudioInput → кадры, latencyMs
node e2e/ribbon.cjs       # игра: лента рисуется, переключение Ribbon/Roll, скриншоты
```

Скоринг вибрато-упражнения (без браузера: настоящие карта+движок, синтетические
кадры; dev-сервер не нужен):

```bash
npx esbuild e2e/vibrato-exercise.ts --bundle --format=esm --platform=node \
  --banner:js="globalThis.localStorage={getItem:()=>null,setItem:()=>{}};" \
  --outfile=/tmp/vibrato-exercise.mjs && node /tmp/vibrato-exercise.mjs
```

Грабли:
- профиль сеется в localStorage — после этого обязателен `page.reload()`
  (профиль читается при инициализации React);
- `pkill -f vite` из шелла может убить сам шелл — гасить по PID из `ss -ltnp`.
