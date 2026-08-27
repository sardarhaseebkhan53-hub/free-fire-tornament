'use client';
// Live countdown — tabular numerals per the design system.
//
// The clock is only ever read on the client (see @/lib/client-time), so the
// server and the first client render agree on a neutral placeholder.
import { msToCountdown } from '@/lib/format';
import { useTimeLeft, useTimeUntil } from '@/lib/client-time';

function Rendered({ left, className }: { left: number | null; className?: string }) {
  if (left === null) return <span className={`tabular ${className ?? ''}`}>--:--:--</span>;
  if (left <= 0) return <span className={className}>Now</span>;
  return <span className={`tabular ${className ?? ''}`}>{msToCountdown(left)}</span>;
}

/** Counts down a duration measured from when the component mounts. */
export function Countdown({ targetMs, className = '' }: { targetMs: number; className?: string }) {
  return <Rendered left={useTimeLeft(targetMs)} className={className} />;
}

/** Counts down to an absolute deadline (ISO string or epoch ms). */
export function CountdownUntil({ at, className = '' }: { at: string | number; className?: string }) {
  return <Rendered left={useTimeUntil(at)} className={className} />;
}
