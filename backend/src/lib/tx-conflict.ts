// =============================================================================
// PHASE 18 — transient database conflicts are NOT business rejections.
//
// P2034 (write conflict), 40001 (serialization failure) and 40P01 (deadlock)
// mean one thing: this transaction lost a race and rolled back COMPLETELY —
// no ledger row was written and no balance moved. Retrying is therefore the
// correct behaviour, and it is what stops a player watching two tabs from
// seeing a raw 500 (or an internal database code) while racing themselves.
//
// P2039 is the embedded dev database's driver-level variant: the statement can
// have COMMITTED and still be reported as an error. That is why automatic retry
// is restricted to operations carrying an idempotency anchor (a unique key whose
// replay path returns the ORIGINAL result), and every other money operation
// gets a clean, actionable 409 instead of a guess.
// =============================================================================
import { ApiError, conflict } from './errors';

export const RETRYABLE_TX_CODES: ReadonlySet<string> = new Set(['P2034', 'P2039', '40001', '40P01']);

export function isRetryableTxError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return typeof code === 'string' && RETRYABLE_TX_CODES.has(code);
}

/**
 * The driver-level "the pool handed back a dead connection" family. Prisma
 * does not tag these with a SQLSTATE, but they are strictly transient: the
 * statement never reached the server, so nothing was written. Retrying is only
 * offered to operations that are idempotent by construction (a conditional
 * state claim or a unique idempotency key), never to a bare money mutation.
 */
export const isLostConnection: RetryPredicate = (e) => {
  const msg = (e as { message?: string } | null)?.message ?? '';
  return /Connection terminated unexpectedly|Can't reach database server|server closed the connection unexpectedly|Client has encountered a connection error|connection was terminated/i.test(msg);
};

const nap = (attempt: number) =>
  new Promise((r) => setTimeout(r, 15 * attempt + Math.random() * 20));

/**
 * Run a financial operation that is protected by an idempotency key
 * (`requestId`, unique registration, …): retry genuine contention a few times
 * with jitter, then report a busy conflict. A business rejection (`ApiError`)
 * is never retried — it is final by definition.
 */
/** Extra conditions beyond the transient codes (e.g. an idempotency-key
 * collision that only means "the other attempt has not committed yet"). */
export type RetryPredicate = (e: unknown) => boolean;

/** A unique-violation raised on an idempotency key. */
export const isIdempotentKeyCollision: RetryPredicate = (e) =>
  (e as { code?: string } | null)?.code === 'P2002';

export async function withIdempotentRetry<T>(
  op: () => Promise<T>,
  opts: { attempts?: number; busyMessage: string; retry?: RetryPredicate },
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const retry = opts.retry ?? ((e) => isRetryableTxError(e) || isLostConnection(e));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await op();
    } catch (e) {
      if (e instanceof ApiError || !retry(e)) throw e;
      lastError = e;
      if (attempt < attempts) await nap(attempt);
    }
  }
  void lastError; // kept for debuggability of the swallowed final conflict
  throw conflict('CONFLICT', opts.busyMessage);
}

/**
 * Run a financial operation WITHOUT an idempotency anchor. Retrying is unsafe
 * (a commit whose response was lost would be duplicated), so the conflict is
 * surfaced as a 409 with a message the player can act on — never a 500.
 */
export async function withoutBlindRetry<T>(
  op: () => Promise<T>,
  busyMessage: string,
): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (isRetryableTxError(e)) throw conflict('CONFLICT', busyMessage);
    throw e;
  }
}

/**
 * A unique-violation on an idempotency key does not automatically mean "the
 * caller double-submitted": the winning transaction may simply not be visible
 * yet. Re-read it a few times before concluding anything. If the row still
 * cannot be seen the request was NOT duplicated (the insert failed), so the
 * caller gets a clean 409 to check their history instead of a raw P2002 500.
 */
export async function readAfterUniqueViolation<T>(
  read: () => Promise<T | null>,
  tries = 3,
): Promise<T | null> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const row = await read();
    if (row) return row;
    if (attempt < tries) await new Promise((r) => setTimeout(r, 40 * attempt));
  }
  return null;
}
