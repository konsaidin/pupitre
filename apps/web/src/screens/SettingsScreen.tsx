// Настройки: микрофон, калибровка задержки (пой в метроном), сложность, сброс.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureMic, getAudioContext, stopMic } from '../audio/audioSession';
import { Synth } from '../audio/synth';
import { DIFFICULTY_META, type Difficulty } from '../lib/songMap';
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
  const cancelRef = useRef(false);

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
      const tracker = await ensureMic(profile.micDeviceId);
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
        <p className="dim small">Если названия пустые — дай доступ к микрофону (кнопка калибровки ниже) и вернись сюда.</p>
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
        <h2 className="cat">Данные</h2>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('Сбросить профиль, диапазон и всю историю результатов?')) {
              localStorage.clear();
              location.href = '/';
            }
          }}
        >
          Сбросить всё
        </button>
      </section>
    </div>
  );
}
