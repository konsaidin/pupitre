# Slopsician

Тренажёр вокала в духе Yousician: пой в микрофон и попадай голосом в ноты.
Распевки и упражнения генерируются под твой диапазон и работают целиком в
браузере; свои песни обрабатываются локальным пайплайном (Demucs выделяет
вокал, pYIN снимает мелодию) — и ты поёшь их под минусовку.

Подробный план и разбивка фич: [PLAN.md](PLAN.md).

## Запуск

Фронтенд (Node 20+):

```bash
cd apps/web
npm install
npm run dev            # http://localhost:5173
```

Бэкенд для песен (Python 3.11+, ffmpeg в PATH) — без него работают упражнения,
но не загрузка песен:

```bash
cd services/api
python3 -m venv .venv
.venv/bin/pip install fastapi 'uvicorn[standard]' python-multipart mutagen numpy scipy librosa soundfile
.venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install demucs
.venv/bin/uvicorn app.main:app --port 8000
```

Первый запуск Demucs скачает веса модели htdemucs (~300 МБ). Без
torch/demucs бэкенд тоже работает: мелодия снимается с полного микса.

## Структура

```
apps/web       — React/TS: пиано-ролл, упражнения, библиотека, профиль голоса
services/api   — FastAPI + пайплайн обработки (см. services/api/README.md)
```
