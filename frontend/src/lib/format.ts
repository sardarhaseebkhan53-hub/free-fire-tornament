// Shared formatting helpers (display only — all money math happens server-side).

export function money(value: number | string | { toString(): string } | null | undefined): string {
  const n = Number(value ?? 0);
  return `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function dateTime(d: string | Date): string {
  const date = new Date(d);
  return date.toLocaleString('en-PK', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export function dateOnly(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function msToCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (days > 0) return `${days}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const MODE_LABEL: Record<string, string> = {
  SOLO: 'Solo',
  DUO: 'Duo',
  SQUAD: 'Squad',
  CLASH_SQUAD: 'Clash Squad',
};

export const STATUS_LABEL: Record<string, string> = {
  REGISTRATION_OPEN: 'Open',
  LIVE: 'Live',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DRAFT: 'Draft',
};
