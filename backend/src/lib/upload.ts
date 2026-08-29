// =============================================================================
// Uploads — Phase 14 hardened.
//
// Three layers, in order:
//   1. multer        → size cap, single file, declared-MIME allow-list
//   2. inspectImage  → the BYTES must be a real JPEG/PNG/WebP, the declared
//                      type must match the real type, and the pixel dimensions
//                      must be sane (blocks HTML/JS payloads renamed to .png,
//                      polyglots, 1×1 pixels and 200-megapixel bombs)
//   3. bookkeeping   → SHA-256 of the content (duplicate-proof detection) plus
//                      a per-user daily upload quota
//
// Anything rejected is deleted from disk before the caller ever sees it, so a
// refused file cannot linger and be served later.
// =============================================================================
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env } from './env';
import { badRequest } from './errors';
import { inspectImage } from './image';
import { prisma } from './prisma';
import { getSetting } from '../services/settings.service';

export const UPLOAD_ROOT = path.resolve(process.cwd(), env.UPLOAD_DIR);

/**
 * Directories that hold PRIVATE user data. They are never served statically —
 * only through the owner-or-staff gated routes. Everything else (banners, blog
 * covers, ad creatives) is public demo content and may be served directly.
 */
export const PRIVATE_UPLOAD_DIRS = ['deposits', 'tickets', 'results'] as const;

const DIRS = {
  deposits: path.join(UPLOAD_ROOT, 'deposits'),
  tickets: path.join(UPLOAD_ROOT, 'tickets'),
  results: path.join(UPLOAD_ROOT, 'results'),
} as const;

for (const dir of [UPLOAD_ROOT, ...Object.values(DIRS)]) {
  fs.mkdirSync(dir, { recursive: true });
}

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by the hardened upload middleware after byte-level validation. */
      uploadMeta?: { hash: string; kind: string; width: number; height: number; bytes: number };
    }
  }
}

interface UploadSpec {
  field: string;
  dir: keyof typeof DIRS;
  prefix: string;
  required: boolean;
  label: string;
}

function makeUploader(spec: UploadSpec) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DIRS[spec.dir]),
    filename: (req, file, cb) => {
      // Extension comes from the SNIFFED type (set below), never from the
      // client-supplied filename — that is how a `.php`/`.html` sneaks in.
      const ext = ALLOWED.get(file.mimetype) ?? '.img';
      const who = (req.auth?.id ?? 'anon').slice(-8);
      cb(null, `${spec.prefix}-${who}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
      files: 1,
      fields: 20,
      fieldSize: 32 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED.has(file.mimetype)) {
        return cb(badRequest('VALIDATION_ERROR', `${spec.label} must be a JPG, PNG or WebP image.`));
      }
      return cb(null, true);
    },
  });
}

function multerError(err: unknown, label: string): unknown {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? `${label} must be under ${env.MAX_UPLOAD_MB}MB.`
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Only one ${label.toLowerCase()} can be attached.`
          : `Upload failed — please try a different ${label.toLowerCase()}.`;
    return badRequest('VALIDATION_ERROR', msg);
  }
  return err;
}

/** Uploads attributed to this user in the last 24h (index-backed counts). */
async function dailyUploadCount(userId: string, dir: keyof typeof DIRS): Promise<number> {
  const since = new Date(Date.now() - 86_400_000);
  if (dir === 'deposits') {
    return prisma.deposit.count({ where: { userId, createdAt: { gte: since } } });
  }
  if (dir === 'results') {
    return prisma.resultSubmission.count({ where: { submittedById: userId, createdAt: { gte: since } } });
  }
  return prisma.supportMessage.count({
    where: { senderId: userId, attachment: { not: null }, createdAt: { gte: since } },
  });
}

/**
 * Validate the file multer just wrote: real image bytes, honest MIME, sane
 * dimensions, quota. Deletes the file on any rejection.
 */
