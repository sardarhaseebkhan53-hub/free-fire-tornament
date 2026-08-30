// The admin room form's diff, as a pure function.
//
// This is the one piece of client logic in the feature that can cause data loss: the API
// reads a MISSING key as "leave that column alone" and an empty string as "clear it", so a
// form that (a) resent fields it never displayed, or (b) treated a blank box as "no change",
// would quietly wipe a colleague's password or leave a stale one published. Computing the
// patch from the loaded row — and nowhere else — makes both impossible, and keeps the rule in
// one place that can be tested without a DOM.
//
// It also has to know the release SOURCE, not just the number: `releaseMinutes: 5` arriving
// from the platform default and `releaseMinutes: 5` pinned on the event are different rows,
// and blanking a box must clear the event's own override while leaving the platform value
// alone — not write a literal 5 onto the event.
import type { AdminRoom } from '@/lib/types';

/** Raw input values, as strings — exactly what the boxes hold, including `''`. */
export interface RoomFormValues {
  roomId: string;
  roomPassword: string;
  note: string;
  /** `''` = "use the platform default"; the field has no other way to say that */
  lead: string;
  /** `datetime-local` text; `''` = "no pinned instant" */
  pin: string;
}

/** The subset of the loaded row the diff needs. */
export type RoomFormBaseline = Pick<AdminRoom, 'roomId' | 'roomPassword' | 'note' | 'releaseSource' | 'releaseAt' | 'releaseMinutes'>;

/** `datetime-local` wants wall-clock digits, not a UTC string. */
export function toLocalInput(d: Date | string | null): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * `PUT /api/admin/tournaments/:id/room` body — only what the admin actually changed.
 *
 * Keys are added only on a real difference, so an untouched box never writes. Values are
 * trimmed before comparing (an editor that appends a space is not an edit) but a box the admin
 * EMPTIED sends `''`, which is the server's instruction to clear the column.
 */
export function roomPatch(baseline: RoomFormBaseline | null, next: RoomFormValues): Record<string, string | number | null> {
  if (!baseline) return {};
  const out: Record<string, string | number | null> = {};

  const id = next.roomId.trim();
  if (id !== (baseline.roomId ?? '')) out.roomId = id;

  const pw = next.roomPassword.trim();
  if (pw !== (baseline.roomPassword ?? '')) out.roomPassword = pw;

  const note = next.note.trim();
  if (note !== (baseline.note ?? '')) out.note = note;

  // Lead: the box is either a number, or "no event override".
  const leadNum = next.lead.trim() === '' ? null : Number(next.lead);
  const baselineLead = baseline.releaseSource === 'EVENT' ? baseline.releaseMinutes : null;
  if (leadNum !== baselineLead) {
    // A non-numeric box (browser autofill, a stray comma) is not a change we can express,
    // and sending `NaN` would be rejected by zod as "not a number" — confusingly, after the
    // admin pressed Save. Leave it out and let the field's own validation surface it.
    if (leadNum === null) out.releaseMinutesBeforeStart = null;
    else if (Number.isInteger(leadNum) && leadNum >= 0 && leadNum <= 1440) out.releaseMinutesBeforeStart = leadNum;
  }

  // Pin: same reasoning, with the baseline expressed in the same minute granularity the
  // input can hold, so re-opening a form nobody touched produces no diff.
  const baselinePin = baseline.releaseSource === 'PINNED' ? toLocalInput(baseline.releaseAt) : '';
  const pin = next.pin.trim();
  if (pin !== baselinePin) out.releaseAt = pin === '' ? null : new Date(pin).toISOString();

  return out;
}

/**
 * Two halves, but only ever one credential: a password nobody can join with is a trap.
 *
 * These mirror the service's own `ROOM_ID_RE` / `ROOM_PW_RE` as a WARNING only — the server
 * stays the authority (it rejects the same shapes), and a red hint under a box beats a form
 * that quietly accepts what players then cannot type into Free Fire.
 */
export function roomFormWarning(values: RoomFormValues): string | null {
  const id = values.roomId.trim();
  const pw = values.roomPassword.trim();
  if (pw !== '' && id === '') return 'A password with no Room ID cannot be saved — players need both to get in.';
  if (id !== '' && !/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/.test(id)) return '3–20 characters: letters, numbers, - and _. Players type this in Free Fire.';
  if (pw !== '' && !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,29}$/.test(pw)) return '3–30 characters: letters, numbers, . _ and -.';
  const lead = values.lead.trim();
  if (lead !== '' && (!/^\d+$/.test(lead) || Number(lead) > 1440)) return 'A whole number of minutes between 0 and 1440, or blank for the platform default.';
  return null;
}

/** Is there anything worth a request? (Also what disables the Save button.) */
export function roomPatchIsDirty(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length > 0;
}
