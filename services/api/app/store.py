"""Хранилище песен на диске: data/songs/{id}/ с meta.json и артефактами.

Никакой БД: файловая структура переживает рестарты и легко отлаживается.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

# SLOPSICIAN_DATA задаёт корень данных (десктоп-приложение кладёт песни в
# профиль пользователя); по умолчанию — рядом с кодом, как раньше
_data_root = os.environ.get("SLOPSICIAN_DATA")
DATA_DIR = (Path(_data_root) if _data_root else Path(__file__).resolve().parents[1] / "data") / "songs"

# Этапы обработки в порядке следования; progress — сквозной 0..100
STAGES = ("queued", "decode", "separate", "analyze", "done", "error")


@dataclass
class SongMeta:
    id: str
    title: str
    artist: str = ""
    status: str = "queued"  # queued|processing|done|error
    stage: str = "queued"
    progress: int = 0
    error: str = ""
    duration_ms: int = 0
    note_count: int = 0
    low_midi: int = 0
    high_midi: int = 0
    separated: bool = True
    # причина, по которой вокал не отделён (Demucs недоступен/упал); "" — отделён
    separation_error: str = ""
    created_at: float = field(default_factory=time.time)
    original_name: str = ""

    def to_api(self) -> dict:
        d = asdict(self)
        return {
            "id": d["id"],
            "title": d["title"],
            "artist": d["artist"],
            "status": d["status"],
            "stage": d["stage"],
            "progress": d["progress"],
            "error": d["error"],
            "durationMs": d["duration_ms"],
            "noteCount": d["note_count"],
            "lowMidi": d["low_midi"],
            "highMidi": d["high_midi"],
            "separated": d["separated"],
            "separationError": d["separation_error"],
            "createdAt": d["created_at"],
        }


class SongStore:
    def __init__(self, root: Path = DATA_DIR):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def song_dir(self, song_id: str) -> Path:
        return self.root / song_id

    def create(self, original_name: str, title: str, artist: str) -> SongMeta:
        song_id = uuid.uuid4().hex[:12]
        meta = SongMeta(id=song_id, title=title, artist=artist, original_name=original_name)
        d = self.song_dir(song_id)
        d.mkdir(parents=True)
        self.save_meta(meta)
        return meta

    def save_meta(self, meta: SongMeta) -> None:
        with self._lock:
            d = self.song_dir(meta.id)
            if not d.exists():
                return  # песню удалили во время обработки — не воскрешаем каталог
            path = d / "meta.json"
            tmp = path.with_suffix(".json.tmp")
            # encoding обязателен: на Windows дефолт — cp1252, кириллица в
            # title/error роняла запись
            tmp.write_text(json.dumps(asdict(meta), ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(path)

    def load_meta(self, song_id: str) -> SongMeta | None:
        path = self.song_dir(song_id) / "meta.json"
        try:
            return SongMeta(**json.loads(path.read_text(encoding="utf-8")))
        except (FileNotFoundError, json.JSONDecodeError, TypeError):
            return None

    def list_meta(self) -> list[SongMeta]:
        metas = []
        for d in self.root.iterdir():
            if (d / "meta.json").exists():
                try:
                    metas.append(SongMeta(**json.loads((d / "meta.json").read_text(encoding="utf-8"))))
                except (json.JSONDecodeError, TypeError):
                    continue
        return sorted(metas, key=lambda m: m.created_at, reverse=True)

    def load_map(self, song_id: str) -> dict | None:
        path = self.song_dir(song_id) / "map.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def delete(self, song_id: str) -> bool:
        d = self.song_dir(song_id)
        if not d.exists():
            return False
        shutil.rmtree(d)
        return True

    def original_path(self, song_id: str) -> Path | None:
        d = self.song_dir(song_id)
        for p in d.glob("original.*"):
            return p
        return None


store = SongStore()
