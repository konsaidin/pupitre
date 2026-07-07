"""HTTP API: загрузка песен, статус обработки, карты нот и инструментал.

Запуск:  uvicorn app.main:app --port 8000  (из каталога services/api)
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .jobs import jobs
from .store import store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

ALLOWED_EXT = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus", ".aac"}
MAX_UPLOAD_MB = 60

app = FastAPI(title="Slopsician API")


@app.on_event("startup")
def _startup() -> None:
    jobs.recover_stale()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/songs")
def list_songs() -> list[dict]:
    return [m.to_api() for m in store.list_meta()]


@app.post("/api/songs", status_code=201)
async def upload_song(file: UploadFile) -> dict:
    name = file.filename or "song"
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"формат {ext or '(нет расширения)'} не поддерживается")
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"файл больше {MAX_UPLOAD_MB} МБ")
    if not data:
        raise HTTPException(400, "пустой файл")

    meta = store.create(original_name=name, title=Path(name).stem, artist="")
    original = store.song_dir(meta.id) / f"original{ext}"
    original.write_bytes(data)

    # название/артист из тегов, если есть
    from .pipeline import read_tags

    meta.title, meta.artist = read_tags(original, fallback_title=Path(name).stem)
    store.save_meta(meta)

    jobs.enqueue(meta.id)
    return meta.to_api()


@app.get("/api/songs/{song_id}")
def get_song(song_id: str) -> dict:
    meta = store.load_meta(song_id)
    if meta is None:
        raise HTTPException(404, "песня не найдена")
    out = meta.to_api()
    if meta.status == "done":
        out["map"] = store.load_map(song_id)
    return out


@app.get("/api/songs/{song_id}/instrumental")
def get_instrumental(song_id: str) -> FileResponse:
    path = store.song_dir(song_id) / "instrumental.mp3"
    if not path.exists():
        raise HTTPException(404, "инструментал ещё не готов")
    return FileResponse(path, media_type="audio/mpeg")


@app.delete("/api/songs/{song_id}", status_code=204)
def delete_song(song_id: str) -> None:
    if not store.delete(song_id):
        raise HTTPException(404, "песня не найдена")


@app.post("/api/songs/{song_id}/retry")
def retry_song(song_id: str) -> dict:
    meta = store.load_meta(song_id)
    if meta is None:
        raise HTTPException(404, "песня не найдена")
    if meta.status not in ("error", "done"):
        raise HTTPException(409, "песня уже в обработке")
    meta.status = "queued"
    meta.stage = "queued"
    meta.progress = 0
    meta.error = ""
    store.save_meta(meta)
    jobs.enqueue(song_id)
    return meta.to_api()
