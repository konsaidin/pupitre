"""Очередь обработки: один фоновый поток, чтобы не душить CPU параллельными Demucs."""

from __future__ import annotations

import logging
import queue
import threading

from .pipeline import ExtractParams, process_song, reextract_song
from .store import SongStore, store

log = logging.getLogger("jobs")

# элемент очереди: ("process", song_id, None) | ("reextract", song_id, ExtractParams)
Job = tuple[str, str, ExtractParams | None]


class JobQueue:
    def __init__(self, store: SongStore):
        self.store = store
        self._q: queue.Queue[Job] = queue.Queue()
        self._thread = threading.Thread(target=self._worker, daemon=True, name="pipeline")
        self._thread.start()

    def enqueue(self, song_id: str) -> None:
        self._q.put(("process", song_id, None))

    def enqueue_reextract(self, song_id: str, params: ExtractParams) -> None:
        self._q.put(("reextract", song_id, params))

    def _worker(self) -> None:
        while True:
            kind, song_id, params = self._q.get()
            meta = self.store.load_meta(song_id)
            if meta is None:
                continue
            log.info("%s %s (%s)", kind, song_id, meta.title)
            if kind == "reextract":
                reextract_song(self.store, meta, params or ExtractParams())
            else:
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
