// Schema-drift detection: the code queried a table/column the database does
// not have yet (missing migrations). These must be classified as drift (→ a
// 503 DATABASE_OUT_OF_DATE with an actionable dev message) and never fall
// through to a generic 500 INTERNAL_ERROR.
import { describe, expect, it } from 'vitest';
import { isSchemaDriftError } from '../../src/lib/respond';

describe('isSchemaDriftError', () => {
  it('flags Prisma P2021 (table/relation missing) and P2022 (column missing)', () => {
    expect(isSchemaDriftError({ code: 'P2021', message: 'The table `tournament_rooms` does not exist' })).toBe(true);
    expect(isSchemaDriftError({ code: 'P2022', message: 'The column `releaseMinutes` does not exist' })).toBe(true);
  });

  it('flags the driver-level Prisma message for a missing relation', () => {
    const err = new Error(
      'Invalid `prisma.tournamentRoom.findMany()` invocation:\nThe table `public.tournament_rooms` does not exist in the current database.',
    );
    expect(isSchemaDriftError(err)).toBe(true);
  });

  it('flags raw Postgres undefined_table / undefined_column messages', () => {
    expect(isSchemaDriftError(new Error('relation "push_subscriptions" does not exist'))).toBe(true);
    expect(isSchemaDriftError(new Error('column "hiddenAt" does not exist'))).toBe(true);
  });

  it('does NOT flag unrelated errors (business errors, contention, validation)', () => {
    expect(isSchemaDriftError({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
    expect(isSchemaDriftError(new Error('Insufficient balance'))).toBe(false);
    expect(isSchemaDriftError({ code: 'P2034' })).toBe(false);
    expect(isSchemaDriftError(null)).toBe(false);
    expect(isSchemaDriftError(undefined)).toBe(false);
  });
});
