// Панель «настройки извлечения»: ползунки параметров снятия мелодии и
// переснятие карты от сохранённого вокала (быстро, без Demucs).

import { useEffect, useRef, useState } from 'react';
import { getSong, loadSongMap, reextractSong } from '../lib/api';
import { EXTRACT_DEFAULTS, type ExtractSettings, type SongMap } from '../lib/songMap';
import { RangeSlider } from './fx/RangeSlider';

interface ExtractionPanelProps {
  map: SongMap;
  /** пришла новая карта после переснятия */
  onApplied: (map: SongMap) => void;
  onClose: () => void;
}

const midiNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function hzLabel(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${Math.round(hz)} Гц (≈${midiNames[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1})`;
}

export function ExtractionPanel({ map, onApplied, onClose }: ExtractionPanelProps) {
  const [params, setParams] = useState<ExtractSettings>({ ...EXTRACT_DEFAULTS, ...map.extract });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // тело эффекта обязано взводить флаг заново: в StrictMode маунт двойной,
  // и cleanup первого прохода иначе оставил бы alive=false навсегда
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const set = (patch: Partial<ExtractSettings>) => setParams((p) => ({ ...p, ...patch }));

  const run = async () => {
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      await reextractSong(map.id, params);
      // поллим статус; analyze на полном треке может занять десятки секунд
      for (;;) {
        await new Promise((r) => setTimeout(r, 1200));
        if (!alive.current) return;
        const info = await getSong(map.id);
        setProgress(info.progress);
        if (info.status === 'done') {
          if (info.error) throw new Error(info.error);
          break;
        }
        if (info.status === 'error') throw new Error(info.error || 'обработка упала');
      }
      const fresh = await loadSongMap(map.id);
      if (!alive.current) return;
      onApplied(fresh);
      onClose();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Не удалось переснять');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <div className="panel extract-panel">
        <h2>Настройки извлечения</h2>
        <p className="dim small">
          Мелодия переснимется с сохранённого вокала — быстро, без повторного разделения.
          Текущие ноты в карте (включая ручные правки) будут заменены.
        </p>

        <RangeSlider
          min={40} max={400} step={5} value={params.fmin}
          onChange={(v) => set({ fmin: v, fmax: Math.max(params.fmax, v + 100) })}
          label={<span>Нижняя граница поиска <b className="mono">{hzLabel(params.fmin)}</b></span>}
        />
        <RangeSlider
          min={300} max={2000} step={10} value={params.fmax}
          onChange={(v) => set({ fmax: v, fmin: Math.min(params.fmin, v - 100) })}
          label={<span>Верхняя граница поиска <b className="mono">{hzLabel(params.fmax)}</b></span>}
        />
        <RangeSlider
          min={0} max={20} step={0.5} value={params.gateRatio * 100}
          onChange={(v) => set({ gateRatio: v / 100 })}
          label={<span>Отсечка тихого <b className="mono">{(params.gateRatio * 100).toFixed(1)}%</b> <span className="dim small">ниже — ловит шёпот и хвосты, но и шум</span></span>}
        />
        <RangeSlider
          min={40} max={300} step={10} value={params.minNoteMs}
          onChange={(v) => set({ minNoteMs: v })}
          label={<span>Мин. длина ноты <b className="mono">{params.minNoteMs} мс</b></span>}
        />
        <RangeSlider
          min={0} max={300} step={10} value={params.mergeGapMs}
          onChange={(v) => set({ mergeGapMs: v })}
          label={<span>Склейка через паузу до <b className="mono">{params.mergeGapMs} мс</b></span>}
        />
        <RangeSlider
          min={0.3} max={2} step={0.05} value={params.splitSemitones}
          onChange={(v) => set({ splitSemitones: v })}
          label={<span>Дробление нот <b className="mono">{params.splitSemitones.toFixed(2)} пт</b> <span className="dim small">меньше — больше коротких нот</span></span>}
        />
        <RangeSlider
          min={1} max={15} step={2} value={params.medianWidth}
          onChange={(v) => set({ medianWidth: v })}
          label={<span>Сглаживание <b className="mono">{params.medianWidth} кадров</b></span>}
        />

        {busy && (
          <p className="dim small">
            Снимаю мелодию… {progress > 0 ? `${progress}%` : ''} — обычно до минуты.
          </p>
        )}
        {error && <p className="error small">⚠️ {error}</p>}

        <div className="btn-row tight">
          <button className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? '…' : 'Переснять мелодию'}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => setParams({ ...EXTRACT_DEFAULTS })}>
            Сбросить
          </button>
          <button className="btn ghost" disabled={busy} onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
