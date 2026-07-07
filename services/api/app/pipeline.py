"""Пайплайн обработки песни: декодирование → разделение стемов (Demucs) →
pYIN f0 по вокалу → сегментация в ноты → map.json.

Без установленного Demucs (или при его падении) деградирует до pYIN по полному
миксу — хуже, но работает.

Прогресс сквозной: decode 0–8, separate 8–70, analyze 70–98, done 100.
"""

from __future__ import annotations

import logging
import math
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from .store import SongMeta, SongStore

log = logging.getLogger("pipeline")

SR_ANALYSIS = 22050
HOP = 256  # ~11.6 мс на кадр
FRAME = 2048
FMIN = 65.0  # C2
FMAX = 1047.0  # C6
MIN_NOTE_MS = 90
MERGE_GAP_MS = 80
SPLIT_SEMITONES = 0.75

ProgressCb = Callable[[str, int], None]  # (stage, progress 0..100)


def run_ffmpeg(args: list[str]) -> None:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg: {proc.stderr.strip()[:400]}")


def decode_to_wav(src: Path, dst: Path) -> None:
    """Любой входной формат → stereo wav 44.1k (вход для Demucs)."""
    run_ffmpeg(["-i", str(src), "-ac", "2", "-ar", "44100", str(dst)])


_demucs_model = None


def separate_stems(mix_wav: Path, out_dir: Path, progress: ProgressCb) -> tuple[Path, Path] | None:
    """Demucs htdemucs → (vocals.wav, instrumental.wav). None, если Demucs недоступен.

    Используется низкоуровневый API (demucs 4.0.x не имеет demucs.api);
    гранулярного прогресса у apply_model нет, поэтому этап показываем крупно.
    """
    global _demucs_model
    try:
        import soundfile as sf
        import torch
        from demucs.apply import apply_model
        from demucs.audio import AudioFile
        from demucs.pretrained import get_model
    except Exception as e:  # noqa: BLE001 — любой сбой импорта тяжёлого стека
        log.warning("Demucs недоступен (%s), пропускаю разделение", e)
        return None

    try:
        progress("separate", 12)
        if _demucs_model is None:
            _demucs_model = get_model("htdemucs")
            _demucs_model.eval()
        model = _demucs_model
        progress("separate", 20)

        wav = AudioFile(mix_wav).read(
            streams=0, samplerate=model.samplerate, channels=model.audio_channels
        )
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / ref.std()
        progress("separate", 25)

        with torch.no_grad():
            sources = apply_model(
                model, wav[None], device="cpu", split=True, overlap=0.25, progress=False
            )[0]
        sources = sources * ref.std() + ref.mean()
        progress("separate", 66)

        idx = model.sources.index("vocals")
        vocals = sources[idx]
        instrumental = sources.sum(dim=0) - vocals

        vocals_path = out_dir / "vocals.wav"
        instr_path = out_dir / "instrumental.wav"
        # demucs.audio.save_audio тянет torchaudio.save, требующий torchcodec —
        # пишем сами через soundfile: (channels, frames) → (frames, channels)
        sf.write(str(vocals_path), vocals.clamp(-1, 1).T.numpy(), model.samplerate)
        sf.write(str(instr_path), instrumental.clamp(-1, 1).T.numpy(), model.samplerate)
        return vocals_path, instr_path
    except Exception:  # noqa: BLE001
        log.exception("Demucs упал, пропускаю разделение")
        progress("separate", 68)
        return None


def hz_to_midi(hz: np.ndarray) -> np.ndarray:
    return 69.0 + 12.0 * np.log2(hz / 440.0)


def extract_notes(vocal_wav: Path, progress: ProgressCb) -> tuple[list[dict], int]:
    """pYIN f0 → сегментация в ноты. Возвращает (notes, duration_ms)."""
    import librosa

    y, sr = librosa.load(str(vocal_wav), sr=SR_ANALYSIS, mono=True)
    duration_ms = int(len(y) / sr * 1000)
    progress("analyze", 72)

    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=FMIN,
        fmax=FMAX,
        sr=sr,
        frame_length=FRAME,
        hop_length=HOP,
        fill_na=np.nan,
    )
    progress("analyze", 90)

    # энергетический гейт: отсечь тихие хвосты реверба в вокальном стеме
    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP)[0]
    n = min(len(f0), len(rms))
    f0, voiced_flag, voiced_prob, rms = f0[:n], voiced_flag[:n], voiced_prob[:n], rms[:n]
    active = rms > max(1e-4, float(np.percentile(rms[rms > 0], 95)) * 0.05) if np.any(rms > 0) else rms > 0

    # voiced_flag — решение витерби-декодера pyin; voiced_prob у librosa почти
    # всегда < 0.5 даже на чистом вокале, поэтому порог по нему не ставим
    voiced = voiced_flag & active & ~np.isnan(f0)
    midi = np.full(n, np.nan)
    midi[voiced] = hz_to_midi(f0[voiced])

    # медианное сглаживание внутри озвученных участков гасит выбросы детектора
    midi = _median_smooth(midi, width=5)

    frame_ms = HOP / sr * 1000.0
    notes = _segment(midi, frame_ms)
    progress("analyze", 98)
    return notes, duration_ms


def _median_smooth(x: np.ndarray, width: int) -> np.ndarray:
    out = x.copy()
    half = width // 2
    for i in range(len(x)):
        if math.isnan(x[i]):
            continue
        w = x[max(0, i - half) : i + half + 1]
        w = w[~np.isnan(w)]
        if len(w) > 0:
            out[i] = float(np.median(w))
    return out


