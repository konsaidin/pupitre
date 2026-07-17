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
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from .store import SongMeta, SongStore

log = logging.getLogger("pipeline")

SR_ANALYSIS = 22050
HOP = 256  # ~11.6 мс на кадр
FRAME = 2048
PITCHLINE_DECIMATE = 2  # прореживание контура f0 перед сохранением (кадры)

ProgressCb = Callable[[str, int], None]  # (stage, progress 0..100)


class SongDeleted(Exception):
    """Каталог песни исчез во время обработки — пользователь её удалил."""


@dataclass(frozen=True)
class ExtractParams:
    """Настройки извлечения мелодии; крутятся ползунками в UI (reextract)."""

    fmin: float = 65.0  # C2 — нижняя граница поиска высоты, Гц
    fmax: float = 1047.0  # C6 — верхняя граница, Гц
    gate_ratio: float = 0.05  # энергетический гейт: доля от p95 RMS
    min_note_ms: int = 90  # ноты короче — отбрасываются
    merge_gap_ms: int = 80  # склейка одинаковых нот через микропаузу
    split_semitones: float = 0.75  # уход от медианы сегмента, рвущий ноту
    median_width: int = 5  # ширина медианного сглаживания, кадров (нечётная)

    @classmethod
    def from_api(cls, payload: dict) -> "ExtractParams":
        """camelCase-поля из UI → параметры; значения зажимаются в разумные рамки."""
        def num(key: str, default: float, lo: float, hi: float) -> float:
            v = payload.get(key, default)
            if not isinstance(v, (int, float)) or isinstance(v, bool) or math.isnan(float(v)):
                raise ValueError(f"{key}: ожидается число")
            return min(hi, max(lo, float(v)))

        d = cls()
        fmin = num("fmin", d.fmin, 40.0, 500.0)
        fmax = num("fmax", d.fmax, 200.0, 2000.0)
        if fmax <= fmin + 50:  # pyin требует fmin < fmax; узкая щель бессмысленна
            fmax = fmin + 50
        width = int(num("medianWidth", d.median_width, 1, 21))
        return cls(
            fmin=fmin,
            fmax=fmax,
            gate_ratio=num("gateRatio", d.gate_ratio, 0.0, 0.5),
            min_note_ms=int(num("minNoteMs", d.min_note_ms, 20, 500)),
            merge_gap_ms=int(num("mergeGapMs", d.merge_gap_ms, 0, 500)),
            split_semitones=num("splitSemitones", d.split_semitones, 0.1, 4.0),
            median_width=width if width % 2 == 1 else width + 1,
        )

    def to_api(self) -> dict:
        return {
            "fmin": self.fmin,
            "fmax": self.fmax,
            "gateRatio": self.gate_ratio,
            "minNoteMs": self.min_note_ms,
            "mergeGapMs": self.merge_gap_ms,
            "splitSemitones": self.split_semitones,
            "medianWidth": self.median_width,
        }


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


def separate_stems(mix_wav: Path, out_dir: Path, progress: ProgressCb) -> tuple[Path, Path] | str:
    """Demucs htdemucs → (vocals.wav, instrumental.wav); при сбое — строка-причина.

    Используется низкоуровневый API (demucs 4.0.x не имеет demucs.api);
    гранулярного прогресса у apply_model нет, поэтому этап показываем крупно.
    """
    global _demucs_model
    try:
        import soundfile as sf
        import torch
        from demucs.apply import apply_model
        from demucs.pretrained import get_model
    except Exception as e:  # noqa: BLE001 — любой сбой импорта тяжёлого стека
        log.warning("Demucs недоступен (%s), пропускаю разделение", e)
        return f"Demucs недоступен: {str(e)[:200]}"

    try:
        progress("separate", 12)
        if _demucs_model is None:
            _demucs_model = get_model("htdemucs")
            _demucs_model.eval()
        model = _demucs_model
        progress("separate", 20)

        # не demucs.AudioFile: он дёргает ffprobe, которого нет в поставке
        # (шипуем только ffmpeg.exe). mix.wav уже stereo 44.1k из decode_to_wav
        data, in_sr = sf.read(str(mix_wav), dtype="float32", always_2d=True)
        if in_sr != model.samplerate:
            raise RuntimeError(f"mix.wav: {in_sr} Гц вместо {model.samplerate}")
        wav = torch.from_numpy(data.T.copy())  # (channels, frames)
        if wav.shape[0] == 1:
            wav = wav.repeat(model.audio_channels, 1)
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
    except SongDeleted:
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("Demucs упал, пропускаю разделение")
        progress("separate", 68)
        return f"Demucs упал: {str(e)[:200]}"


