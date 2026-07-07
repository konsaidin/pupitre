# Slopsician API

Обработка песен: Demucs (стемы) → pYIN (f0 вокала) → сегментация → карта нот.

## Запуск

```bash
cd services/api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # torch ставить с --index-url https://download.pytorch.org/whl/cpu
.venv/bin/uvicorn app.main:app --port 8000
```

Vite-dev фронта проксирует `/api` на `127.0.0.1:8000` (см. `apps/web/vite.config.ts`).

Отладка пайплайна без сервера:

```bash
.venv/bin/python cli.py track.mp3 [--no-separate]
```

## Контракт

Объект песни (список и деталь):

```json
{
  "id": "a1b2c3", "title": "…", "artist": "…",
  "status": "queued|processing|done|error",
  "stage": "queued|decode|separate|analyze|done|error",
  "progress": 0,
  "error": "",
  "durationMs": 214000, "noteCount": 312,
  "lowMidi": 55, "highMidi": 74,
  "separated": true, "createdAt": 1751932800.0
}
```

- `POST /api/songs` — multipart-поле `file` (mp3/wav/flac/m4a/ogg/opus/aac, ≤60 МБ) → 201 + объект песни; обработка асинхронная, статус опрашивать полингом.
- `GET /api/songs` — список (новые сверху).
- `GET /api/songs/{id}` — деталь; при `status=done` добавляется поле `map` —
  готовый `SongMap` фронта: `{id,title,subtitle,durationMs,notes:[{startMs,durMs,midi}],backing:{kind:"url",url:"/api/songs/{id}/instrumental"}}`.
- `GET /api/songs/{id}/instrumental` — mp3 минусовки (при `separated=false` — полный микс).
- `DELETE /api/songs/{id}` — 204.
- `POST /api/songs/{id}/retry` — перезапуск после ошибки.

Прогресс сквозной: decode 0–8, separate 8–70, analyze 70–98, done 100.
Если Demucs недоступен/упал — пайплайн не падает: мелодия снимается с полного
микса, `separated=false` (фронт может показать пометку «без разделения»).
