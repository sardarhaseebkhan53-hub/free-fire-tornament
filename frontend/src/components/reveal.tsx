'use client';
// =============================================================================
// Reveal — tasteful scroll-into-view animation (fade + slight rise).
// IntersectionObserver-driven, GPU-friendly (opacity/transform), one-shot
// (animates once, then unobserve), respects prefers-reduced-motion via the
// `.js .reveal` CSS guard. `as` lets callers render a semantic element.
// =============================================================================
import { useEffect, useRef, type ElementType, type ReactNode } from 'react';

export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
}: {
  children: ReactNode;
  /** Stagger delay in ms (kept small — 0–300). */
  delay?: number;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -32px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={`reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
