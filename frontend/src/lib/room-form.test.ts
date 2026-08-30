// The admin room form's patch computation. These tests are the reason that logic is a pure
// function instead of JSX: "blank box means clear" and "missing key means leave alone" are one
// inverted conditional away from wiping a live password, and no type can tell those two
// semantics apart.
import { describe, expect, it } from 'vitest';
import { roomFormWarning, roomPatch, toLocalInput, type RoomFormBaseline } from './room-form';

const BASE: RoomFormBaseline = {
  roomId: '4112233',
  roomPassword: 'cnx9911',
  note: null,
  releaseSource: 'GLOBAL',
  releaseAt: '2026-09-01T14:00:00.000Z',
  releaseMinutes: 5,
};

const FORM = { roomId: '4112233', roomPassword: 'cnx9911', note: '', lead: '', pin: '' };

describe('roomPatch', () => {
  it('sends nothing when nothing changed', () => {
    expect(roomPatch(BASE, FORM)).toEqual({});
    // A form with no row behind it must not invent one out of empty boxes.
    expect(roomPatch(null, { roomId: '', roomPassword: '', note: '', lead: '', pin: '' })).toEqual({});
  });

  it('treats an emptied box as a clear, and whitespace-only as the same thing', () => {
    expect(roomPatch(BASE, { ...FORM, roomPassword: '' })).toEqual({ roomPassword: '' });
    expect(roomPatch(BASE, { ...FORM, roomId: '   ' })).toEqual({ roomId: '' });
  });

  it('does not call trailing whitespace an edit', () => {
    expect(roomPatch(BASE, { ...FORM, roomId: '  4112233 ' })).toEqual({});
    expect(roomPatch(BASE, { ...FORM, note: '  ' })).toEqual({});
    // …while a row that never had a note still sees text as a change.
    expect(roomPatch(BASE, { ...FORM, note: 'held for finals' })).toEqual({ note: 'held for finals' });
  });

  it('writes only the fields the admin touched', () => {
    expect(roomPatch(BASE, { ...FORM, roomPassword: 'newpw22', lead: '20' })).toEqual({
      roomPassword: 'newpw22',
      releaseMinutesBeforeStart: 20,
    });
  });

  describe('the release lead', () => {
    it('leaves the platform default alone when the box is blank and no override exists', () => {
      expect(roomPatch({ ...BASE, releaseMinutes: 5 }, { ...FORM, lead: '' })).toEqual({});
    });

    it('clears the event override when the box is emptied', () => {
      const pinned: RoomFormBaseline = { ...BASE, releaseSource: 'EVENT', releaseMinutes: 20 };
      expect(roomPatch(pinned, { ...FORM, lead: '' })).toEqual({ releaseMinutesBeforeStart: null });
      // Re-typing the same number is not an edit…
      expect(roomPatch(pinned, { ...FORM, lead: '20' })).toEqual({});
      // …but matching the PLATFORM number is, because it is still an explicit override.
      expect(roomPatch({ ...BASE, releaseMinutes: 5 }, { ...FORM, lead: '5' })).toEqual({ releaseMinutesBeforeStart: 5 });
    });

    it('refuses to send a number the API would reject', () => {
      expect(roomPatch(BASE, { ...FORM, lead: 'ten' })).toEqual({});
      expect(roomPatch(BASE, { ...FORM, lead: '5.5' })).toEqual({});
      expect(roomPatch(BASE, { ...FORM, lead: '2000' })).toEqual({});
      // 0 is a real answer ("no lead"), which is why `lead: '0'` must not read as blank.
      expect(roomPatch(BASE, { ...FORM, lead: '0' })).toEqual({ releaseMinutesBeforeStart: 0 });
    });
  });

  describe('the pinned instant', () => {
    it('sends an absolute instant, not the wall-clock string', () => {
      const patch = roomPatch(BASE, { ...FORM, pin: '2026-09-01T13:55' });
      expect(Object.keys(patch)).toEqual(['releaseAt']);
      // The browser's own zone, same conversion the tournament builder applies to start times.
      expect(new Date(String(patch.releaseAt)).getTime()).toBe(new Date('2026-09-01T13:55').getTime());
    });

    it('re-opens a pinned form with no diff, and clearing a pin means re-deriving', () => {
      const pinned: RoomFormBaseline = { ...BASE, releaseSource: 'PINNED' };
      const local = toLocalInput(pinned.releaseAt);
      expect(roomPatch(pinned, { ...FORM, pin: local })).toEqual({});
      expect(roomPatch(pinned, { ...FORM, pin: '' })).toEqual({ releaseAt: null });
      // Nothing to clear when it was never pinned — that key must stay absent.
      expect(roomPatch(BASE, { ...FORM, pin: '' })).toEqual({});
    });
  });
});

describe('roomFormWarning', () => {
  it('refuses a password nobody can join with', () => {
    expect(roomFormWarning({ ...FORM, roomId: '', roomPassword: 'abc12' })).toMatch(/no Room ID/);
  });

  it('flags the shapes players cannot type into Free Fire', () => {
    expect(roomFormWarning({ ...FORM, roomId: 'ab' })).toMatch(/3–20 characters/);
    expect(roomFormWarning({ ...FORM, roomId: 'room 42!' })).toMatch(/3–20 characters/);
    expect(roomFormWarning({ ...FORM, roomPassword: 'a'.repeat(40) })).toMatch(/3–30 characters/);
  });

  it('flags a lead the server would refuse, and stays quiet on a valid form', () => {
    expect(roomFormWarning({ ...FORM, lead: '9999' })).toMatch(/0 and 1440/);
    expect(roomFormWarning({ ...FORM, lead: 'abc' })).toMatch(/0 and 1440/);
    expect(roomFormWarning(FORM)).toBeNull();
    expect(roomFormWarning({ roomId: '4112233', roomPassword: 'cnx9911', note: 'x', lead: '0', pin: '' })).toBeNull();
  });
});

describe('toLocalInput', () => {
  it('round-trips through a Date without drifting a minute', () => {
    const iso = '2026-09-01T13:55:00.000Z';
    expect(toLocalInput(iso)).toBe(toLocalInput(new Date(iso)));
    expect(toLocalInput('')).toBe('');
    expect(toLocalInput(null)).toBe('');
  });
});
