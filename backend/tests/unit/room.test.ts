// =============================================================================
// The room release clock — unit tests for the ONE function that decides whether a
// Room ID / password may be seen.
//
// Everything user-visible about the room (the four status labels, the countdown, the
// player's reveal, the scheduler's "release now" decision) is this function's output, so
// the boundary cases are tested here rather than hoped for: "exactly at release" is a
// millisecond comparison that an integration test can only approximate, and an
// off-by-one in it is the entire feature being wrong.
// =============================================================================
import { describe, expect, it } from 'vitest';
import {
  effectiveReleaseMinutes, resolveRoomState, roomCreateColumns, roomPublicView,
} from '../../src/services/room.service';

const START = new Date('2026-09-01T20:00:00.000Z');
const NOW = new Date('2026-09-01T19:55:00.000Z'); // exactly 5 minutes before start

/** A room row with every column at "nothing special"; override what a case cares about. */
const room = (over: Record<string, unknown> = {}) => ({
  status: 'NOT_ADDED',
  roomId: '7412580',
  roomPassword: 'CNX4821',
  releaseAt: null,
  releaseMinutes: null,
  releasedAt: null,
  hiddenAt: null,
  cancelledAt: null,
  cancelReason: null,
  note: null,
  updatedAt: null,
  ...over,
});

const at = (r: Record<string, unknown> | null, now: Date = NOW, globalMinutes = 5) =>
  resolveRoomState({ startTime: START, status: 'REGISTRATION_OPEN', room: r ? room(r) : null }, globalMinutes, now);

describe('resolveRoomState — the release window', () => {
  it('holds a room back BEFORE the release time, and calls it Room Scheduled', () => {
    const s = at({}, new Date(NOW.getTime() - 1));
    expect(s.status).toBe('SCHEDULED');
    expect(s.label).toBe('Room Scheduled');
    expect(s.unlocked).toBe(false);
    expect(s.releaseInMs).toBe(1);
  });

  it('unlocks AT the release instant — the boundary is inclusive, not exclusive', () => {
    // 19:55:00.000 is exactly START − 5min. A `<` here instead of `<=` is the difference
    // between a room that opens on time and one that opens one tick late, every time.
    const s = at({}, NOW);
    expect(s.releaseAt.getTime()).toBe(NOW.getTime());
    expect(s.status).toBe('AVAILABLE');
    expect(s.unlocked).toBe(true);
    expect(s.releaseInMs).toBe(0);
  });

  it('stays open AFTER the release time, including long after', () => {
    expect(at({}, new Date(NOW.getTime() + 1)).unlocked).toBe(true);
    expect(at({}, new Date(START.getTime() + 3 * 3_600_000)).status).toBe('AVAILABLE');
  });

  it('says "Room Not Added" when there is no room row, and when the row is empty', () => {
    expect(at(null).status).toBe('NOT_ADDED');
    expect(at(null).label).toBe('Room Not Added');
    expect(at({ roomId: null, roomPassword: null }).status).toBe('NOT_ADDED');
    // Whitespace is not a credential: a form that saved " " must read as "nothing entered".
    expect(at({ roomId: '   ', roomPassword: '' }).status).toBe('NOT_ADDED');
    expect(at(null, new Date(START.getTime() + 9 * 60_000)).unlocked).toBe(false);
  });

  it('treats a password on its own as a room that exists (it is still a credential)', () => {
    // A room with ONLY a password is a room: the value would be useless without the ID,
    // but hiding it is the job of the clock, not of a validation rule that could be
    // bypassed by writing the row directly.
    const before = at({ roomId: null, roomPassword: 'CNX4821' }, new Date(NOW.getTime() - 1));
    expect(before.hasRoomId).toBe(false);
    expect(before.hasRoomPassword).toBe(true);
    expect(before.status).toBe('SCHEDULED');
    expect(before.unlocked).toBe(false);
    expect(at({ roomId: null, roomPassword: 'CNX4821' }, NOW).unlocked).toBe(true);
  });
});

describe('resolveRoomState — the admin switches win over the clock', () => {
  it('a hidden room is never served, even past its release time', () => {
    const s = at({ hiddenAt: new Date('2026-09-01T19:00:00.000Z') }, START);
    expect(s.hidden).toBe(true);
    expect(s.status).toBe('SCHEDULED');
    expect(s.unlocked).toBe(false);
  });

  it('a cancelled room beats every other state, including the clock and the values', () => {
    const s = at(
      { cancelledAt: new Date('2026-09-01T19:30:00.000Z'), cancelReason: 'Lobby re-made', hiddenAt: null },
      new Date(START.getTime() + 60_000),
    );
    expect(s.status).toBe('CANCELLED');
    expect(s.label).toBe('Room Cancelled');
    expect(s.unlocked).toBe(false);
    expect(s.cancelReason).toBe('Lobby re-made');
  });

  it('a cancelled EVENT is not a way to get a room either', () => {
    const s = resolveRoomState(
      { startTime: START, status: 'CANCELLED', room: room({}) },
      5,
      new Date(START.getTime() + 60_000),
    );
    expect(s.status).toBe('CANCELLED');
    expect(s.unlocked).toBe(false);
    // No explicit reason was stored, so the state explains itself.
    expect(s.cancelReason).toBe('The tournament was cancelled.');
  });
});