def hz_to_midi(hz: np.ndarray) -> np.ndarray:
    return 69.0 + 12.0 * np.log2(hz / 440.0)


def extract_notes(
    vocal_wav: Path, progress: ProgressCb, params: ExtractParams = ExtractParams()
) -> tuple[list[dict], int, dict]:
    """pYIN f0 → сегментация в ноты.

    Возвращает (notes, duration_ms, pitchline), где pitchline — непрерывный контур
    высоты голоса: {"hopMs": float, "midi": [float|None, ...]} — то, что «спелось бы
    в микрофон». None означает тишину/неозвученный кадр.
    """
    import librosa

    y, sr = librosa.load(str(vocal_wav), sr=SR_ANALYSIS, mono=True)
    duration_ms = int(len(y) / sr * 1000)
    progress("analyze", 72)

    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=params.fmin,
        fmax=params.fmax,
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
    if np.any(rms > 0) and params.gate_ratio > 0:
        active = rms > max(1e-4, float(np.percentile(rms[rms > 0], 95)) * params.gate_ratio)
    else:
        active = rms > 0

    # voiced_flag — решение витерби-декодера pyin; voiced_prob у librosa почти
    # всегда < 0.5 даже на чистом вокале, поэтому порог по нему не ставим
    voiced = voiced_flag & active & ~np.isnan(f0)
    midi = np.full(n, np.nan)
    midi[voiced] = hz_to_midi(f0[voiced])

    # медианное сглаживание внутри озвученных участков гасит выбросы детектора
    midi = _median_smooth(midi, width=params.median_width)

    frame_ms = HOP / sr * 1000.0
    # октавные срывы pYIN (уход на кратное 12 и обратно) возвращаем в регистр
    midi = _fix_octave_flips(midi, frame_ms)
    notes = _segment(midi, frame_ms, params)
    # добиваем октавные выбросы, пережившие контурную свёртку (края фраз,
    # целые фразы на субгармонике) — и применяем те же свёртки к контуру:
    # полоска (pitchline) обязана совпадать с нотами, это один алгоритм
    for a_ms, b_ms, delta in _fix_note_octaves(notes):
        a = max(0, int(a_ms / frame_ms) - 1)
        b = min(len(midi), int(math.ceil(b_ms / frame_ms)) + 2)
        seg = midi[a:b]
        seg[~np.isnan(seg)] += delta
    _mark_vibrato(notes, midi, frame_ms)
    pitchline = _build_pitchline(midi, frame_ms)
    progress("analyze", 98)
    return notes, duration_ms, pitchline


