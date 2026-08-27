// Screenshot uploads — multer disk storage with strict MIME + size limits.
// Files land in UPLOAD_DIR/deposits and are referenced as /uploads/deposits/*.
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env } from './env';
import { badRequest } from './errors';

export const UPLOAD_ROOT = path.resolve(process.cwd(), env.UPLOAD_DIR);
export const DEPOSIT_DIR = path.join(UPLOAD_ROOT, 'deposits');

for (const dir of [UPLOAD_ROOT, DEPOSIT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DEPOSIT_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype) ?? path.extname(file.originalname).toLowerCase();
    cb(null, `dep-${(req.auth?.id ?? 'anon').slice(-8)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(badRequest('VALIDATION_ERROR', 'Screenshot must be a JPG, PNG or WebP image.'));
    }
    return cb(null, true);
  },
});

/** Wrap multer so its errors become clean API errors, then require a file. */
export function requireScreenshot(req: Request, res: Response, next: NextFunction) {
  upload.single('screenshot')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `Screenshot must be under ${env.MAX_UPLOAD_MB}MB.`
        : 'Upload failed — please try a different screenshot.';
      return next(badRequest('VALIDATION_ERROR', msg));
    }
    if (err) return next(err);
    if (!req.file) {
      return next(badRequest('VALIDATION_ERROR', 'Payment screenshot is required.'));
    }
    return next();
  });
}

/** Same as above but the file is OPTIONAL (result submissions). */
export function optionalScreenshot(req: Request, res: Response, next: NextFunction) {
  upload.single('screenshot')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `Screenshot must be under ${env.MAX_UPLOAD_MB}MB.`
        : 'Upload failed — please try a different screenshot.';
      return next(badRequest('VALIDATION_ERROR', msg));
    }
    if (err) return next(err);
    return next();
  });
}
