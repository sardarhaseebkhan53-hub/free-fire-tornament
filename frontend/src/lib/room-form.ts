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
//
// Free Fire credentials are NUMERIC ONLY (Room ID and password are digits, full stop).
// The same patterns live in the backend (room.service) — the two files carry the rule in
// parallel because the packages can't import each other; keep them textually identical.
import type { AdminRoom } from '@/lib/types';

/** Room ID: digits only, 3–20 of them. Free Fire IDs stay STRINGS — never Number(). */
export const ROOM_ID_RE = /^\d{3,20}$/;
/** Room password: digits only, 3–30 of them. */
export const ROOM_PW_RE = /^\d{3,30}$/;

export const ROOM_ID_RULE = 'Room ID must be numbers only — 3 to 20 digits.';
export const ROOM_PW_RULE = 'Room password must be numbers only — 3 to 30 digits.';

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
 * Filter a typed/pasted credential to the digits-only shape the backend will
 * accept. Kept on a TEXT input (not `type="number"`) so leading zeros survive
 * and 20-digit room IDs never round through a floating-point Number. The
 * backend re-validates whatever actually arrives — this is UX, not security.
 */
export function cleanRoomCredential(v: string, max: number): string {
  return v.replace(/\D/g, '').slice(0, max);
}

/**
 * `PUT /api/admin/tournaments/:id/room` body — only what the admin actually changed.
 *
 * Keys are added only on a real difference, so an untouched box never writes. Values are
 * trimmed before comparing (an editor that appends a space is not an edit) but a box the admin
 * EMPTIED sends `''`, which is the server's instruction to clear the column.
 *
 * Credentials are sent EXACTLY as entered (the inputs only hold digits) — the backend's
 * pattern check is the authority, and its message is what the admin sees.
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
 * These mirror the backend's own rules as a WARNING only — the server stays the authority
 * (it rejects the same shapes with the same words), and a red hint under a box beats a form
 * that quietly accepts what players then cannot type into Free Fire.
 */
export function roomFormWarning(values: RoomFormValues): string | null {
  const id = values.roomId.trim();
  const pw = values.roomPassword.trim();
  if (pw !== '' && id === '') return 'A password with no Room ID cannot be saved — players need both to get in.';
  if (id !== '' && !ROOM_ID_RE.test(id)) return ROOM_ID_RULE;
  if (pw !== '' && !ROOM_PW_RE.test(pw)) return ROOM_PW_RULE;
  const lead = values.lead.trim();
  if (lead !== '' && (!/^\d+$/.test(lead) || Number(lead) > 1440)) return 'A whole number of minutes between 0 and 1440, or blank for the platform default.';
  return null;
}

/** Is there anything worth a request? (Also what disables the Save button.) */
export function roomPatchIsDirty(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length > 0;
}
