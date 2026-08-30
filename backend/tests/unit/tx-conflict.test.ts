// =============================================================================
// Unit — the transient-conflict classifier shared by every money path.
//
// A database "you lost the race" error must never reach a player as a 500, and
// a business rejection must never be retried (retrying INSUFFICIENT_BALANCE
// would just hammer the wallet). These tests pin both halves of that rule.
// =============================================================================
import { describe, expect, it, vi } from 'vitest';
import { ApiError, badRequest } from '../../src/lib/errors';
import {
  confirmAbsent,
  isLostConnection,
  isRetryableTxError,
  isTransientDriverError,
  isUnmappableResponse,
  readAfterUniqueViolation,
  withIdempotentRetry,
  withoutBlindRetry,
} from '../../src/lib/tx-conflict';

const dbError = (code: string) => Object.assign(new Error('conflict'), { code });

describe('isRetryableTxError', () => {
  it('recognises every documented "rolled back, try again" code', () => {
    for (const code of ['P2034', 'P2039', '40001', '40P01']) {
      expect(isRetryableTxError(dbError(code))).toBe(true);
    }
  });

  it('refuses to classify anything else as retryable', () => {
    expect(isRetryableTxError(badRequest('INSUFFICIENT_BALANCE', 'nope'))).toBe(false);
    expect(isRetryableTxError(dbError('P2002'))).toBe(false); // unique violation
    expect(isRetryableTxError(new Error('boom'))).toBe(false);
    expect(isRetryableTxError(undefined)).toBe(false);
    expect(isRetryableTxError(null)).toBe(false);
  });
});

