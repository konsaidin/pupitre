"""Регрессии HTTP-контракта без Demucs, микрофона и дополнительных test deps."""

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

_bootstrap = tempfile.TemporaryDirectory(prefix="pupitre-test-bootstrap-")
os.environ["PUPITRE_DATA"] = _bootstrap.name
os.environ["PUPITRE_API_TOKEN"] = "test-session-token"

from app import main  # noqa: E402
from app.store import InvalidSongId, SongStore  # noqa: E402


class ApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pupitre-api-test-")
        self.store = SongStore(Path(self.tmp.name) / "songs")
        self.patch = patch.object(main, "store", self.store)
        self.patch.start()
        self.meta = self.store.create("song.wav", "Test", "")
        self.meta.status = "done"
        self.meta.duration_ms = 3000
        self.store.save_meta(self.meta)
        self.store.save_json(self.meta.id, "map.json", {"durationMs": 3000, "notes": []})

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    async def request(self, method, url, body=None, token="test-session-token", headers=None):
        parsed = urlsplit(url)
        raw = json.dumps(body).encode() if body is not None else b""
        request_headers = [(b"content-type", b"application/json")]
        if token is not None:
            request_headers.append((b"authorization", f"Bearer {token}".encode()))
        request_headers.extend((k.lower().encode(), v.encode()) for k, v in (headers or {}).items())
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": method, "scheme": "http", "path": unquote(parsed.path),
            "raw_path": parsed.path.encode(), "query_string": parsed.query.encode(),
            "root_path": "", "headers": request_headers,
            "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 8000),
        }
        sent = False
        messages = []

        async def receive():
            nonlocal sent
            if sent:
                await asyncio.Event().wait()
            sent = True
            return {"type": "http.request", "body": raw, "more_body": False}

        async def send(message):
            messages.append(message)

        await main.app(scope, receive, send)
        start = next(m for m in messages if m["type"] == "http.response.start")
        response = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
        return start["status"], dict(start["headers"]), response

    async def test_parent_id_cannot_read_or_delete_outside_library(self):
        sentinel = Path(self.tmp.name) / "original.wav"
        sentinel.write_bytes(b"keep")
        for method, url in [("GET", "/api/songs/%2e%2e/mix"), ("DELETE", "/api/songs/%2e%2e")]:
            status, _, _ = await self.request(method, url)
            self.assertEqual(status, 400)
            self.assertEqual(sentinel.read_bytes(), b"keep")

    async def test_song_symlink_cannot_escape_storage(self):
        link = self.store.root / ("f" * 12)
        try:
            link.symlink_to(Path(self.tmp.name), target_is_directory=True)
        except OSError as error:
            self.skipTest(f"symlinks unavailable: {error}")
        with self.assertRaises(InvalidSongId):
            self.store.song_dir(link.name)

    async def test_map_roundtrip_preserves_technique_metadata(self):
        note = {"startMs": 100, "durMs": 2000, "midi": 60, "lyric": "a", "vibrato": True,
                "tech": "vibrato", "techWarmupMs": 1200}
        status, _, _ = await self.request("PUT", f"/api/songs/{self.meta.id}/map", {"notes": [note]})
        self.assertEqual(status, 200)
        self.assertEqual(self.store.load_map(self.meta.id)["notes"], [note])

    async def test_invalid_notes_do_not_replace_existing_map(self):
        for patch_note in [
            {"startMs": -1}, {"midi": 999}, {"midi": True}, {"midi": 60.5},
            {"durMs": 0}, {"durMs": 4000}, {"startMs": 3000},
            {"tech": "unknown"}, {"vibrato": "true"}, {"techWarmupMs": 2000},
        ]:
            note = {"startMs": 0, "durMs": 2000, "midi": 60, **patch_note}
            status, _, _ = await self.request("PUT", f"/api/songs/{self.meta.id}/map", {"notes": [note]})
            self.assertIn(status, (400, 422), note)
            self.assertEqual(self.store.load_map(self.meta.id)["notes"], [])

    async def test_map_cannot_be_saved_during_processing(self):
        self.meta.status = "processing"
        self.store.save_meta(self.meta)
        status, _, _ = await self.request("PUT", f"/api/songs/{self.meta.id}/map", {"notes": []})
        self.assertEqual(status, 409)

    async def test_empty_map_resets_note_range(self):
        self.meta.low_midi, self.meta.high_midi = 48, 72
        self.store.save_meta(self.meta)
        status, _, _ = await self.request("PUT", f"/api/songs/{self.meta.id}/map", {"notes": []})
        self.assertEqual(status, 200)
        meta = self.store.load_meta(self.meta.id)
        self.assertEqual((meta.note_count, meta.low_midi, meta.high_midi), (0, 0, 0))

    async def test_token_is_required_and_query_cannot_authorize_mutation(self):
        for token in [None, "wrong", "неверный"]:
            status, _, _ = await self.request("GET", "/api/songs", token=token)
            self.assertEqual(status, 401)
        status, _, _ = await self.request("DELETE", f"/api/songs/{self.meta.id}?token=test-session-token", token=None)
        self.assertEqual(status, 401)

    async def test_untrusted_origin_is_rejected_before_mutation(self):
        status, _, _ = await self.request("DELETE", f"/api/songs/{self.meta.id}", headers={"Origin": "https://untrusted.invalid"})
        self.assertEqual(status, 403)
        self.assertIsNotNone(self.store.load_meta(self.meta.id))

    async def test_cors_preflight_does_not_require_token(self):
        status, headers, _ = await self.request("OPTIONS", "/api/songs", token=None, headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        self.assertEqual(status, 200)
        self.assertEqual(headers[b"access-control-allow-origin"], b"http://localhost:5173")

    async def test_audio_range_request_works_with_session_query_token(self):
        (self.store.song_dir(self.meta.id) / "vocal.mp3").write_bytes(b"0123456789")
        status, _, body = await self.request("GET", f"/api/songs/{self.meta.id}/vocal?token=test-session-token",
                                             token=None, headers={"Origin": "null", "Range": "bytes=2-5"})
        self.assertEqual(status, 206)
        self.assertEqual(body, b"2345")


if __name__ == "__main__":
    unittest.main()