def _fix_octave_flips(midi: np.ndarray, frame_ms: float) -> np.ndarray:
    """Свёртка октавных срывов pYIN вида A–B–A внутри фразы.

    Срыв — участок B, приклеенный микропаузами к соседям A слева и справа,
    которые согласны между собой по высоте, и отстоящий от них на почти точное
    кратное октавы (половинная/двойная частота даёт ровно ±12). Такой участок
    возвращаем к соседям. Правило намеренно консервативное: без скользящего
    «регистра» (его захватывают фантомные линии стема — гармоники, пролезший
    инструментал), поэтому настоящие смены регистра — после вдоха, надолго —
    не трогаются по построению.
    """
    glued_gap_ms = 150.0  # склейка с соседями: срыв живёт внутри фразы
    agree_semis = 3.5  # согласие соседей A между собой
    fold_residual = 1.5  # отклонение скачка от кратного октаве
    max_flip_ms = 2000.0  # длиннее — не срыв, а осмысленный кусок мелодии

    voiced = ~np.isnan(midi)
    if not np.any(voiced):
        return midi
    out = midi.copy()

    # сегменты → «пробеги» (runs): цепочки сегментов через микропаузы,
    # согласные по высоте; срыв двигает медиану > agree_semis и рвёт пробег
    def build_runs() -> list[tuple[int, int, float]]:
        segs: list[tuple[int, int, float]] = []
        i = 0
        while i < len(out):
            if not voiced[i]:
                i += 1
                continue
            a = i
            while i < len(out) and voiced[i]:
                i += 1
            segs.append((a, i, float(np.median(out[a:i]))))
        runs: list[tuple[int, int, float]] = []
        for a, b, med in segs:
            if runs:
                pa, pb, pmed = runs[-1]
                if (a - pb) * frame_ms <= glued_gap_ms and abs(med - pmed) <= agree_semis:
                    w_old = pb - pa
                    w_new = b - a
                    runs[-1] = (pa, b, (pmed * w_old + med * w_new) / (w_old + w_new))
                    continue
            runs.append((a, b, med))
        return runs

    # свёртка среднего пробега в сэндвиче A-B-A; цепочки A-B-A-B-A сходятся
    # за несколько проходов (после свёртки B пробеги сливаются)
    for _ in range(4):
        runs = build_runs()
        changed = False
        for j in range(1, len(runs) - 1):
            pa, pb, pm = runs[j - 1]
            a, b, m = runs[j]
            na, nb, nm = runs[j + 1]
            if (a - pb) * frame_ms > glued_gap_ms or (na - b) * frame_ms > glued_gap_ms:
                continue
            if (b - a) * frame_ms > max_flip_ms or abs(nm - pm) > agree_semis:
                continue
            dm = m - (pm + nm) / 2.0
            k = round(dm / 12.0)
            if k != 0 and abs(dm - 12.0 * k) <= fold_residual:
                out[a:b] -= 12.0 * k
                changed = True
        if not changed:
            break
    return out


