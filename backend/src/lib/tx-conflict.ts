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

/**
 * Codes that mean "the database could not do this right now, and nothing was
 * written". `P2028` is Prisma's own queue error (`Unable to start a transaction
 * in the given time`, or an interactive transaction that timed out and was
 * rolled back) — a burst that saturates the connection pool produces it, and a
 * caller must never see a 500 for it. Retrying is safe here precisely because
 * every site that uses this set is anchored: a conditional `WHERE status = …`
 * claim or a unique idempotency key, so a re-run either repeats a decision that
 * already happened or loses the claim cleanly.
 */
export const RETRYABLE_TX_CODES: ReadonlySet<string> = new Set(['P2034', 'P2039', 'P2028', '40001', '40P01']);

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
/**
 * Prisma's own codes for "the socket died / the server is not reachable". They
 * carry no SQLSTATE and used to surface as a 500: `P1017` (the server closed the
 * connection mid-request — the one a saturated pool throws hardest), `P1001`
 * (cannot reach the server), `P1008` (timed out getting a connection).
 */
const LOST_CONNECTION_CODES = new Set(['P1017', 'P1001', 'P1008']);

/**
 * SQLSTATE classes that are, by definition, "the connection or the server could
 * not take the work right now": `08xxx` connection exceptions (including `08P01`
 * protocol violation — the driver mis-framing a statement, which the embedded
 * dev engine does under a 100-way burst), `57P01/2/3` admin crash/shutdown,
 * `53300` too many connections, `53400` configuration-limit, `55P03` lock not
 * available. None of them can have half-applied: Postgres drops an aborted
 * connection by rolling its transaction back.
 */
const TRANSIENT_SQLSTATES = new Set(['08P01', '08000', '08001', '08003', '08004', '08006', '08007', '57P01', '57P02', '57P03', '53300', '53400', '55P03']);

export const isLostConnection: RetryPredicate = (e) => {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code && LOST_CONNECTION_CODES.has(err.code)) return true;
  const msg = err?.message ?? '';
  // Prisma buries the driver's SQLSTATE in the message text (`Code: \`08P01\``),
  // so read it there too — otherwise a protocol-level hiccup becomes a 500.
  const sqlstate = /Code: `?(\w{5})`?/.exec(msg)?.[1];
  if (sqlstate && TRANSIENT_SQLSTATES.has(sqlstate)) return true;
  return /Connection terminated unexpectedly|Server has closed the connection|ConnectionClosed|Can't reach database server|server closed the connection unexpectedly|Client has encountered a connection error|connection was terminated|connection closing|timeout exceeded when trying to connect/i.test(msg);
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
/** A predicate deciding whether an error is worth retrying. */
export type RetryPredicate = (e: unknown) => boolean;

/**
 * The whole transient family, for the places that must never answer 500 for a
 * database that simply could not take the work: the retryable transaction codes,
 * the connection/protocol classes, and Prisma's own *unclassified* driver errors
 * (`PrismaClientUnknownRequestError` = the request could not be completed and
 * carries no code; `PrismaClientInitializationError` = no client at all). Those
 * two are never a business rule, and leaving them as INTERNAL_ERROR is how a
 * saturated pool teaches monitoring that the API is broken.
 *
 * A Rust panic / data-integrity code (P2002/P2003/P2011/P2025) is deliberately
 * NOT here — those are real faults and must still surface as 500/4xx.
 */
/**
 * The engine could not map the row it got back (`P2023` — "Missing data field",
 * "Inconsistent column data"). Seen under a 100-way burst: the payload that came
 * off the wire belonged to a different query, so even a plain `findUnique` on the
 * session row fails. Infrastructure, never a business rule; the client's correct
 * move is the same as for contention — retry shortly, and if it moved money, check
 * the transaction history first.
 *
 * Deliberately NOT retryable by `withIdempotentRetry`: an unmappable *response*
 * says nothing about whether the write behind it committed, so replaying a money
 * write on it could double-apply. Response-level only.
 */
export const isUnmappableResponse: RetryPredicate = (e) => {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === 'P2023') return true;
  return /Missing data field|Inconsistent column data|Malformed result set/i.test(err?.message ?? '');
};

export function isTransientDriverError(e: unknown): boolean {
  if (isRetryableTxError(e) || isLostConnection(e) || isUnmappableResponse(e)) return true;
  const name = (e as { name?: string } | null)?.name ?? '';
  return name === 'PrismaClientUnknownRequestError' || name === 'PrismaClientInitializationError';
}

/** A unique-violation raised on an idempotency key. */
export const isIdempotentKeyCollision: RetryPredicate = (e) =>
  (e as { code?: string } | null)?.code === 'P2002';

export async function withIdempotentRetry<T>(
  op: () => Promise<T>,
  opts: { attempts?: number; busyMessage: string; retry?: RetryPredicate },
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  // Only the errors whose replay is provably safe: contention conflicts (the
  // transaction aborted, so nothing applied) and dead connections (Postgres rolls
  // the transaction back when it drops the socket). `isUnmappableResponse` and
  // Prisma's unclassified driver errors are deliberately absent — they can hide a
  // COMMITTED write, and a money operation must never be replayed on a maybe.
  // `fail()` turns those into 503s instead; a call site may widen or narrow this.
  const retry = opts.retry ?? ((e: unknown) => isRetryableTxError(e) || isLostConnection(e));
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
    // Transient ⇒ a clean 409 the client can act on, NOT a 500 and NOT a retry:
    // without an idempotency anchor we cannot know whether the commit landed.
    if (isTransientDriverError(e)) throw conflict('CONFLICT', busyMessage);
    throw e;
  }
}

/**
 * PHASE 18 — confirm a read that came back empty before acting on it.
 *
 * `null` means "there is no such row", and for a refusal that is the end of the
 * story: the client is told *Tournament not found* / *Account not found*. It is
 * also what a torn pooled connection can look like, so a burst of 100 joins
 * produced exactly that false negative once. One re-read costs nothing on the
 * happy path (this branch only runs when something was missing) and removes a
 * whole class of "the event I was looking at does not exist" tickets.
 *
 * Only ever for reads that gate a refusal — never to confirm a balance, where a
 * second read could lull the caller into spending money that is not there.
 */
export async function confirmAbsent<T>(read: () => Promise<T | null>, tries = 2): Promise<T | null> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    let row: T | null;
    try {
      row = await read();
    } catch (e) {
      // Same reasoning as the blank read: this is a pure read, so repeating it is
      // free — and a response the engine could not map is not an answer about the
      // data. Try once more; if it breaks again the error propagates and `fail()`
      // answers 503, which is retryable.
      if (!isTransientDriverError(e) || attempt === tries) throw e;
      await nap(1);
      continue;
    }
    if (row !== null && row !== undefined) return row;
    if (attempt < tries) await nap(1);
  }
  return null;
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
