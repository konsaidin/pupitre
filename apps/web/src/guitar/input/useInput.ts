// Вход в разделе: настройки → сессия входа (audio/instrument/session), снимок состояния для экранов и пилюли, уровень по
// кадрам анимации — прямо в DOM (CSS-переменные и классы), без перерисовки React.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  acquireInput,
  configureInput,
  getInputSnapshot,
  readLevel,
  subscribeInput,
  type InputLevel,
  type InputSnapshot,
} from '../../audio/instrument/session';
import { toneParams } from '../../audio/guitar/tone';
import { updateGuitarSettings, useGuitarSettings } from '../store/settings';
import { noiseKeyOf } from './inputView';

export const useInputSnapshot = (): InputSnapshot => useSyncExternalStore(subscribeInput, getInputSnapshot, getInputSnapshot);

/** Доля шкалы −60…0 dBFS. */
export const meterFraction = (db: number) => (Number.isFinite(db) ? Math.min(1, Math.max(0, (db + 60) / 60)) : 0);

/** «−12», «0»; тишина — «−∞». Минус — типографский. */
export const formatDb = (db: number) => (Number.isFinite(db) ? `${Math.round(db) < 0 ? '−' : ''}${Math.abs(Math.round(db))}` : '−∞');

/**
 * Раздел держит вход, пока смонтирован (ставится один раз в GuitarApp): выбранное устройство открывается, канал,
 * мониторинг и порог тишины применяются на лету. Отдельный компонент — смена состояния входа не перерисовывает раздел.
 */
export function InputSession() {
  const [settings] = useGuitarSettings();
  const { deviceId, deviceLabel = '', channel, noiseDb, noiseKey, backend, bufferFrames = 128, outputDeviceId = null } = settings.input;
  const monitorGain = settings.monitoring.mode === 'tone' ? settings.mix.monitor : 0;
  const tone = useMemo(() => toneParams(settings.tone), [settings.tone]);
  // Фон измерен на другом входе — порог по умолчанию.
  const noise = noiseKey === noiseKeyOf(deviceId, channel) && typeof noiseDb === 'number' ? noiseDb : NaN;
  // Порядок эффектов важен: настройки — до держателя, чтобы первое открытие шло уже на выбранное устройство.
  useEffect(
    () => configureInput({ deviceId, deviceLabel, channel, monitorGain, noiseDb: noise, backend, bufferFrames, outputDeviceId, tone }),
    [deviceId, deviceLabel, channel, monitorGain, noise, backend, bufferFrames, outputDeviceId, tone],
  );
  useEffect(() => acquireInput(), []);
  const snap = useInputSnapshot();
  // То же устройство пришло с новым id (сессия нашла его по метке) — запоминаем новый вместе с ключом замера фона.
  useEffect(() => {
    if (!snap.deviceId || !deviceId || snap.deviceId === deviceId || !snap.label || snap.label !== deviceLabel) return;
    const fresh = snap.deviceId;
    updateGuitarSettings((s) => ({
      ...s,
      input: {
        ...s.input, deviceId: fresh,
        ...(s.input.noiseKey === noiseKeyOf(deviceId, s.input.channel) ? { noiseKey: noiseKeyOf(fresh, s.input.channel) } : {}),
      },
    }));
  }, [snap.deviceId, snap.label, deviceId, deviceLabel]);
  return null;
}

/** Пока active — fn каждый кадр анимации с уровнем входа (шкалы пишут в DOM сами; объект уровня — общий, не хранить). */
export function useLevelFrames(active: boolean, fn: (level: InputLevel) => void) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const frame = (now: number) => {
      latest.current(readLevel(now));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}
