// Текст с бегущим бликом (адаптировано из reactbits.dev/text-animations/shiny-text).
import type { ReactNode } from 'react';
import './ShinyText.css';

export function ShinyText({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`shiny-text ${className}`}>{children}</span>;
}
