// Крутилка как на усилителе (SVG): тень на панели, юбка со шкалой, рифлёный корпус, металлический колпачок с бликом,
// указатель. Управление: тянуть вверх-вниз (с Shift — точнее), колесо, стрелки и PgUp/PgDn, Home/End; двойной клик —
// значение по умолчанию. Точное значение — при наведении и фокусе. Для экранного диктора — ползунок (role="slider").
import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';

export type KnobCap = 'chrome' | 'black' | 'cream' | 'yellow';

const SWEEP = 270;
const START = -135;
/** Ход мыши на всю шкалу, px. */
const DRAG_PX = 220;

interface Props {
  /** Маркировка на корпусе — по-английски, как на железе, без перевода. */
  label: string;
  /** Имя для экранного диктора — переводом (и с номером, если маркировка ручки не различает). */
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Двойной клик — сюда. */
  initial: number;
  shown: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  size?: number;
  cap?: KnobCap;
  /** Цифры 0–10 вокруг шкалы. */
  numbers?: boolean;
  ui: string;
}

const CAPS: Record<KnobCap, [string, string, string]> = {
  chrome: ['#fbfbfb', '#b7b9bd', '#6f7277'],
  black: ['#55585e', '#25272b', '#0c0d0f'],
  cream: ['#fff6df', '#e3d3ad', '#a8946a'],
  yellow: ['#fff3a6', '#f2c400', '#9a7400'],
};

export function Knob(props: Props) {
  const { value, min, max, step, onChange, disabled } = props;
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; value: number } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  // последнее выставленное значение: шаги клавиш и колеса подряд (быстрее перерисовки) не теряются
  const current = useRef(value);
  current.current = value;
  const set = (v: number) => {
    const next = Number(clamp(v).toFixed(6));
    if (next === current.current) return;
    current.current = next;
    onChange(next);
  };
  const fraction = (value - min) / (max - min);
  const angle = START + SWEEP * fraction;
  const size = props.size ?? 76;
  const [hi, mid, lo] = CAPS[props.cap ?? 'chrome'];

  // колесо: слушатель не пассивный — иначе страница прокрутится вместе с ручкой
  const latest = useRef({ set, step, disabled });
  latest.current = { set, step, disabled };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const k = latest.current;
      if (k.disabled) return;
      e.preventDefault();
      k.set(current.current + (e.deltaY < 0 ? 1 : -1) * k.step * (e.shiftKey ? 1 : 2));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { y: e.clientY, value };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const span = (max - min) * (e.shiftKey ? 0.25 : 1);
    set(d.value + ((d.y - e.clientY) / DRAG_PX) * span);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = (max - min) / 10;
    const moves: Record<string, number> = {
      ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big,
    };
    if (e.key in moves) set(current.current + moves[e.key]);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else return;
    e.preventDefault();
  };

  const ticks = Array.from({ length: 11 }, (_, i) => START + (SWEEP / 10) * i);
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  return (
    <div className="knob" data-ui={props.ui} data-disabled={disabled || undefined}>
      <div
        ref={ref}
        className="knob__dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={props.name}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={props.shown}
        aria-disabled={disabled || undefined}
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => !disabled && set(props.initial)}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="-56 -56 112 112" width={size} height={size} aria-hidden="true">
          <defs>
            <radialGradient id={`${id}-shadow`} cx="0.56" cy="0.62" r="0.5">
              <stop offset="0.55" stopColor="#000" stopOpacity="0.55" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-body`} cx="0.35" cy="0.3" r="0.8">
              <stop offset="0" stopColor="#4a4c50" />
              <stop offset="0.55" stopColor="#1b1c1f" />
              <stop offset="1" stopColor="#050506" />
            </radialGradient>
            <linearGradient id={`${id}-cap`} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
              <stop offset="0" stopColor={hi} />
              <stop offset="0.45" stopColor={mid} />
              <stop offset="0.7" stopColor={lo} />
              <stop offset="1" stopColor={mid} />
            </linearGradient>
            <radialGradient id={`${id}-shine`} cx="0.35" cy="0.25" r="0.45">
              <stop offset="0" stopColor="#fff" stopOpacity={props.cap === 'black' ? 0.16 : 0.55} />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* шкала на панели */}
          {ticks.map((a, i) => (
            <line key={a} className="knob__tick" data-major={i % 5 === 0 || undefined}
              x1={Math.cos(rad(a)) * 41} y1={Math.sin(rad(a)) * 41} x2={Math.cos(rad(a)) * (i % 5 === 0 ? 47 : 45)} y2={Math.sin(rad(a)) * (i % 5 === 0 ? 47 : 45)} />
          ))}
          {props.numbers &&
            [0, 5, 10].map((n) => (
              <text key={n} className="knob__num" x={Math.cos(rad(ticks[n])) * 53} y={Math.sin(rad(ticks[n])) * 53 + 3} textAnchor="middle">
                {n}
              </text>
            ))}
          {/* тень на панели, юбка, рифлёный корпус */}
          <circle r="38" fill={`url(#${id}-shadow)`} transform="translate(3 5)" />
          <circle r="34" fill={`url(#${id}-body)`} stroke="#000" strokeOpacity="0.7" />
          <circle r="31" fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="4" strokeDasharray="1.4 1.6" />
          <g transform={`rotate(${angle})`}>
            <line x1="0" y1="-26" x2="0" y2="-33" className="knob__mark" />
          </g>
          {/* колпачок с бликом и указателем */}
          <circle r="23" fill={`url(#${id}-cap)`} stroke="#000" strokeOpacity="0.45" />
          <circle r="23" fill={`url(#${id}-shine)`} />
          <circle r="16" fill="none" stroke="#fff" strokeOpacity="0.18" />
          <g transform={`rotate(${angle})`}>
            <line x1="0" y1="-6" x2="0" y2="-21" className="knob__pointer" data-cap={props.cap ?? 'chrome'} />
          </g>
        </svg>
      </div>
      <span className="knob__label">{props.label}</span>
      <span className="knob__value rp-num" aria-hidden="true">{props.shown}</span>
    </div>
  );
}