def _fix_note_octaves(notes: list[dict]) -> list[tuple[float, float, int]]:
    """Октавные выбросы НОТ после сегментации (правит на месте).

    Возвращает применённые свёртки [(startMs, endMs, deltaSemis)] — вызывающий
    ОБЯЗАН применить их и к f0-контуру (pitchline): ноты и полоска — один
    алгоритм, расхождение между ними = скачущая линия при ровных нотах.

    Правила (оба требуют почти точного кратного 12 — честные широкие
    интервалы октавами не сводятся и не трогаются):
    1) короткая фраза (< max_phrase_ms; ноты через паузы < phrase_gap_ms)
       на ~кратное октавы НИЖЕ регистра остальных нот — поднять обратно
       (классическая субгармоника pYIN: f0/2). Поднимаем только снизу и
       только ОДИНОЧЕК: если на уровне фразы живёт хоть одна другая фраза
       приличной длины — это настоящий низкий куплет (куплеты повторяются,
       срыв — одиночка), не трогаем. Критерий «±12 с малым остатком» без
       проверки одиночества ломал живые куплеты при контрасте куплет/припев
       ≈ октава;
    2) нота, чьи соседи по фразе согласны между собой, а она отстоит от них
       на почти точное кратное октавы — приклеить к соседям.
    """
    phrase_gap_ms = 400.0
    agree_semis = 3.5  # согласие соседей между собой
    fold_residual = 2.0  # отклонение сдвига от кратного октаве
    max_phrase_ms = 6000.0
    companion_semis = 3.0  # фраза на том же уровне = уровень настоящий
    companion_min_ms = 600.0  # совсем короткие обрывки компаньонами не считаем

    folds: list[tuple[float, float, int]] = []
    if len(notes) < 3:
        return folds

    def wmedian(values: list[tuple[float, float]]) -> float:
        """Взвешенная медиана [(значение, вес)]."""
        values = sorted(values)
        total = sum(w for _, w in values)
        acc = 0.0
        for v, w in values:
            acc += w
            if acc >= total / 2:
                return v
        return values[-1][0]

    # фразы: группы нот, слитые паузами < phrase_gap_ms
    phrases: list[list[int]] = [[0]]
    for i in range(1, len(notes)):
        prev = notes[i - 1]
        gap = notes[i]["startMs"] - (prev["startMs"] + prev["durMs"])
        if gap < phrase_gap_ms:
            phrases[-1].append(i)
        else:
            phrases.append([i])

    def phrase_med(idx: list[int]) -> float:
        return wmedian([(float(notes[i]["midi"]), float(notes[i]["durMs"])) for i in idx])

    def phrase_span(idx: list[int]) -> float:
        first, last = notes[idx[0]], notes[idx[-1]]
        return float(last["startMs"] + last["durMs"] - first["startMs"])

    # правило 1: короткая фраза-субгармоника без компаньонов на своём уровне
    for pi, idx in enumerate(phrases):
        if phrase_span(idx) > max_phrase_ms:
            continue
        med = phrase_med(idx)
        others = [(float(notes[i]["midi"]), float(notes[i]["durMs"]))
                  for pj, oidx in enumerate(phrases) if pj != pi for i in oidx]
        if not others:
            continue
        register = wmedian(others)
        k = round((med - register) / 12.0)
        if k >= 0 or abs(med - register - 12.0 * k) > fold_residual:
            continue
        lonely = all(
            abs(phrase_med(oidx) - med) > companion_semis or phrase_span(oidx) < companion_min_ms
            for pj, oidx in enumerate(phrases)
            if pj != pi
        )
        if not lonely:
            continue  # уровень обжит другими фразами — настоящий низкий куплет
        first, last = notes[idx[0]], notes[idx[-1]]
        for i in idx:
            notes[i]["midi"] -= 12 * k
        folds.append((float(first["startMs"]), float(last["startMs"] + last["durMs"]), -12 * k))

    # правило 2: одиночный выброс между согласными соседями (внутри фразы)
    for _ in range(2):
        changed = False
        for idx in phrases:
            for j in range(1, len(idx) - 1):
                pm = notes[idx[j - 1]]["midi"]
                m = notes[idx[j]]["midi"]
                nm = notes[idx[j + 1]]["midi"]
                if abs(pm - nm) > agree_semis:
                    continue
                dm = m - (pm + nm) / 2.0
                k = round(dm / 12.0)
                if k != 0 and abs(dm - 12.0 * k) <= fold_residual:
                    n = notes[idx[j]]
                    n["midi"] -= 12 * k
                    folds.append((float(n["startMs"]), float(n["startMs"] + n["durMs"]), -12 * k))
                    changed = True
        if not changed:
            break
    return folds