describe('isLostConnection', () => {
  it('recognises transient pool failures reported by the driver', () => {
    expect(isLostConnection(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isLostConnection(new Error("Can't reach database server at 127.0.0.1:5432"))).toBe(true);
  });

  it('does not swallow unrelated errors', () => {
    expect(isLostConnection(new Error('column "amount" does not exist'))).toBe(false);
    expect(isLostConnection(badRequest('VALIDATION_ERROR', 'no'))).toBe(false);
  });
});

describe('withIdempotentRetry', () => {
  it('retries contention and returns the first success', async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(dbError('40001'))
      .mockRejectedValueOnce(dbError('P2034'))
      .mockResolvedValue('ok');
    await expect(withIdempotentRetry(op, { busyMessage: 'busy' })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('recovers from a dead pooled connection', async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockResolvedValue('committed once');
    await expect(withIdempotentRetry(op, { busyMessage: 'busy' })).resolves.toBe('committed once');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('never retries a business rejection', async () => {
    const op = vi.fn<() => Promise<string>>().mockRejectedValue(badRequest('INSUFFICIENT_BALANCE', 'no funds'));
    await expect(withIdempotentRetry(op, { busyMessage: 'busy' })).rejects.toThrow('no funds');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('gives up with a clean 409 instead of leaking a database code', async () => {
    const op = vi.fn<() => Promise<string>>().mockRejectedValue(dbError('P2039'));
    const err = await withIdempotentRetry(op, { attempts: 2, busyMessage: 'wallet is busy' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe('wallet is busy');
    expect(op).toHaveBeenCalledTimes(2);
  });
});

describe('withoutBlindRetry', () => {
  it('converts contention into a 409 without retrying', async () => {
    let calls = 0;
    const op = async () => {
      calls += 1;
      throw dbError('40P01');
    };
    const err = await withoutBlindRetry(op, 'try that again').catch((e) => e);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe('try that again');
    // Retrying an un-anchored money write is how double payouts happen.
    expect(calls).toBe(1);
  });

  it('passes real failures straight through', async () => {
    await expect(withoutBlindRetry(async () => {
      throw badRequest('VALIDATION_ERROR', 'minimum is 300');
    }, 'busy')).rejects.toThrow('minimum is 300');
  });
});

describe('readAfterUniqueViolation', () => {
  it('waits for the winning transaction to become visible', async () => {
    let calls = 0;
    const read = async () => (++calls < 3 ? null : { id: 'wd-1' });
    await expect(readAfterUniqueViolation(read, 3)).resolves.toEqual({ id: 'wd-1' });
    expect(calls).toBe(3);
  });

  it('gives up and returns null rather than looping forever', async () => {
    await expect(readAfterUniqueViolation(async () => null, 2)).resolves.toBeNull();
  });
});

describe('confirmAbsent', () => {
  it('returns the row on the first read without a second query', async () => {
    let calls = 0;
    const out = await confirmAbsent(async () => { calls += 1; return { id: 't1' }; });
    expect(out).toEqual({ id: 't1' });
    expect(calls).toBe(1);
  });

  it('re-reads once before letting a blank result become a refusal', async () => {
    let calls = 0;
    const out = await confirmAbsent(async () => {
      calls += 1;
      // first read comes back empty (torn connection), second one does not
      return calls === 1 ? null : { id: 't1' };
    });
    expect(out).toEqual({ id: 't1' });
    expect(calls).toBe(2);
  });

  it('still returns null for genuinely missing rows', async () => {
    let calls = 0;
    const out = await confirmAbsent(async () => { calls += 1; return null; }, 3);
    expect(out).toBeNull();
    expect(calls).toBe(3);
  });
});

describe('isLostConnection', () => {
  it('recognises Prisma 1017/1001/1008 by code, not only by wording', () => {
    expect(isLostConnection({ code: 'P1017', message: 'Server has closed the connection.' })).toBe(true);
    expect(isLostConnection({ code: 'P1001', message: 'Unable to impact' })).toBe(true);
    expect(isLostConnection({ code: 'P1008', message: 'Timed out fetching a new connection' })).toBe(true);
  });
  it('recognises the driver phrasings that arrive without a code', () => {
    expect(isLostConnection({ message: 'Connection terminated unexpectedly' })).toBe(true);
    expect(isLostConnection({ message: 'DriverAdapterError: ConnectionClosed' })).toBe(true);
    expect(isLostConnection({ message: 'timeout exceeded when trying to connect' })).toBe(true);
  });
  it('reads the SQLSTATE out of Prisma message text, where the driver hides it', () => {
    expect(isLostConnection({ code: 'P2039', message: 'Database error. Code: `08P01`. Message: `bind message supplies 4 parameters`' })).toBe(true);
    expect(isLostConnection({ message: 'Database error. Code: `53300`. Message: `too many connections`' })).toBe(true);
    // A serialization failure is transient as well, but it is not a DEAD SOCKET:
    // it belongs to the retryable-transaction bucket, and the two stay distinct.
    expect(isLostConnection({ code: '40001', message: 'could not serialize access due to concurrent update' })).toBe(false);
    expect(isRetryableTxError({ code: '40001' })).toBe(true);
  });
  it('does not swallow a business rejection', () => {
    expect(isLostConnection({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
    expect(isLostConnection(new Error('Insufficient balance for this operation'))).toBe(false);
  });
});

describe('P2028 (pool / transaction queue)', () => {
  it('is classified as transient, because a queued burst is not a business rejection', () => {
    expect(isRetryableTxError({ code: 'P2028' })).toBe(true);
    expect(isRetryableTxError({ code: 'P2002' })).toBe(false);
    expect(isRetryableTxError({ code: 'P2025' })).toBe(false);
  });
});

describe('isTransientDriverError', () => {
  it('catches the classes a service did not anticipate', () => {
    // Prisma's unclassified driver failure: the request could not be completed,
    // and it carries no code at all. This used to reach the client as a 500.
    expect(isTransientDriverError({ name: 'PrismaClientUnknownRequestError', message: 'Database error. Code: `08P01`' })).toBe(true);
    expect(isTransientDriverError({ name: 'PrismaClientInitializationError', message: "Can't reach database server" })).toBe(true);
    expect(isTransientDriverError({ code: 'P2034' })).toBe(true);
  });

  it('leaves genuine faults alone', () => {
    // A real business rejection keeps its own status — the net must not swallow it.
    expect(isTransientDriverError(badRequest('INSUFFICIENT_BALANCE', 'insufficient balance'))).toBe(false);
    expect(isTransientDriverError({ name: 'PrismaClientKnownRequestError', code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
    expect(isTransientDriverError({ name: 'PrismaClientRustPanicError', message: 'panicked at engine' })).toBe(false);
    expect(isTransientDriverError(new Error('boom'))).toBe(false);
  });
});

describe('an engine response that cannot be mapped (P2023)', () => {
  const torn = () => ({
    name: 'PrismaClientKnownRequestError',
    code: 'P2023',
    message: "Invalid `prisma.user.findUnique()` invocation\nMissing data field (Value): 'role'",
  });

  it('is busy, not broken — it reaches the client as a retryable answer', () => {
    expect(isUnmappableResponse(torn())).toBe(true);
    expect(isTransientDriverError(torn())).toBe(true);
  });

  it('is never replayed around a money write', async () => {
    // The response is garbage, which says nothing about whether the INSERT behind it
    // landed. Replaying could double-charge; refusing and letting the client check its
    // history is the only safe move.
    let calls = 0;
    const err = torn();
    // The original error propagates untouched (no CONFLICT substitution, no second
    // attempt) so `fail()` can classify it as a retryable 503 with the
    // "check your history" wording — which is the honest answer after a maybe.
    await expect(withIdempotentRetry(async () => { calls++; throw err; }, { busyMessage: 'busy' }))
      .rejects.toBe(err);
    expect(calls).toBe(1);
  });
});
