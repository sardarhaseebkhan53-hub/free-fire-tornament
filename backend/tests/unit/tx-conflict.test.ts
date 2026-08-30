// =============================================================================
// Unit — the transient-conflict classifier shared by every money path.
//
// A database "you lost the race" error must never reach a player as a 500, and
// a business rejection must never be retried (retrying INSUFFICIENT_BALANCE
// would just hammer the wallet). These tests pin both halves of that rule.
// =============================================================================
import { describe, expect, it, vi } from 'vitest';
import { ApiError, badRequest } from '../../src/lib/errors';
import { isLostConnection, isRetryableTxError, readAfterUniqueViolation, withIdempotentRetry, withoutBlindRetry } from '../../src/lib/tx-conflict';

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
