// Настройки: микрофон, калибровка задержки (пой в метроном), сложность, сброс.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureMic, getAudioContext, getAudioInput, stopMic } from '../audio/audioSession';
import { DEFAULT_MIC, type AudioDevice } from '../audio/AudioInput';
import { Synth } from '../audio/synth';
import { RangeSlider } from '../components/RangeSlider';
import { getApiBase, getExternalApiToken, setApiBase, setExternalApiToken } from '../lib/api';
import { midiToName } from '../lib/music';
import { DIFFICULTY_META, type Difficulty } from '../lib/songMap';
import { currentLang, setLang, t, type Lang } from '../lib/i18n';
import { micOptions } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { GuitarIcon, type GuitarIconName } from '../guitar/ui/GuitarIcon';
import './vocal.css';

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
  const [serverToken, setServerToken] = useState(getExternalApiToken());
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
          fill.style.background = f.voiced ? 'var(--rp-ok)' : 'var(--rp-light)';
          const lat = input.latencyMs();
          const latText = Number.isNaN(lat)
            ? ''
            : ` · ${t('mic path ~{ms} ms', { ms: Math.round(lat) })} · ${input.kind}`;
          state.textContent =
            (f.voiced
              ? t('voice: {note} · clarity {pct}%', {
                  note: midiToName(Math.round(f.midi)),
                  pct: (f.clarity * 100).toFixed(0),
                })
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
        setCalStatus(
          t('Too few hits ({n}/{total}). Sing clearer and louder, try again.', {
            n: offsets.length,
            total: CLICKS,
          }),
        );
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

  const toggles: Array<{ key: 'micNoiseSuppression' | 'micEchoCancellation' | 'micAutoGain'; label: string; hint: string }> = [
    { key: 'micNoiseSuppression', label: 'Noise suppression', hint: 'mutes background (fans, street), but can cut quiet vocals' },
    { key: 'micEchoCancellation', label: 'Echo cancellation', hint: 'cuts speaker/headphone sound leaking into the mic' },
    { key: 'micAutoGain', label: 'Auto gain', hint: 'the system rides the volume — usually fights the noise gate' },
  ];

  return (
    <div className="screen settings-screen rp-page vo-page" data-ui="vocal-settings">
      <ScreenHeader
        title={t('Make yourself comfortable.')}
        eyebrow={t('Studio settings')}
        subtitle={t('A good session starts with a setup that feels right.')}
        action={
          <span className="rp-chip rp-chip--ok">
            <GuitarIcon name="check" size="sm" />
            {t('Your voice and practice preferences are saved automatically.')}
          </span>
        }
      />
      <div className="vo-settings">
        <nav className="vo-settings__nav" aria-label={t('Settings sections')}>
          {(
            [
              ['microphone', 'Microphone', 'microphone'],
              ['calibration', 'Calibration', 'clock'],
              ['difficulty', 'Practice', 'wave-sine'],
              ['language', 'Language', 'language'],
              ['motion', 'Motion', 'eye'],
              ['voice', 'My voice', 'user'],
              ['server', 'Song processing server', 'cpu'],
              ['data', 'Data', 'trash'],
            ] as [string, string, GuitarIconName][]
          ).map(([id, label, icon]) => (
            <button key={id} onClick={() => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' })}>
              <GuitarIcon name={icon} size="sm" />
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="vo-settings__content">
          <section className="rp-card rp-card--pad vo-block" id="settings-microphone">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="microphone" />
              {t('Microphone')}
            </h2>
            <div className="rp-field">
              <select
                className="rp-select vo-select"
                aria-label={t('Microphone')}
                value={profile.micDeviceId ?? ''}
                onChange={(e) => update({ micDeviceId: e.target.value || null })}
              >
                <option value="">{t('Default')}</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label || t('Microphone {id}', { id: d.id.slice(0, 6) })}
                  </option>
                ))}
              </select>
              <span className="rp-field__hint">{t('If the names are empty — grant mic access (the “Test” button below) and come back.')}</span>
            </div>
            <div className="vo-toggles">
              {toggles.map(({ key, label, hint }) => (
                <div className="rp-toggle-row" key={key}>
                  <button
                    type="button"
                    role="switch"
                    className="rp-switch"
                    aria-checked={profile[key]}
                    aria-label={t(label)}
                    onClick={() => update({ [key]: !profile[key] })}
                  />
                  <span className="rp-toggle-row__text">
                    {t(label)}
                    <small>{t(hint)}</small>
                  </span>
                </div>
              ))}
            </div>
            <RangeSlider
              min={2}
              max={30}
              step={0.5}
              value={profile.micGateRms * 1000}
              onChange={(v) => update({ micGateRms: v / 1000 })}
              label={
                <>
                  <span>
                    {t('Noise gate — volume threshold')}
                    <small className="rp-field__hint vo-block__hint">{t('anything below counts as silence; raise it if the dot twitches from noise')}</small>
                  </span>
                  <b className="rp-num">{gateDb} dB</b>
                </>
              }
            />
            <RangeSlider
              min={0.4}
              max={0.9}
              step={0.01}
              value={profile.micGateClarity}
              onChange={(v) => update({ micGateClarity: v })}
              label={
                <>
                  <span>
                    {t('Pitch clarity threshold')}
                    <small className="rp-field__hint vo-block__hint">{t('higher — fewer false notes from noise, but whispers/rasp won’t register')}</small>
                  </span>
                  <b className="rp-num">{(profile.micGateClarity * 100).toFixed(0)} %</b>
                </>
              }
            />
            <div className="vo-meter" aria-hidden="true">
              <div className="vo-meter__fill" ref={meterFillRef} />
              <div className="vo-meter__gate" style={{ left: `${gatePct}%` }} title={t('Noise gate — volume threshold')} />
            </div>
            <p className="rp-xs rp-faint">
              <span ref={meterStateRef}>{monitoring ? '…' : t('press “Test” to see the live level')}</span>
            </p>
            <div className="vo-row">
              <button className={monitoring ? 'rp-btn' : 'rp-btn rp-btn--light'} onClick={() => setMonitoring((m) => !m)}>
                <GuitarIcon name={monitoring ? 'player-stop-filled' : 'microphone'} size="sm" />
                {monitoring ? t('Stop') : t('Test microphone')}
              </button>
              <button
                className="rp-btn rp-btn--ghost"
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
                <GuitarIcon name="arrow-back-up" size="sm" />
                {t('Reset')}
              </button>
            </div>
            {micError && <p className="vo-error">{micError}</p>}
            <p className="rp-xs rp-faint">
              {t(
                'How to tune: stay silent — the bar should sit left of the threshold mark; say “aaah” — the bar turns green and moves right. If headphone noise “sings” on its own, raise the gate or enable noise suppression.',
              )}
            </p>
          </section>

          <section className="rp-card rp-card--pad vo-block" id="settings-calibration">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="clock" />
              {t('Latency calibration')}
            </h2>
            <p className="rp-sm rp-muted">
              {t(
                'Current correction: {ms} ms. You’ll hear {n} clicks — sing a short “ta” exactly on each one. This compensates for audio latency when scoring.',
                { ms: profile.latencyMs, n: CLICKS },
              )}
            </p>
            <div className="vo-row">
              <button className="rp-btn rp-btn--light" disabled={calibrating} onClick={() => void calibrate()}>
                <GuitarIcon name={calibrating ? 'loader-2' : 'metronome'} size="sm" className={calibrating ? 'vo-spin' : undefined} />
                {calibrating ? t('Listening…') : t('Calibrate')}
              </button>
              <span className="rp-chip rp-chip--plain">
                <span className="rp-num">{profile.latencyMs}</span> {t('ms')}
              </span>
            </div>
            {calStatus && <p className="rp-sm">{calStatus}</p>}
          </section>

          <section className="rp-card rp-card--pad vo-block" id="settings-difficulty">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="wave-sine" />
              {t('Default difficulty')}
            </h2>
            <div className="rp-seg" role="radiogroup" aria-label={t('Default difficulty')}>
              {(Object.keys(DIFFICULTY_META) as Difficulty[]).map((d) => (
                <button key={d} className="rp-seg__item" role="radio" aria-checked={d === profile.difficulty} onClick={() => update({ difficulty: d })}>
                  {t(DIFFICULTY_META[d].label)}
                </button>
              ))}
            </div>
          </section>

          <section className="rp-card rp-card--pad vo-block" id="settings-language">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="language" />
              {t('Language')}
            </h2>
            <div className="rp-seg" role="radiogroup" aria-label={t('Language')}>
              {(['en', 'ru'] as Lang[]).map((l) => (
                <button
                  key={l}
                  className="rp-seg__item"
                  role="radio"
                  aria-checked={l === currentLang()}
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

          <section className="rp-card rp-card--pad vo-block" id="settings-motion">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="eye" />
              {t('Motion')}
            </h2>
            <div className="rp-toggle-row">
              <button
                type="button"
                role="switch"
                className="rp-switch"
                aria-checked={profile.reduceMotion}
                aria-label={t('Stationary notes')}
                onClick={() => update({ reduceMotion: !profile.reduceMotion })}
              />
              <span className="rp-toggle-row__text">
                {t('Stationary notes')}
                <small>{t('Notes stay in place; the playhead moves. Pages change without sliding.')}</small>
              </span>
            </div>
          </section>

          <section className="rp-card rp-card--pad vo-block" id="settings-voice">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="user" />
              {t('Voice')}
            </h2>
            <div className="vo-row">
              <button className="rp-btn" onClick={() => navigate('/range')}>
                <GuitarIcon name="microphone" size="sm" />
                {t('Remeasure range')}
              </button>
            </div>
          </section>

          <section className="rp-card rp-card--pad vo-block" id="settings-server">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="cpu" />
              {t('Song processing server')}
            </h2>
            <p className="rp-sm rp-muted">
              {t('The backend that separates vocals and extracts the melody. Warm-ups and exercises work without it.')}
            </p>
            <div className="vo-row">
              <label className="rp-input vo-grow">
                <GuitarIcon name="link" size="sm" />
                <input
                  type="url"
                  aria-label={t('Song processing server')}
                  placeholder="http://localhost:8000"
                  value={serverUrl}
                  onChange={(e) => {
                    setServerUrl(e.target.value);
                    setServerToken('');
                  }}
                />
              </label>
              <button
                className="rp-btn"
                onClick={() => {
                  setApiBase(serverUrl);
                  setExternalApiToken(serverToken);
                  setServerUrl(getApiBase());
                }}
              >
                {t('Save')}
              </button>
            </div>
            <label className="rp-field">
              <span className="rp-field__head rp-sm rp-muted">{t('External server token (optional)')}</span>
              <span className="rp-input">
                <GuitarIcon name="lock" size="sm" />
                <input type="password" autoComplete="off" value={serverToken} onChange={(e) => setServerToken(e.target.value)} />
              </span>
            </label>
          </section>

          <section className="rp-card rp-card--pad vo-block" id="settings-data">
            <h2 className="rp-section-title rp-h3">
              <GuitarIcon name="trash" />
              {t('Data')}
            </h2>
            <div className="vo-row">
              <button
                className="rp-btn rp-btn--danger"
                onClick={() => {
                  if (confirm(t('Reset profile, range and all history?'))) {
                    localStorage.clear();
                    // работает и на file:// в десктопном приложении
                    location.hash = '#/';
                    location.reload();
                  }
                }}
              >
                <GuitarIcon name="trash" size="sm" />
                {t('Reset everything')}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