describe('resolveRoomState — which knob set the release', () => {
  it('uses the platform-wide lead when the event has no opinion', () => {
    const s = at({}, NOW, 5);
    expect(s.releaseMinutes).toBe(5);
    expect(s.releaseSource).toBe('GLOBAL');
    expect(s.releaseAt.getTime()).toBe(START.getTime() - 5 * 60_000);
  });

  it('an event-specific lead beats the platform value, in both directions', () => {
    // Ten minutes before start, the platform's 5-minute lead has not opened the room
    // yet — a 12-minute lead has, and a 2-minute lead opened it long ago and will again
    // at 19:58, so a longer lead is EARLIER and a shorter one is LATER. Getting this
    // sign backwards would make every "give players more time" setting do the opposite.
    const tenMinutesOut = new Date(START.getTime() - 10 * 60_000);
    expect(at({}, tenMinutesOut, 5).unlocked).toBe(false);

    const early = at({ releaseMinutes: 12 }, tenMinutesOut, 5);
    expect(early.releaseMinutes).toBe(12);
    expect(early.releaseSource).toBe('EVENT');
    expect(early.releaseAt.getTime()).toBe(START.getTime() - 12 * 60_000);
    expect(early.unlocked).toBe(true);
    expect(early.releaseInMs).toBe(-2 * 60_000);

    const late = at({ releaseMinutes: 2 }, tenMinutesOut, 5);
    expect(late.unlocked).toBe(false);
    expect(late.releaseInMs).toBe(8 * 60_000);
  });

  it('a pinned instant beats both, and is what the countdown shows', () => {
    const pinned = new Date('2026-09-01T19:59:30.000Z');
    const s = at({ releaseAt: pinned, releaseMinutes: 60 }, NOW, 5);
    expect(s.releaseSource).toBe('PINNED');
    expect(s.releaseAt.getTime()).toBe(pinned.getTime());
    expect(s.unlocked).toBe(false);
    expect(s.releaseInMs).toBe(4.5 * 60_000);
  });

  it('a lead of 0 means "release at start", and is not mistaken for "unset"', () => {
    // 0 is falsy in JS. `room.releaseMinutes ?? global` keeps it (nullish, not ||), and
    // if that were ever "simplified" to a truthiness check, a deliberate 0 would silently
    // become the platform default on every read.
    const zero = at({ releaseMinutes: 0 }, new Date(START.getTime() - 1), 5);
    expect(zero.releaseMinutes).toBe(0);
    expect(zero.releaseSource).toBe('EVENT');
    expect(zero.unlocked).toBe(false);
    expect(at({ releaseMinutes: 0 }, START, 5).unlocked).toBe(true);
  });

  it('a nonsensical stored lead falls back to the platform value instead of unlocking everything', () => {
    // Guarded at write time, but a row edited by hand must not become `releaseAt = NaN`,
    // which every `<` comparison against it would silently treat as "always ready".
    expect(effectiveReleaseMinutes({ releaseMinutes: -40 }, 5)).toBe(5);
    expect(effectiveReleaseMinutes({ releaseMinutes: null }, 5)).toBe(5);
    expect(effectiveReleaseMinutes(null, 7)).toBe(7);
    expect(effectiveReleaseMinutes({ releaseMinutes: 9000 }, 5)).toBe(1440);
  });
});

describe('roomPublicView — what a player surface is allowed to contain', () => {
  it('has no credential field at all, in either state', () => {
    const open = roomPublicView(at({}, START));
    const held = roomPublicView(at({}, new Date(START.getTime() - 86_400_000)));
    for (const view of [open, held]) {
      expect(Object.keys(view).sort()).toEqual(
        ['cancelReason', 'hidden', 'label', 'releaseAt', 'releaseInMs', 'releaseMinutes', 'status'].sort(),
      );
      expect(view).not.toHaveProperty('roomId');
      expect(view).not.toHaveProperty('roomPassword');
    }
  });

  it('reports no release time at all while there is nothing to release', () => {
    const v = roomPublicView(at(null));
    expect(v.releaseAt).toBeNull();
    expect(v.releaseInMs).toBeNull();
    expect(v.status).toBe('NOT_ADDED');
  });

  it('only surfaces a cancellation reason while the room actually is cancelled', () => {
    expect(roomPublicView(at({ cancelledAt: NOW, cancelReason: 'x' })).cancelReason).toBe('x');
    expect(roomPublicView(at({ cancelReason: 'stale note' })).cancelReason).toBeNull();
  });
});

describe('roomCreateColumns — the builder shares the panel’s rules', () => {
  it('creates nothing at all when both fields are blank', () => {
    expect(roomCreateColumns({ roomId: '', roomPassword: '  ' })).toBeNull();
    expect(roomCreateColumns({})).toBeNull();
  });

  it('accepts a normal Free Fire room and stores it on the release schedule', () => {
    const out = roomCreateColumns({ roomId: '7412580', roomPassword: 'CNX4821' });
    expect(out).toMatchObject({ roomId: '7412580', roomPassword: 'CNX4821', status: 'SCHEDULED' });
  });

  it('rejects the values that break the pipeline rather than the display', () => {
    expect(() => roomCreateColumns({ roomId: '12' })).toThrow(/Room ID/);
    expect(() => roomCreateColumns({ roomId: 'has space' })).toThrow(/Room ID/);
    expect(() => roomCreateColumns({ roomId: '<script>' })).toThrow(/Room ID/);
    expect(() => roomCreateColumns({ roomId: '7412580', roomPassword: 'p@ss' })).toThrow(/password/);
    expect(() => roomCreateColumns({ roomPassword: 'CNX4821' })).toThrow(/not a room/);
    expect(() => roomCreateColumns({ roomId: '7412580', releaseMinutesBeforeStart: 2000 })).toThrow(/1440/);
  });

  it('trims, and treats an empty password as "no password" rather than an empty string', () => {
    const out = roomCreateColumns({ roomId: ' 7412580 ', roomPassword: '   ' });
    expect(out?.roomId).toBe('7412580');
    expect(out?.roomPassword).toBeNull();
  });
});
