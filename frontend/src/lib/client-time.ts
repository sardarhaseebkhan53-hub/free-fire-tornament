'use client';
// Client-only time helpers.
//
// Reading the clock during render is impure (it breaks React's ability to
// re-run a render safely and produces SSR/CSR hydration drift), so every
// "now" in the UI flows through these hooks: the first sample is taken in a
// requestAnimationFrame right after paint, then on a fixed interval.
// Components render a neutral placeholder until the first sample arrives,
// which is also what the server renders — so hydration always matches.
import { useEffect, useState } from 'react';

/** Current epoch ms, or `null` before the first client sample. */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick);
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [intervalMs]);

  return now;
}

/**
 * Milliseconds left of a duration that started when the component mounted.
 * Returns `null` before the first client sample.
 */
export function useTimeLeft(durationMs: number, intervalMs = 1000): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = () => setLeft(durationMs - (Date.now() - startedAt));
    const raf = requestAnimationFrame(tick);
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [durationMs, intervalMs]);

  return left;
}

/** Milliseconds until an absolute deadline (epoch ms or ISO string). */
export function useTimeUntil(at: number | string, intervalMs = 1000): number | null {
  const targetAt = typeof at === 'string' ? Date.parse(at) : at;
  const now = useNow(intervalMs);
  return now === null ? null : targetAt - now;
}
