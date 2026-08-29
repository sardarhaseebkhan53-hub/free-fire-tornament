// Shared formatting helpers (display only — all money math happens server-side).

export function money(value: number | string | { toString(): string } | null | undefined): string {
  const n = Number(value ?? 0);
  return `PKR ${n.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

/**
 * Spreadsheet-style seat label: #1 → A, #2 → B … #26 → Z, #27 → AA …
 * Used on the admin slot board and player-facing seat chips so seats read as
 * A–Z instead of only zero-padded numbers.
 */
export function slotLabel(n: number): string {
  const value = Math.max(1, Math.floor(Number(n) || 1));
  let out = '';
  let x = value;
  while (x > 0) {
    x -= 1;
    out = String.fromCharCode(65 + (x % 26)) + out;
    x = Math.floor(x / 26);
  }
  return out;
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

/** PKR formatter for the user app (design v2: `PKR 1,800`, en-PK grouping). */
export function fmt(n: number | string | null | undefined, decimals = 0): string {
  return `PKR ${Number(n ?? 0).toLocaleString('en-PK', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleString('en-PK', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export const STATUS_LABEL: Record<string, string> = {
  REGISTRATION_OPEN: 'Open',
  LIVE: 'Live',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DRAFT: 'Draft',
};

/**
 * Player-facing tournament state (spec §Status): derives UPCOMING / ALMOST
 * FULL / FULL from slot math so cards and detail pages stay consistent.
 */
export type DisplayStatus =
  | 'UPCOMING' | 'REGISTRATION_OPEN' | 'ALMOST_FULL' | 'FULL'
  | 'LIVE' | 'COMPLETED' | 'CANCELLED';

export function displayStatus(t: {
  status: string;
  registrationOpen: boolean;
  slotsLeft: number;
  startsInMs: number;
}): DisplayStatus {
  if (t.status === 'LIVE') return 'LIVE';
  if (t.status === 'COMPLETED') return 'COMPLETED';
  if (t.status === 'CANCELLED') return 'CANCELLED';
  if (t.status === 'REGISTRATION_OPEN') {
    if (t.slotsLeft <= 0) return 'FULL';
    if (!t.registrationOpen && t.startsInMs > 0) return 'UPCOMING';
    if (t.slotsLeft <= 5) return 'ALMOST_FULL';
    return 'REGISTRATION_OPEN';
  }
  return 'UPCOMING';
}
