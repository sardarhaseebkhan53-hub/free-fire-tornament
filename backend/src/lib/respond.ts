// Consistent API envelope for every response (spec §56).
import type { Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from './errors';

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
  // Never leak internals/stack traces to clients.
  console.error('[unhandled]', err);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
  });
}
