// Typed API errors — every business failure carries a stable machine-readable
// code that the frontend (and future Flutter app) maps to human text.
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'ECONOMIC_UNSAFE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EMAIL_TAKEN'
  | 'USERNAME_TAKEN'
  | 'PHONE_TAKEN'
  | 'FF_UID_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_BANNED'
  | 'EMAIL_NOT_VERIFIED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'REFERRAL_CODE_INVALID'
  | 'INSUFFICIENT_BALANCE'
  | 'TOURNAMENT_FULL'
  | 'TOURNAMENT_CLOSED'
  | 'ALREADY_REGISTERED'
  | 'DUPLICATE_TRANSACTION'
  | 'TICKET_CLOSED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (code: ApiErrorCode, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);
export const unauthorized = (code: ApiErrorCode, message: string) =>
  new ApiError(401, code, message);
export const forbidden = (message: string) => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Resource not found') =>
  new ApiError(404, 'NOT_FOUND', message);
export const conflict = (code: ApiErrorCode, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);
