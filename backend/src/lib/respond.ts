// Consistent API envelope for every response (spec §56).
import type { Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from './errors';
import { isTransientDriverError } from './tx-conflict';

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
  // Never leak internals/stack traces to clients.
  console.error('[unhandled]', err);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
  });
}
