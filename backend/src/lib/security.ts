// =============================================================================
// Phase 14 — request context + audit helpers.
//
// Two jobs:
//   1. Give every route one honest way to answer "who/where did this come
//      from?" — `reqContext(req)` resolves the real client IP (proxy-aware) and
//      a bounded user-agent, so audit rows and fraud rules see the same data.
//   2. Make audit writes uniform: `audit()` / `auditIn()` never throw into the
//      request path and always record actor, entity, before/after, IP and UA.
// =============================================================================
import type { Request } from 'express';
import type { Prisma } from '../../generated/prisma';
import { prisma } from './prisma';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Client IP — PHASE 18 corrected the hop it trusts.
 *
 * `X-Forwarded-For` is a chain each proxy APPENDS to, so the FIRST entry is the
 * value the caller chose. Reading it unconditionally let anyone send
 * `X-Forwarded-For: 1.2.3.4` and become a different origin for every
 * IP-keyed control: login lockout, deposit burst, registration bursts, coupon
 * abuse, the audit trail and the financial rate limiters.
 *
 * Our own hop (the Next.js `/api/backend` proxy) appends the address the edge
 * reported (`x-real-ip`), so the LAST entry is the one a trusted party wrote.
 * `app.set('trust proxy', 1)` computes exactly that for `req.ip`, which is the
 * fallback for a direct (non-proxied) deployment.
 */
export function clientIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(xff) ? xff.join(',') : xff ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  const ip = chain[chain.length - 1] ?? req.ip;
  return typeof ip === 'string' ? ip.slice(0, 64) : undefined;
}

/** Bounded user-agent — audit/forensics data, never unbounded client text. */
export function userAgentOf(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 200) : undefined;
}

/** One call for everything a security-relevant handler needs to record. */
export function reqContext(req: Request): RequestContext {
  return { ip: clientIp(req), userAgent: userAgentOf(req) };
}

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Audit outside a transaction. Best-effort: a failed audit row must never
 * turn a successful financial action into a 500 (it is still logged). */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        before: toJson(input.before),
        after: toJson(input.after),
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
  } catch (e) {
    console.error('[audit] failed to write audit row', input.action, e);
  }
}

/** Same, inside an existing transaction (atomic with the action it records). */
export async function auditIn(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      before: toJson(input.before),
      after: toJson(input.after),
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });
}

/**
 * Serve a user-uploaded file as inert data.
 * `Content-Type` comes from OUR sniffing (never the stored claim), the browser
 * is told not to sniff, nothing may be framed or scripted, and the download
 * disposition means a stored polyglot can never execute in our origin.
 */
export function uploadResponseHeaders(res: import('express').Response, filename: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, max-age=300');
  // The extension on disk was set from the SNIFFED type at upload time, so it
  // is the honest source of truth for the response type.
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  res.type(mime);
}
