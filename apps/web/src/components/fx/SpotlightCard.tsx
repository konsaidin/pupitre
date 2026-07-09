// Интерактивная карточка с бликом-прожектором, лёгким наклоном и частицами при наведении
// (адаптировано из reactbits.dev/components/magic-bento под тему проекта).
import { createElement, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { gsap } from 'gsap';
import './SpotlightCard.css';

interface SpotlightCardProps {
  as?: 'button' | 'div';
  children: ReactNode;
  className?: string;
  glowColor?: string;
  tilt?: boolean;
  magnetism?: boolean;
  particles?: boolean;
  onClick?: () => void;
  role?: string;
  tabIndex?: number;
  disabled?: boolean;
}

const isCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export function SpotlightCard({
  as = 'div',
  children,
  className = '',
  glowColor = '99, 102, 241',
  tilt = true,
  magnetism = true,
  particles = true,
  onClick,
  role,
  tabIndex,
  disabled,
}: SpotlightCardProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || isCoarsePointer()) return;

    let particleEls: HTMLDivElement[] = [];
    let timeouts: ReturnType<typeof setTimeout>[] = [];
    let hovered = false;

    const clearParticles = () => {
      timeouts.forEach(clearTimeout);
      timeouts = [];
      particleEls.forEach((p) => gsap.to(p, { scale: 0, opacity: 0, duration: 0.25, onComplete: () => p.remove() }));
      particleEls = [];
    };

    const spawnParticles = () => {
      const { width, height } = el.getBoundingClientRect();
      for (let i = 0; i < 7; i++) {
        const t = setTimeout(() => {
          if (!hovered) return;
          const p = document.createElement('div');
          p.className = 'sp-particle';
          p.style.left = `${Math.random() * width}px`;
          p.style.top = `${Math.random() * height}px`;
          p.style.background = `rgba(${glowColor}, 1)`;
          p.style.boxShadow = `0 0 6px rgba(${glowColor}, 0.8)`;
          el.appendChild(p);
          particleEls.push(p);
          gsap.fromTo(p, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.7)' });
          gsap.to(p, {
            x: (Math.random() - 0.5) * 70,
            y: (Math.random() - 0.5) * 70,
            duration: 2 + Math.random() * 2,
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut',
          });
        }, i * 90);
        timeouts.push(t);
      }
    };

    const onEnter = () => {
      hovered = true;
      if (particles) spawnParticles();
    };
    const onLeave = () => {
      hovered = false;
      clearParticles();
      el.style.setProperty('--glow-intensity', '0');
      if (tilt) gsap.to(el, { rotateX: 0, rotateY: 0, duration: 0.4, ease: 'power2.out' });
      if (magnetism) gsap.to(el, { x: 0, y: 0, duration: 0.4, ease: 'power2.out' });
    };
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      el.style.setProperty('--glow-x', `${(x / rect.width) * 100}%`);
      el.style.setProperty('--glow-y', `${(y / rect.height) * 100}%`);
      el.style.setProperty('--glow-intensity', '1');
      if (tilt) {
        gsap.to(el, {
          rotateX: ((y - cy) / cy) * -5,
          rotateY: ((x - cx) / cx) * 5,
          duration: 0.15,
          ease: 'power2.out',
          transformPerspective: 800,
        });
      }
      if (magnetism) {
        gsap.to(el, { x: (x - cx) * 0.04, y: (y - cy) * 0.04, duration: 0.3, ease: 'power2.out' });
      }
    };
    const onClickFx = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const maxD = Math.max(
        Math.hypot(x, y),
        Math.hypot(x - rect.width, y),
        Math.hypot(x, y - rect.height),
        Math.hypot(x - rect.width, y - rect.height),
      );
      const ripple = document.createElement('div');
      ripple.className = 'sp-ripple';
      ripple.style.width = ripple.style.height = `${maxD * 2}px`;
      ripple.style.left = `${x - maxD}px`;
      ripple.style.top = `${y - maxD}px`;
      ripple.style.background = `radial-gradient(circle, rgba(${glowColor},0.35) 0%, rgba(${glowColor},0.15) 30%, transparent 70%)`;
      el.appendChild(ripple);
      gsap.fromTo(
        ripple,
        { scale: 0, opacity: 1 },
        { scale: 1, opacity: 0, duration: 0.7, ease: 'power2.out', onComplete: () => ripple.remove() },
      );
    };

    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('click', onClickFx);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('click', onClickFx);
      clearParticles();
    };
  }, [glowColor, tilt, magnetism, particles]);

  const style = { '--glow-color': glowColor } as CSSProperties;

  return createElement(
    as,
    {
      ref,
      className: `spotlight-card ${className}`,
      style,
      onClick,
      role,
      tabIndex,
      ...(as === 'button' ? { disabled } : {}),
    },
    children,
  );
}
