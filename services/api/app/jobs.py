"""Очередь обработки: один фоновый поток, чтобы не душить CPU параллельными Demucs."""

from __future__ import annotations

import logging
import queue
import threading

from .pipeline import process_song
from .store import SongStore, store

log = logging.getLogger("jobs")


class JobQueue:
    def __init__(self, store: SongStore):
        self.store = store
        self._q: queue.Queue[str] = queue.Queue()
        self._thread = threading.Thread(target=self._worker, daemon=True, name="pipeline")
        self._thread.start()

    def enqueue(self, song_id: str) -> None:
        self._q.put(song_id)

    def _worker(self) -> None:
        while True:
            song_id = self._q.get()
            meta = self.store.load_meta(song_id)
            if meta is None:
                continue
            log.info("обрабатываю %s (%s)", song_id, meta.title)
            process_song(self.store, meta)

    def recover_stale(self) -> None:
        """После рестарта: зависшие в processing/queued песни — обратно в очередь."""
        for meta in self.store.list_meta():
            if meta.status in ("processing", "queued"):
                meta.status = "queued"
                meta.stage = "queued"
                meta.progress = 0
                self.store.save_meta(meta)
                self.enqueue(meta.id)


jobs = JobQueue(store)
