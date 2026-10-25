// Ползунок «Рампы»: подпись и значение в строке поля, нативный input[type=range] с заливкой через --v.
import type { CSSProperties, ReactNode } from 'react';

interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  label?: ReactNode;
}

export function RangeSlider({ min, max, step = 1, value, onChange, label }: RangeSliderProps) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <label className="rp-field vo-slider">
      {label && <span className="rp-field__head">{label}</span>}
      <input
        type="range"
        className="rp-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ '--v': `${pct}%` } as CSSProperties}
      />
    </label>
  );
}
