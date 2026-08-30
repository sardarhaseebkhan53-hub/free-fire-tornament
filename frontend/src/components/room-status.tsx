// Room status, in one place for the whole frontend (spec: `Room Not Added`,
// `Room Scheduled`, `Room Available`, `Room Cancelled`).
//
// The labels come from the API, not from here — this map only supplies the tone and a
// word for spots that have room to be terser than the full phrase. Keeping the strings
// server-side means the admin panel, the player card and the audit log can never drift
// into three different names for the same state; keeping the COLOURS here means adding a
// fifth state is one entry in two files, not a hunt through JSX.
import type { RoomStatus } from '@/lib/types';

export const ROOM_TONE: Record<RoomStatus, string> = {
  NOT_ADDED: 'bg-fg-2/15 text-fg-2 border-fg-2/30',
  SCHEDULED: 'bg-warning/10 text-warning border-warning/30',
  AVAILABLE: 'bg-success/10 text-success border-success/30',
  CANCELLED: 'bg-danger/10 text-danger border-danger/30',
};

export const ROOM_SHORT: Record<RoomStatus, string> = {
  NOT_ADDED: 'Not added',
  SCHEDULED: 'Scheduled',
  AVAILABLE: 'Available',
  CANCELLED: 'Cancelled',
};

/** `title` carries the full phrase, so the terse word never hides which state it is. */
export function RoomPill({
  status,
  label,
  className = '',
}: {
  status: RoomStatus;
  label?: string | null;
  className?: string;
}) {
  return (
    <span
      title={label ?? `Room ${ROOM_SHORT[status] ?? status}`}
      className={`inline-flex items-center rounded-pill border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] ${ROOM_TONE[status] ?? ROOM_TONE.NOT_ADDED} ${className}`}
    >
      {label ?? `Room ${ROOM_SHORT[status] ?? status}`}
    </span>
  );
}
