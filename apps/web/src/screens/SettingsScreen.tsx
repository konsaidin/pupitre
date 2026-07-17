// Настройки: микрофон, калибровка задержки (пой в метроном), сложность, сброс.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureMic, getAudioContext, getAudioInput, stopMic } from '../audio/audioSession';
import { DEFAULT_MIC, type AudioDevice } from '../audio/AudioInput';
import { Synth } from '../audio/synth';
import { RangeSlider } from '../components/RangeSlider';
import { getApiBase, setApiBase } from '../lib/api';
import { midiToName } from '../lib/music';
import { DIFFICULTY_META, type Difficulty } from '../lib/songMap';
import { currentLang, setLang, t, type Lang } from '../lib/i18n';
import { micOptions } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { ScreenHeader } from '../components/ScreenHeader';

const CLICKS = 10;
const CLICK_INTERVAL = 0.6; // сек (100 BPM)

export function SettingsScreen() {
  const { profile, update } = useProfile();
  const navigate = useNavigate();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [calibrating, setCalibrating] = useState(false);
  const [calStatus, setCalStatus] = useState<string | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const cancelRef = useRef(false);
  const meterFillRef = useRef<HTMLDivElement>(null);
  const meterStateRef = useRef<HTMLSpanElement>(null);

  // живой монитор уровня: показывает громкость, порог гейта и «голос пойман»
  useEffect(() => {
    if (!monitoring) return;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        setMicError(null);
        const input = await ensureMic(profile.micDeviceId, micOptions(profile));
        if (cancelled) return;
        unsub = input.onFrame((f) => {
          const fill = meterFillRef.current;
          const state = meterStateRef.current;
          if (!fill || !state) return;
          // шкала -60..-10 дБFS
          const db = 20 * Math.log10(Math.max(1e-5, f.rms));
          const pct = Math.min(100, Math.max(0, ((db + 60) / 50) * 100));
          fill.style.width = `${pct}%`;
          fill.style.background = f.voiced ? 'var(--green)' : 'var(--accent)';
          const lat = input.latencyMs();
          const latText = Number.isNaN(lat)
            ? ''
            : ` · ${t('mic path ~{ms} ms', { ms: Math.round(lat) })} · ${input.kind}`;
          state.textContent =
            (f.voiced
              ? t('voice: {note} · clarity {pct}%', { note: midiToName(Math.round(f.midi)), pct: (f.clarity * 100).toFixed(0) })
              : f.rms >= profile.micGateRms
                ? t('sound detected, but it’s not a clear note (below clarity threshold)')
                : t('silence (below the gate)')) + latText;
        });
      } catch (e) {
        setMicError(e instanceof Error ? e.message : t('Could not open the microphone'));
        setMonitoring(false);
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
    // при смене устройства/обработки поток перезапустится, пороги обновятся на лету
  }, [monitoring, profile]);

  useEffect(() => {
    if (!monitoring) stopMic();
  }, [monitoring]);

  const gateDb = Math.round(20 * Math.log10(profile.micGateRms));
  const gatePct = Math.min(100, Math.max(0, ((gateDb + 60) / 50) * 100));

  useEffect(() => {
    getAudioInput()
      .listDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
    return () => {
      cancelRef.current = true;
      stopMic();
    };
  }, []);

  const calibrate = async () => {
    setCalibrating(true);
    setCalStatus(t('Listen to the clicks and sing a short “ta” on each…'));
    cancelRef.current = false;
    try {
      const ctx = getAudioContext();
      const input = await ensureMic(profile.micDeviceId, micOptions(profile));
      const synth = new Synth(ctx, 0.6);
      const t0 = ctx.currentTime + 1;
      const clickTimes: number[] = [];
      for (let i = 0; i < CLICKS; i++) {
        const t = t0 + i * CLICK_INTERVAL;
        synth.playClick(t, i === 0);
        clickTimes.push(t);
      }
      // ловим онсеты голоса: переход из тишины в voiced
      const onsets: number[] = [];
      let wasVoiced = false;
      const unsub = input.onFrame((f) => {
        if (f.voiced && !wasVoiced) onsets.push(f.t);
        wasVoiced = f.voiced;
      });
      await new Promise((res) => setTimeout(res, (1 + CLICKS * CLICK_INTERVAL + 0.6) * 1000));
      unsub();
      if (cancelRef.current) return;
      // для каждого клика — ближайший онсет в окне [-150, +400] мс
      const offsets: number[] = [];
      for (const ct of clickTimes) {
        let best: number | null = null;
        for (const ot of onsets) {
          const d = (ot - ct) * 1000;
          if (d >= -150 && d <= 400 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
        }
        if (best !== null) offsets.push(best);
      }
      if (offsets.length < 4) {
        setCalStatus(t('Too few hits ({n}/{total}). Sing clearer and louder, try again.', { n: offsets.length, total: CLICKS }));
        return;
      }
      offsets.sort((a, b) => a - b);
      const median = offsets[Math.floor(offsets.length / 2)];
      const latencyMs = Math.max(0, Math.round(median));
      update({ latencyMs });
      setCalStatus(t('Done: {ms} ms latency (from {n} hits). Saved.', { ms: latencyMs, n: offsets.length }));
    } catch (e) {
      setCalStatus(e instanceof Error ? e.message : t('Calibration failed'));
    } finally {
      setCalibrating(false);
      stopMic();
    }
  };

  return (
    <div className="screen">
      <ScreenHeader title={t('Settings')} />

      <section className="settings-block">
        <h2 className="cat">{t('Microphone')}</h2>
        <select
          value={profile.micDeviceId ?? ''}
          onChange={(e) => update({ micDeviceId: e.target.value || null })}
        >
          <option value="">{t('Default')}</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>{d.label || t('Microphone {id}', { id: d.id.slice(0, 6) })}</option>
          ))}
        </select>
        <p className="dim small">{t('If the names are empty — grant mic access (the “Test” button below) and come back.')}</p>

        <label className="check">
          <input
            type="checkbox"
            checked={profile.micNoiseSuppression}
            onChange={(e) => update({ micNoiseSuppression: e.target.checked })}
          />
          {t('Noise suppression')}
          <span className="dim small">{t('mutes background (fans, street), but can cut quiet vocals')}</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={profile.micEchoCancellation}
            onChange={(e) => update({ micEchoCancellation: e.target.checked })}
          />
          {t('Echo cancellation')}
          <span className="dim small">{t('cuts speaker/headphone sound leaking into the mic')}</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={profile.micAutoGain}
            onChange={(e) => update({ micAutoGain: e.target.checked })}
          />
          {t('Auto gain')}
          <span className="dim small">{t('the system rides the volume — usually fights the noise gate')}</span>
        </label>

        <RangeSlider
          min={2}
          max={30}
          step={0.5}
          value={profile.micGateRms * 1000}
          onChange={(v) => update({ micGateRms: v / 1000 })}
          label={
            <span>
              {t('Noise gate — volume threshold')} <b className="mono">{gateDb} dB</b>{' '}
              <span className="dim small">{t('anything below counts as silence; raise it if the dot twitches from noise')}</span>
            </span>
          }
        />
        <RangeSlider
          min={0.4}
          max={0.9}
          step={0.01}
          value={profile.micGateClarity}
          onChange={(v) => update({ micGateClarity: v })}
          label={
            <span>
              {t('Pitch clarity threshold')} <b className="mono">{(profile.micGateClarity * 100).toFixed(0)}%</b>{' '}
              <span className="dim small">{t('higher — fewer false notes from noise, but whispers/rasp won’t register')}</span>
            </span>
          }
        />

        <div className="mic-meter" aria-hidden="true">
          <div className="mic-meter-fill" ref={meterFillRef} />
          <div className="mic-meter-gate" style={{ left: `${gatePct}%` }} title={t('Noise gate — volume threshold')} />
        </div>
        <p className="dim small mic-meter-state">
          <span ref={meterStateRef}>{monitoring ? '…' : t('press “Test” to see the live level')}</span>
        </p>

        <div className="btn-row tight">
          <button className="btn" onClick={() => setMonitoring((m) => !m)}>
            {monitoring ? t('■ Stop') : t('🎤 Test microphone')}
          </button>
          <button
            className="btn ghost"
            onClick={() =>
              update({
                micNoiseSuppression: DEFAULT_MIC.noiseSuppression,
                micEchoCancellation: DEFAULT_MIC.echoCancellation,
                micAutoGain: DEFAULT_MIC.autoGain,
                micGateRms: DEFAULT_MIC.gateRms,
                micGateClarity: DEFAULT_MIC.gateClarity,
              })
            }
          >
            {t('Reset')}
          </button>
        </div>
        {micError && <p className="error">⚠️ {micError}</p>}
        <p className="dim small">
          {t('How to tune: stay silent — the bar should sit left of the threshold mark; say “aaah” — the bar turns green and moves right. If headphone noise “sings” on its own, raise the gate or enable noise suppression.')}
        </p>
      </section>

      <section className="settings-block">
        <h2 className="cat">{t('Latency calibration')}</h2>
        <p className="dim">
          {t('Current correction: {ms} ms. You’ll hear {n} clicks — sing a short “ta” exactly on each one. This compensates for audio latency when scoring.', { ms: profile.latencyMs, n: CLICKS })}
        </p>
        <button className="btn primary" disabled={calibrating} onClick={() => void calibrate()}>
          {calibrating ? t('Listening…') : t('Calibrate')}
        </button>
        {calStatus && <p className="hint">{calStatus}</p>}
      </section>

      <section className="settings-block">
        <h2 className="cat">{t('Default difficulty')}</h2>
        <div className="seg">
          {(Object.keys(DIFFICULTY_META) as Difficulty[]).map((d) => (
            <button
              key={d}
              className={d === profile.difficulty ? 'seg-btn active' : 'seg-btn'}
              onClick={() => update({ difficulty: d })}
            >
              {t(DIFFICULTY_META[d].label)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-block">
        <h2 className="cat">{t('Language')}</h2>
        <div className="seg">
          {(['en', 'ru'] as Lang[]).map((l) => (
            <button
              key={l}
              className={l === currentLang() ? 'seg-btn active' : 'seg-btn'}
              onClick={() => {
                if (l === currentLang()) return;
                setLang(l);
                location.reload();
              }}
            >
              {l === 'en' ? 'English' : 'Русский'}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-block">
        <h2 className="cat">{t('Voice')}</h2>
        <button className="btn" onClick={() => navigate('/range')}>{t('Remeasure range')}</button>
      </section>

      <section className="settings-block">
        <h2 className="cat">{t('Song processing server')}</h2>
        <p className="dim small">
          {t('The backend that separates vocals and extracts the melody. Warm-ups and exercises work without it.')}
        </p>
        <div className="btn-row tight">
          <input
            className="text-input"
            type="url"
            placeholder="http://localhost:8000"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
          />
          <button
            className="btn"
            onClick={() => {
              setApiBase(serverUrl);
              setServerUrl(getApiBase());
            }}
          >
            {t('Save')}
          </button>
        </div>
      </section>

      <section className="settings-block">
        <h2 className="cat">{t('Data')}</h2>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(t('Reset profile, range and all history?'))) {
              localStorage.clear();
              // работает и на file:// в десктопном приложении
              location.hash = '#/';
              location.reload();
            }
          }}
        >
          {t('Reset everything')}
        </button>
      </section>
    </div>
  );
}
