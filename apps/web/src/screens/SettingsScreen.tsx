// Настройки: микрофон, калибровка задержки (пой в метроном), сложность, сброс.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureMic, getAudioContext, stopMic } from '../audio/audioSession';
import { DEFAULT_MIC } from '../audio/PitchTracker';
import { Synth } from '../audio/synth';
import { RangeSlider } from '../components/fx/RangeSlider';
import { getApiBase, setApiBase } from '../lib/api';
import { midiToName } from '../lib/music';
import { DIFFICULTY_META, type Difficulty } from '../lib/songMap';
import { micOptions } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { ScreenHeader } from '../components/ScreenHeader';

const CLICKS = 10;
const CLICK_INTERVAL = 0.6; // сек (100 BPM)

export function SettingsScreen() {
  const { profile, update } = useProfile();
  const navigate = useNavigate();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
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
        const tracker = await ensureMic(profile.micDeviceId, micOptions(profile));
        if (cancelled) return;
        unsub = tracker.onFrame((f) => {
          const fill = meterFillRef.current;
          const state = meterStateRef.current;
          if (!fill || !state) return;
          // шкала -60..-10 дБFS
          const db = 20 * Math.log10(Math.max(1e-5, f.rms));
          const pct = Math.min(100, Math.max(0, ((db + 60) / 50) * 100));
          fill.style.width = `${pct}%`;
          fill.style.background = f.voiced ? 'var(--green)' : 'var(--accent)';
          state.textContent = f.voiced
            ? `голос: ${midiToName(Math.round(f.midi))} · чистота ${(f.clarity * 100).toFixed(0)}%`
            : f.rms >= profile.micGateRms
              ? 'звук есть, но не похож на ноту (чистота ниже порога)'
              : 'тишина (ниже гейта)';
        });
      } catch (e) {
        setMicError(e instanceof Error ? e.message : 'Не удалось открыть микрофон');
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
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => setDevices([]));
    return () => {
      cancelRef.current = true;
      stopMic();
    };
  }, []);

  const calibrate = async () => {
    setCalibrating(true);
    setCalStatus('Слушай клики и пой короткое «та» на каждый…');
    cancelRef.current = false;
    try {
      const ctx = getAudioContext();
      const tracker = await ensureMic(profile.micDeviceId, micOptions(profile));
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
      const unsub = tracker.onFrame((f) => {
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
        setCalStatus(`Мало попаданий (${offsets.length}/${CLICKS}). Пой чётче и громче, попробуй ещё раз.`);
        return;
      }
      offsets.sort((a, b) => a - b);
      const median = offsets[Math.floor(offsets.length / 2)];
      const latencyMs = Math.max(0, Math.round(median));
      update({ latencyMs });
      setCalStatus(`Готово: задержка ${latencyMs} мс (по ${offsets.length} попаданиям). Сохранено.`);
    } catch (e) {
      setCalStatus(e instanceof Error ? e.message : 'Ошибка калибровки');
    } finally {
      setCalibrating(false);
      stopMic();
    }
  };

  return (
    <div className="screen">
      <ScreenHeader title="Настройки" />

      <section className="settings-block">
        <h2 className="cat">Микрофон</h2>
        <select
          value={profile.micDeviceId ?? ''}
          onChange={(e) => update({ micDeviceId: e.target.value || null })}
        >
          <option value="">По умолчанию</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Микрофон ${d.deviceId.slice(0, 6)}`}</option>
          ))}
        </select>
        <p className="dim small">Если названия пустые — дай доступ к микрофону (кнопка «Проверить» ниже) и вернись сюда.</p>

        <label className="check">
          <input
            type="checkbox"
            checked={profile.micNoiseSuppression}
            onChange={(e) => update({ micNoiseSuppression: e.target.checked })}
          />
          Шумоподавление
          <span className="dim small">глушит фон (вентилятор, улицу), но может резать тихий вокал</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={profile.micEchoCancellation}
            onChange={(e) => update({ micEchoCancellation: e.target.checked })}
          />
          Эхоподавление
          <span className="dim small">режет звук из колонок/наушников, попадающий в микрофон</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={profile.micAutoGain}
            onChange={(e) => update({ micAutoGain: e.target.checked })}
          />
          Автоусиление
          <span className="dim small">система сама крутит громкость — обычно мешает нойзгейту</span>
        </label>

        <RangeSlider
          min={2}
          max={30}
          step={0.5}
          value={profile.micGateRms * 1000}
          onChange={(v) => update({ micGateRms: v / 1000 })}
          label={
            <span>
              Нойзгейт — порог громкости <b className="mono">{gateDb} дБ</b>{' '}
              <span className="dim small">всё тише порога считается тишиной; подними, если кружок дёргается от шума</span>
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
              Порог чистоты тона <b className="mono">{(profile.micGateClarity * 100).toFixed(0)}%</b>{' '}
              <span className="dim small">выше — меньше ложных нот от шума, но шёпот/хрип не ловится</span>
            </span>
          }
        />

        <div className="mic-meter" aria-hidden="true">
          <div className="mic-meter-fill" ref={meterFillRef} />
          <div className="mic-meter-gate" style={{ left: `${gatePct}%` }} title="порог гейта" />
        </div>
        <p className="dim small mic-meter-state">
          <span ref={meterStateRef}>{monitoring ? '…' : 'нажми «Проверить», чтобы увидеть уровень вживую'}</span>
        </p>

        <div className="btn-row tight">
          <button className="btn" onClick={() => setMonitoring((m) => !m)}>
            {monitoring ? '■ Остановить' : '🎤 Проверить микрофон'}
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
            Сбросить
          </button>
        </div>
        {micError && <p className="error">⚠️ {micError}</p>}
        <p className="dim small">
          Как настроить: помолчи — полоска должна быть <b>левее</b> метки порога; скажи «а-а-а» — полоска
          зеленеет и уходит правее. Если шум наушников «поёт» сам — подними гейт или включи шумоподавление.
        </p>
      </section>

      <section className="settings-block">
        <h2 className="cat">Калибровка задержки</h2>
        <p className="dim">
          Текущая поправка: <b>{profile.latencyMs} мс</b>. Прозвучит {CLICKS} кликов — пой короткое «та» точно
          на каждый. Это компенсирует задержку наушников и звукового тракта при подсчёте очков.
        </p>
        <button className="btn primary" disabled={calibrating} onClick={() => void calibrate()}>
          {calibrating ? 'Слушаю…' : 'Калибровать'}
        </button>
        {calStatus && <p className="hint">{calStatus}</p>}
      </section>

      <section className="settings-block">
        <h2 className="cat">Сложность по умолчанию</h2>
        <div className="seg">
          {(Object.keys(DIFFICULTY_META) as Difficulty[]).map((d) => (
            <button
              key={d}
              className={d === profile.difficulty ? 'seg-btn active' : 'seg-btn'}
              onClick={() => update({ difficulty: d })}
            >
              {DIFFICULTY_META[d].label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-block">
        <h2 className="cat">Голос</h2>
        <button className="btn" onClick={() => navigate('/range')}>Перемерить диапазон</button>
      </section>

      <section className="settings-block">
        <h2 className="cat">Сервер обработки песен</h2>
        <p className="dim small">
          Адрес бэкенда, который отделяет вокал и снимает мелодию (<code>uvicorn app.main:app --port 8000</code>{' '}
          в <code>services/api</code>). Распевки и упражнения работают без него.
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
            Сохранить
          </button>
        </div>
      </section>

      <section className="settings-block">
        <h2 className="cat">Данные</h2>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('Сбросить профиль, диапазон и всю историю результатов?')) {
              localStorage.clear();
              // работает и на file:// в десктопном приложении
              location.hash = '#/';
              location.reload();
            }
          }}
        >
          Сбросить всё
        </button>
      </section>
    </div>
  );
}
