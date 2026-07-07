"""Отладочный CLI: прогнать пайплайн на файле без сервера.

  python cli.py путь/к/треку.mp3 [--no-separate]

Печатает статистику карты и пишет артефакты в data/songs/<id>/.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from app.pipeline import process_song
from app.store import store


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--no-separate", action="store_true", help="pYIN по полному миксу, без Demucs")
    args = parser.parse_args()

    if not args.audio.exists():
        print(f"нет файла: {args.audio}", file=sys.stderr)
        return 1

    if args.no_separate:
        from app import pipeline

        pipeline.separate_stems = lambda *_a, **_k: None  # type: ignore[assignment]

    meta = store.create(original_name=args.audio.name, title=args.audio.stem, artist="")
    original = store.song_dir(meta.id) / f"original{args.audio.suffix.lower()}"
    original.write_bytes(args.audio.read_bytes())

    t0 = time.time()
    process_song(store, meta)
    dt = time.time() - t0

    meta = store.load_meta(meta.id)
    assert meta is not None
    if meta.status != "done":
        print(f"ошибка: {meta.error}", file=sys.stderr)
        return 2

    song_map = store.load_map(meta.id)
    assert song_map is not None
    notes = song_map["notes"]
    durs = [n["durMs"] for n in notes]
    print(f"id={meta.id} за {dt:.1f}с, разделение={'да' if meta.separated else 'нет'}")
    print(f"нот: {len(notes)}, диапазон midi {meta.low_midi}..{meta.high_midi}")
    print(f"длительности: мин {min(durs)}мс, медиана {sorted(durs)[len(durs)//2]}мс, макс {max(durs)}мс")
    print(json.dumps(notes[:12], ensure_ascii=False))
    print(f"артефакты: {store.song_dir(meta.id)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