def _segment(midi: np.ndarray, frame_ms: float) -> list[dict]:
    """Нарезка f0-контура на ноты: рвём на паузах и при уходе от медианы сегмента."""
    raw: list[tuple[int, int, float]] = []  # (start_frame, end_frame, midi)
    seg_start = -1
    seg_values: list[float] = []

    def close(end_frame: int) -> None:
        nonlocal seg_start, seg_values
        if seg_start >= 0 and seg_values:
            raw.append((seg_start, end_frame, float(np.median(seg_values))))
        seg_start = -1
        seg_values = []

    for i in range(len(midi)):
        v = midi[i]
        if math.isnan(v):
            close(i)
            continue
        if seg_start < 0:
            seg_start = i
            seg_values = [v]
            continue
        med = float(np.median(seg_values))
        if abs(v - med) > SPLIT_SEMITONES:
            close(i)
            seg_start = i
            seg_values = [v]
        else:
            seg_values.append(v)
    close(len(midi))

    # кадры → мс, фильтр коротышей, привязка к полутонам
    notes: list[dict] = []
    for start_f, end_f, m in raw:
        start_ms = start_f * frame_ms
        dur_ms = (end_f - start_f) * frame_ms
        if dur_ms < MIN_NOTE_MS:
            continue
        notes.append({"startMs": int(round(start_ms)), "durMs": int(round(dur_ms)), "midi": int(round(m))})

    # слияние соседних одинаковых нот через микропаузу (дребезг детектора)
    merged: list[dict] = []
    for note in notes:
        prev = merged[-1] if merged else None
        if (
            prev
            and prev["midi"] == note["midi"]
            and note["startMs"] - (prev["startMs"] + prev["durMs"]) < MERGE_GAP_MS
        ):
            prev["durMs"] = note["startMs"] + note["durMs"] - prev["startMs"]
        else:
            merged.append(dict(note))
    return merged


def encode_instrumental(src_wav: Path, dst_mp3: Path) -> None:
    run_ffmpeg(["-i", str(src_wav), "-codec:a", "libmp3lame", "-b:a", "192k", str(dst_mp3)])


def read_tags(path: Path, fallback_title: str) -> tuple[str, str]:
    try:
        import mutagen

        f = mutagen.File(path, easy=True)
        if f is not None and f.tags:
            title = (f.tags.get("title") or [fallback_title])[0]
            artist = (f.tags.get("artist") or [""])[0]
            return str(title) or fallback_title, str(artist)
    except Exception:  # noqa: BLE001
        pass
    return fallback_title, ""


def process_song(store: SongStore, meta: SongMeta) -> None:
    """Полный цикл обработки; статус и прогресс пишутся в meta.json."""
    d = store.song_dir(meta.id)

    def progress(stage: str, pct: int) -> None:
        meta.stage = stage
        meta.progress = max(meta.progress, min(100, pct))
        store.save_meta(meta)

    try:
        meta.status = "processing"
        progress("decode", 2)

        original = store.original_path(meta.id)
        if original is None:
            raise RuntimeError("исходный файл не найден")
        mix_wav = d / "mix.wav"
        decode_to_wav(original, mix_wav)
        progress("decode", 8)

        stems = separate_stems(mix_wav, d, progress)
        if stems is not None:
            vocal_src, instr_src = stems
            meta.separated = True
        else:
            # деградация: мелодию снимаем с полного микса, он же — аккомпанемент
            vocal_src, instr_src = mix_wav, mix_wav
            meta.separated = False
        progress("analyze", 70)

        notes, duration_ms = extract_notes(vocal_src, progress)
        if not notes and vocal_src != mix_wav:
            # вокальный стем пуст (Demucs не признал голос или трек без вокала) —
            # пробуем снять мелодию с полного микса
            log.warning("%s: в вокальном стеме нот нет, анализирую полный микс", meta.id)
            notes, duration_ms = extract_notes(mix_wav, progress)
        if not notes:
            raise RuntimeError(
                "не удалось найти мелодию в треке — возможно, он инструментальный"
            )

        encode_instrumental(instr_src, d / "instrumental.mp3")

        meta.duration_ms = duration_ms
        meta.note_count = len(notes)
        meta.low_midi = min(n["midi"] for n in notes)
        meta.high_midi = max(n["midi"] for n in notes)

        song_map = {
            "id": meta.id,
            "title": meta.title,
            "subtitle": meta.artist or None,
            "durationMs": duration_ms,
            "notes": notes,
            "backing": {"kind": "url", "url": f"/api/songs/{meta.id}/instrumental"},
        }
        import json

        (d / "map.json").write_text(json.dumps(song_map, ensure_ascii=False))

        # промежуточные артефакты больше не нужны
        for tmp in ("mix.wav", "vocals.wav", "instrumental.wav"):
            p = d / tmp
            if p.exists() and tmp != "vocals.wav":  # vocals оставляем для отладки карт
                p.unlink()

        meta.status = "done"
        meta.error = ""
        progress("done", 100)
    except Exception as e:  # noqa: BLE001 — статус ошибки должен дойти до UI
        log.exception("обработка %s упала", meta.id)
        meta.status = "error"
        meta.stage = "error"
        meta.error = str(e)[:500]
        store.save_meta(meta)
