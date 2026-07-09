// Панель «настройки извлечения»: ползунки параметров снятия мелодии и
// переснятие карты от сохранённого вокала (быстро, без Demucs).

import { useEffect, useRef, useState } from 'react';
import { getSong, loadSongMap, reextractSong } from '../lib/api';
import { t } from '../lib/i18n';
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
  return `${Math.round(hz)} Hz (≈${midiNames[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1})`;
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
        if (info.status === 'error') throw new Error(info.error || t('Re-extraction failed'));
      }
      const fresh = await loadSongMap(map.id);
      if (!alive.current) return;
      onApplied(fresh);
      onClose();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : t('Re-extraction failed'));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <div className="panel extract-panel">
        <h2>{t('Extraction settings')}</h2>
        <p className="dim small">
          {t('The melody will be re-extracted from the saved vocals — fast, no re-separation. Current notes (including manual edits) will be replaced.')}
        </p>

        <RangeSlider
          min={40} max={400} step={5} value={params.fmin}
          onChange={(v) => set({ fmin: v, fmax: Math.max(params.fmax, v + 100) })}
          label={<span>{t('Search range, low')} <b className="mono">{hzLabel(params.fmin)}</b></span>}
        />
        <RangeSlider
          min={300} max={2000} step={10} value={params.fmax}
          onChange={(v) => set({ fmax: v, fmin: Math.min(params.fmin, v - 100) })}
          label={<span>{t('Search range, high')} <b className="mono">{hzLabel(params.fmax)}</b></span>}
        />
        <RangeSlider
          min={0} max={20} step={0.5} value={params.gateRatio * 100}
          onChange={(v) => set({ gateRatio: v / 100 })}
          label={<span>{t('Quiet cutoff')} <b className="mono">{(params.gateRatio * 100).toFixed(1)}%</b> <span className="dim small">{t('lower — catches whispers and tails, but noise too')}</span></span>}
        />
        <RangeSlider
          min={40} max={300} step={10} value={params.minNoteMs}
          onChange={(v) => set({ minNoteMs: v })}
          label={<span>{t('Min note length')} <b className="mono">{t('{n} ms', { n: params.minNoteMs })}</b></span>}
        />
        <RangeSlider
          min={0} max={300} step={10} value={params.mergeGapMs}
          onChange={(v) => set({ mergeGapMs: v })}
          label={<span>{t('Merge across gaps up to')} <b className="mono">{t('{n} ms', { n: params.mergeGapMs })}</b></span>}
        />
        <RangeSlider
          min={0.3} max={2} step={0.05} value={params.splitSemitones}
          onChange={(v) => set({ splitSemitones: v })}
          label={<span>{t('Note splitting')} <b className="mono">{t('{n} st', { n: params.splitSemitones.toFixed(2) })}</b> <span className="dim small">{t('smaller — more short notes')}</span></span>}
        />
        <RangeSlider
          min={1} max={15} step={2} value={params.medianWidth}
          onChange={(v) => set({ medianWidth: v })}
          label={<span>{t('Smoothing')} <b className="mono">{t('{n} frames', { n: params.medianWidth })}</b></span>}
        />

        {busy && (
          <p className="dim small">
            {t('Extracting the melody… {pct} — usually under a minute.', { pct: progress > 0 ? `${progress}%` : '' })}
          </p>
        )}
        {error && <p className="error small">⚠️ {error}</p>}

        <div className="btn-row tight">
          <button className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? '…' : t('Re-extract melody')}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => setParams({ ...EXTRACT_DEFAULTS })}>
            {t('Reset')}
          </button>
          <button className="btn ghost" disabled={busy} onClick={onClose}>{t('Close')}</button>
        </div>
      </div>
    </div>
  );
}
