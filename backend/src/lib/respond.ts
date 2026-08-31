// Consistent API envelope for every response (spec §56).
import type { Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from './errors';
import { isTransientDriverError } from './tx-conflict';

/**
 * Schema-drift detection. Prisma tags "the relation/table/column the generated
 * client was built against is not in the database" with P2021 (table) / P2022
 * (column). The driver adapter can also surface the raw Postgres message —
 * 42P01 (undefined_table) / 42703 (undefined_column) — so match the message
 * text too. Either way the cause is the same: migrations have not been applied
 * to THIS database, and no retry of the request can fix it.
 */
export function isSchemaDriftError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.code === 'P2021' || e.code === 'P2022') return true;
  const msg = (e.message ?? '').toLowerCase();
  return (
    msg.includes('does not exist in the current database') ||
    msg.includes('relation "') && msg.includes('does not exist') ||
    msg.includes('column "') && msg.includes('does not exist') ||
    msg.includes('undefined_table') ||
    msg.includes('undefined_column')
  );
}

const envIsProd = () => process.env.NODE_ENV === 'production';

export function ok<T>(res: Response, data: T, message?: string, status = 200) {
  return res.status(status).json({ success: true, message, data });
}

export function fail(res: Response, err: unknown) {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: details,
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { errors: err.details } : {}),
    });
  }
  // PHASE 18 — database contention is never an internal error.
  //
  // Every service that could legitimately be re-run already wraps itself in
  // `withIdempotentRetry`/`withoutBlindRetry`, but a call path that forgot to
  // (or a helper two layers down) used to surface a pool/lock failure as a bare
  // 500 + `INTERNAL_ERROR`, which tells monitoring the API is broken and tells
  // players nothing about their money. Translate it here as the last line of
  // defence: 503 with a Retry-After, and an honest message that says "check
  // your history before you try again" — because for a lost connection we do not
  // know whether the commit landed, and neither does the client.
  if (isTransientDriverError(err)) {
    console.warn('[busy] database contention', (err as { code?: string } | null)?.code ?? 'transport');
    return res
      .status(503)
      .set('Retry-After', '2')
      .json({
        success: false,
        code: 'SERVICE_BUSY',
        message: 'The platform is busy for a moment. If this moved money, check your transaction history before trying again.',
      });
  }
  // Schema drift: the running code expects a table/column the database does
  // not have yet (a deployment whose migrations were not applied, or a dev
  // database that predates a pull). The dev boot self-heals this
  // (syncDevDatabase); surfacing an actionable DATABASE_OUT_OF_DATE instead of
  // a bare 500 tells the operator exactly what is wrong rather than implying
  // the request itself broke.
  if (isSchemaDriftError(err)) {
    const message = (err as { message?: string })?.message ?? 'database schema is out of date';
    console.error('[schema-drift]', message.split('\n')[0]);
    return res.status(503).json({
      success: false,
      code: 'DATABASE_OUT_OF_DATE',
      message:
        envIsProd()
          ? 'The platform is being updated. Please try again in a moment.'
          : 'Database is missing migrations. Run `npm run db:migrate` (dev servers auto-apply them on restart), then reload.',
    });
  }
  // Never leak internals/stack traces to clients.
  console.error('[unhandled]', err);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
  });
}