def _mark_vibrato(notes: list[dict], midi: np.ndarray, frame_ms: float) -> None:
    """Пометить ноты, спетые с вибрато (аддитивное поле "vibrato": true).

    Критерий согласован с live-детектором ядра (packages/dsp/src/vibrato.rs):
    периодическая модуляция 4–8 Гц глубиной ≥ 20 центов, минимум ~2 периода.
    Детренд скользящим средним ~250 мс убирает движение мелодии, период —
    по максимуму нормированной автокорреляции в полосе.
    """
    trend_win = max(3, int(250 / frame_ms) | 1)
    lag_lo = max(2, int(round(1000 / 8 / frame_ms)))  # период 8 Гц в кадрах
    lag_hi = int(round(1000 / 4 / frame_ms))  # период 4 Гц

    for note in notes:
        a = int(round(note["startMs"] / frame_ms))
        b = int(round((note["startMs"] + note["durMs"]) / frame_ms))
        seg = midi[a:b]
        seg = seg[~np.isnan(seg)]
        # детренд только в валидной зоне свёртки: zero-padding краёв дал бы
        # выбросы величиной с саму ноту; нужен запас на 2 периода 4 Гц
        if len(seg) < trend_win + lag_hi * 2:
            continue
        trend = np.convolve(seg, np.ones(trend_win) / trend_win, mode="valid")
        x = seg[trend_win // 2 : trend_win // 2 + trend.size] - trend
        x = x - x.mean()
        var = float(np.dot(x, x))
        if var <= 0.0:
            continue
        best = 0.0
        for lag in range(lag_lo, min(lag_hi, len(x) - 1) + 1):
            r = float(np.dot(x[:-lag], x[lag:])) / var
            best = max(best, r)
        depth_cents = float(np.std(x)) * float(np.sqrt(2.0)) * 100.0
        if best >= 0.35 and depth_cents >= 20.0:
            note["vibrato"] = True


def _build_pitchline(midi: np.ndarray, frame_ms: float) -> dict:
    """Прореженный контур высоты для отрисовки «дорожки» и режима «петь по линии».

    NaN (тишина) → None; значения округляем до 0.01 полутона, чтобы JSON не пух.
    """
    dec = max(1, PITCHLINE_DECIMATE)
    out: list[float | None] = []
    for i in range(0, len(midi), dec):
        v = midi[i]
        out.append(None if math.isnan(v) else round(float(v), 2))
    return {"hopMs": round(frame_ms * dec, 3), "midi": out}


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


def _segment(
    midi: np.ndarray, frame_ms: float, params: ExtractParams = ExtractParams()
) -> list[dict]:
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
        if abs(v - med) > params.split_semitones:
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
        if dur_ms < params.min_note_ms:
            continue
        notes.append({"startMs": int(round(start_ms)), "durMs": int(round(dur_ms)), "midi": int(round(m))})

    # слияние соседних одинаковых нот через микропаузу (дребезг детектора)
    merged: list[dict] = []
    for note in notes:
        prev = merged[-1] if merged else None
        if (
            prev
            and prev["midi"] == note["midi"]
            and note["startMs"] - (prev["startMs"] + prev["durMs"]) < params.merge_gap_ms
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
        if not d.exists():
            raise SongDeleted(meta.id)
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
        if isinstance(stems, tuple):
            vocal_src, instr_src = stems
            meta.separated = True
            meta.separation_error = ""
        else:
            # деградация: мелодию снимаем с полного микса, он же — аккомпанемент.
            # Причина едет в meta — UI обязан показать её, тихой деградации нет
            vocal_src, instr_src = mix_wav, mix_wav
            meta.separated = False
            meta.separation_error = stems
        progress("analyze", 70)

        notes, duration_ms, pitchline = extract_notes(vocal_src, progress)
        if not notes and vocal_src != mix_wav:
            # вокальный стем пуст (Demucs не признал голос или трек без вокала) —
            # пробуем снять мелодию с полного микса
            log.warning("%s: в вокальном стеме нот нет, анализирую полный микс", meta.id)
            notes, duration_ms, pitchline = extract_notes(mix_wav, progress)
        if not notes:
            raise RuntimeError(
                "не удалось найти мелодию в треке — возможно, он инструментальный"
            )

        encode_instrumental(instr_src, d / "instrumental.mp3")
        # превью извлечённого вокала (для редактора/ориентира); в игре не играется
        vocal_wav = d / "vocals.wav"
        if vocal_wav.exists():
            encode_instrumental(vocal_wav, d / "vocal.mp3")

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
            "hasPitchline": True,
            "hasVocal": (d / "vocal.mp3").exists(),
            "extract": ExtractParams().to_api(),
        }
        import json

        (d / "map.json").write_text(json.dumps(song_map, ensure_ascii=False), encoding="utf-8")
        (d / "pitchline.json").write_text(json.dumps(pitchline, ensure_ascii=False), encoding="utf-8")

        # промежуточные артефакты больше не нужны; vocals.wav оставляем — из него
        # делается превью и (в будущем) повторное извлечение без Demucs
        for tmp in ("mix.wav", "instrumental.wav"):
            p = d / tmp
            if p.exists():
                p.unlink()

        meta.status = "done"
        meta.error = ""
        progress("done", 100)
    except SongDeleted:
        log.info("обработка %s прервана: песня удалена", meta.id)
    except Exception as e:  # noqa: BLE001 — статус ошибки должен дойти до UI
        log.exception("обработка %s упала", meta.id)
        meta.status = "error"
        meta.stage = "error"
        meta.error = str(e)[:500]
        store.save_meta(meta)


def reextract_song(store: SongStore, meta: SongMeta, params: ExtractParams) -> None:
    """Повторное снятие мелодии с новыми параметрами — только этап analyze.

    Источник — сохранённый vocals.wav (без Demucs, быстро); если его нет
    (старый трек или Demucs был недоступен) — декодируем оригинал заново.
    При неудаче старая карта не трогается, песня остаётся играбельной.
    """
    import json

    d = store.song_dir(meta.id)
    old_status = meta.status

    def progress(stage: str, pct: int) -> None:
        if not d.exists():
            raise SongDeleted(meta.id)
        meta.stage = stage
        meta.progress = max(meta.progress, min(100, pct))
        store.save_meta(meta)

    tmp_mix: Path | None = None
    try:
        meta.status = "processing"
        progress("analyze", 5)

        vocal_wav = d / "vocals.wav"
        if vocal_wav.exists():
            src = vocal_wav
        else:
            original = store.original_path(meta.id)
            if original is None:
                raise RuntimeError("нет ни vocals.wav, ни исходного файла")
            tmp_mix = d / "mix.wav"
            decode_to_wav(original, tmp_mix)
            src = tmp_mix
        progress("analyze", 30)

        notes, duration_ms, pitchline = extract_notes(src, progress, params)
        if not notes:
            raise RuntimeError("с этими настройками нот не нашлось — карта не изменена")

        song_map = store.load_map(meta.id)
        if song_map is None:
            raise RuntimeError("карта не найдена")
        song_map["notes"] = notes
        song_map["durationMs"] = duration_ms
        song_map["hasPitchline"] = True
        song_map["extract"] = params.to_api()

        # превью вокала могло не существовать (карта до появления фичи)
        if vocal_wav.exists() and not (d / "vocal.mp3").exists():
            encode_instrumental(vocal_wav, d / "vocal.mp3")
        song_map["hasVocal"] = (d / "vocal.mp3").exists()

        (d / "map.json").write_text(json.dumps(song_map, ensure_ascii=False), encoding="utf-8")
        (d / "pitchline.json").write_text(json.dumps(pitchline, ensure_ascii=False), encoding="utf-8")

        meta.duration_ms = duration_ms
        meta.note_count = len(notes)
        meta.low_midi = min(n["midi"] for n in notes)
        meta.high_midi = max(n["midi"] for n in notes)
        meta.status = "done"
        meta.error = ""
        progress("done", 100)
    except SongDeleted:
        log.info("reextract %s прерван: песня удалена", meta.id)
    except Exception as e:  # noqa: BLE001 — сообщение должно дойти до UI
        log.exception("reextract %s упал", meta.id)
        # карта цела — возвращаем прежний статус, ошибку показываем текстом
        meta.status = old_status if old_status == "done" else "done"
        meta.stage = "done"
        meta.progress = 100
        meta.error = f"переснятие: {str(e)[:400]}"
        store.save_meta(meta)
    finally:
        if tmp_mix is not None and tmp_mix.exists():
            tmp_mix.unlink()
