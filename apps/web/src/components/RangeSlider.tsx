// Ползунок с заполненной дорожкой и светящимся бегунком.
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
  const style = { '--pct': `${pct}%` } as CSSProperties;

  return (
    <label className="field">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={style}
      />
    </label>
  );
}
