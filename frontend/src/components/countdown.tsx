'use client';
// Live countdown — tabular numerals per the design system.
import { useEffect, useState } from 'react';
import { msToCountdown } from '@/lib/format';

export function Countdown({ targetMs, className = '' }: { targetMs: number; className?: string }) {
  const [left, setLeft] = useState(targetMs);

  useEffect(() => {
    setLeft(targetMs);
    const started = Date.now();
    const id = setInterval(() => {
      setLeft(targetMs - (Date.now() - started));
    }, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  if (left <= 0) return <span className={className}>Now</span>;
  return <span className={`tabular ${className}`}>{msToCountdown(left)}</span>;
}