async function validateOnDisk(req: Request, spec: UploadSpec): Promise<void> {
  const file = req.file!;
  const abs = path.join(DIRS[spec.dir], file.filename);
  const discard = async (err: unknown): Promise<never> => {
    await fs.promises.unlink(abs).catch(() => undefined);
    delete req.file;
    throw err;
  };

  const buf = await fs.promises.readFile(abs).catch(() => null);
  if (!buf) return discard(badRequest('VALIDATION_ERROR', `${spec.label} could not be read — please upload it again.`));

  const maxDimension = Number(await getSetting('security.maxUploadDimension', 4096));
  const minDimension = Number(await getSetting('security.minUploadDimension', 32));
  const quota = Number(await getSetting('security.maxUploadsPerUserPerDay', 50));

  const verdict = inspectImage(buf, {
    maxBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
    maxDimension,
    minDimension,
    declaredMime: file.mimetype,
  });
  if (!verdict.ok) return discard(badRequest('VALIDATION_ERROR', verdict.issue.message));

  // Rename to the true extension so what is on disk matches what it is.
  const trueExt = ALLOWED.get(verdict.info.kind) ?? '.img';
  if (!file.filename.endsWith(trueExt)) {
    const fixed = `${file.filename.replace(/\.[a-z0-9]+$/i, '')}${trueExt}`;
    await fs.promises.rename(abs, path.join(DIRS[spec.dir], fixed)).catch(() => undefined);
    file.filename = fixed;
  }
  file.mimetype = verdict.info.kind;
  file.size = buf.length;

  if (quota > 0) {
    const used = await dailyUploadCount(req.auth?.id ?? 'anon', spec.dir);
    if (used >= quota) {
      return discard(
        badRequest('VALIDATION_ERROR', `Daily upload limit reached (${quota}). Please try again tomorrow or contact support.`),
      );
    }
  }

  req.uploadMeta = {
    hash: crypto.createHash('sha256').update(buf).digest('hex'),
    kind: verdict.info.kind,
    width: verdict.info.width,
    height: verdict.info.height,
    bytes: buf.length,
  };
}

/** Build the middleware chain for one upload slot. */
function uploadSlot(spec: UploadSpec) {
  const uploader = makeUploader(spec);
  return (req: Request, _res: Response, next: NextFunction) => {
    uploader.single(spec.field)(req, _res, async (err: unknown) => {
      if (err) return next(multerError(err, spec.label));
      if (!req.file) {
        if (spec.required) {
          return next(badRequest('VALIDATION_ERROR', `${spec.label} is required.`));
        }
        return next();
      }
      try {
        await validateOnDisk(req, spec);
        return next();
      } catch (e) {
        return next(e);
      }
    });
  };
}

// --- Payment proofs ---------------------------------------------------------
const depositUpload = uploadSlot({
  field: 'screenshot',
  dir: 'deposits',
  prefix: 'dep',
  required: true,
  label: 'Payment screenshot',
});

/** Required payment proof (manual deposits). */
export const requireScreenshot = depositUpload;

/** Optional match-result proof. */
export const optionalScreenshot = uploadSlot({
  field: 'screenshot',
  dir: 'results',
  prefix: 'res',
  required: false,
  label: 'Result screenshot',
});

/** Optional support-ticket attachment. */
export const optionalTicketAttachment = uploadSlot({
  field: 'attachment',
  dir: 'tickets',
  prefix: 'tkt',
  required: false,
  label: 'Attachment',
});

/** Legacy aliases kept for the Phase 7/11 call sites. */
export const DEPOSIT_DIR = DIRS.deposits;
export const TICKET_DIR = DIRS.tickets;
export const RESULT_DIR = DIRS.results;

/**
 * Resolve a stored "/uploads/<rel>" reference to an absolute path INSIDE the
 * upload root. Rejects traversal (`../`), absolute paths and null bytes.
 */
export function resolveUploadPath(rel: string): string {
  const clean = String(rel ?? '')
    .replace(/\0/g, '')
    .replace(/^\/uploads\//, '')
    .replace(/^\/+/, '');
  const abs = path.resolve(UPLOAD_ROOT, clean);
  const rootWithSep = UPLOAD_ROOT.endsWith(path.sep) ? UPLOAD_ROOT : UPLOAD_ROOT + path.sep;
  if (abs !== UPLOAD_ROOT && !abs.startsWith(rootWithSep)) {
    throw badRequest('VALIDATION_ERROR', 'Invalid file path.');
  }
  return abs;
}
