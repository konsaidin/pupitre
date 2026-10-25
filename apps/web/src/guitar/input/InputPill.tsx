// Пилюля входа в шапке раздела (ui-spec §11.1): LED состояния, имя устройства (при перегрузе — слово «Перегруз»: цвет не
// единственный признак), мини-уровень (5 делений из кадров анимации), задержка звука; клик — «Вход и звук». Задержка —
// после калибровки (этап 21a), до неё «—». В игре (§11.6, снизу слева) — та же пилюля без ссылки и задержки.
import { useEffect, useRef, type RefObject } from 'react';
import { t } from '../../lib/i18n';
import { HashLink } from '../HashLink';
import { useGuitarSettings } from '../store/settings';
import { inputOpen, pillView } from './inputView';
import { useInputSnapshot, useLevelFrames } from './useInput';

/** Порог деления, dBFS: −48, −36, −24, −12, −6 (последнее — «горячее»). */
const BARS_DB = [-48, -36, -24, -12, -6];

/** Мини-уровень: деления горят по столбику шкалы, пока вход открыт. */
function useMiniMeter(open: boolean) {
  const meter = useRef<HTMLSpanElement>(null);
  useLevelFrames(open, (level) => {
    const bars = meter.current?.children;
    if (!bars) return;
    for (let i = 0; i < bars.length; i++) {
      const on = level.barDb >= BARS_DB[i];
      bars[i].classList.toggle('on', on);
      bars[i].classList.toggle('hot', on && i === bars.length - 1);
    }
  });
  useEffect(() => {
    if (open || !meter.current) return;
    for (const bar of meter.current.children) bar.classList.remove('on', 'hot');
  }, [open]);
  return meter;
}

const MiniMeter = ({ meter }: { meter: RefObject<HTMLSpanElement> }) => (
  <span className="rp-mini-meter" aria-hidden="true" ref={meter}>
    <i />
    <i />
    <i />
    <i />
    <i />
  </span>
);

export function InputPill() {
  const [settings] = useGuitarSettings();
  const snap = useInputSnapshot();
  const meter = useMiniMeter(inputOpen(snap.state));
  const { led, name, title } = pillView(snap, settings.input.deviceId !== null, settings.input.deviceLabel ?? '');
  return (
    <HashLink
      className="rp-inputpill"
      to="/guitar/input"
      title={title}
      aria-label={`${t('Input and sound')}: ${name}. ${title}`}
      data-ui="shell-input-pill"
      data-state={snap.state}
      data-backend={snap.backend}
    >
      <span className={led ? `rp-led ${led}` : 'rp-led'} />
      <span className="rp-inputpill__name">{name}</span>
      <MiniMeter meter={meter} />
      <span className="rp-num">— {t('ms')}</span>
    </HashLink>
  );
}

/** Пилюля входа в игре: видно, что гитару слышно. */
export function GameInputPill() {
  const [settings] = useGuitarSettings();
  const snap = useInputSnapshot();
  const meter = useMiniMeter(inputOpen(snap.state));
  const { led, name, title } = pillView(snap, settings.input.deviceId !== null, settings.input.deviceLabel ?? '');
  return (
    <span className="hud-pill" title={title} data-ui="play-input" data-state={snap.state}>
      <span className={led ? `rp-led ${led}` : 'rp-led'} />
      {name}
      <MiniMeter meter={meter} />
    </span>
  );
}
