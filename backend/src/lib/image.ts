// =============================================================================
// Phase 14 — real image validation.
//
// A browser-supplied `Content-Type` is a claim, not a fact: `multer` trusts it,
// so an attacker can upload an HTML page (or a polyglot) named `proof.png`.
// Everything here works from the BYTES instead:
//
//   1. magic-byte sniffing  → the file really is JPEG / PNG / WebP
//   2. header parsing       → real pixel dimensions (no image decoder needed)
//   3. policy checks        → size, dimensions, and a declared-type match
//
// Zero dependencies on purpose: this runs on every upload and must never need
// a native module or a network fetch.
// =============================================================================

export type ImageKind = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageInfo {
  kind: ImageKind;
  width: number;
  height: number;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87 = Buffer.from('GIF87a');
const GIF89 = Buffer.from('GIF89a');
const BMP = Buffer.from('BM');

function startsWith(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

/** True for formats we deliberately refuse (animated/GIF uploads, bitmaps). */
function isBlockedRaster(buf: Buffer): boolean {
  return (
    buf.subarray(0, 6).equals(GIF87) ||
    buf.subarray(0, 6).equals(GIF89) ||
    buf.subarray(0, 2).equals(BMP)
  );
}

/** Detect the real image format from magic bytes. Returns null if not an image. */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length < 16) return null;

  // JPEG — SOI marker
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  // PNG — 8-byte signature + mandatory IHDR chunk
  if (startsWith(buf, PNG_SIG) && buf.readUInt32BE(12) === 0x49484452 /* IHDR */) return 'image/png';

  // WebP — RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

/** Read pixel dimensions straight out of the container header. */
export function imageDimensions(buf: Buffer, kind: ImageKind): { width: number; height: number } | null {
  if (kind === 'image/png') {
    // IHDR: width at 16..20, height at 20..24 (big-endian)
    if (buf.length < 24) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  if (kind === 'image/webp') {
    // VP8 variants: 'VP8 ' (lossy), 'VP8L' (lossless), 'VP8X' (extended)
    const fourcc = buf.subarray(12, 16).toString('latin1');
    if (fourcc === 'VP8X' && buf.length >= 30) {
      const width = 1 + ((buf[24] ?? 0) | ((buf[25] ?? 0) << 8) | ((buf[26] ?? 0) << 16));
      const height = 1 + ((buf[27] ?? 0) | ((buf[28] ?? 0) << 8) | ((buf[29] ?? 0) << 16));
      return { width, height };
    }
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      // frame tag starts at 20; width/height are 14-bit LE at 26/28
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (fourcc === 'VP8L' && buf.length >= 25) {
      const b0 = buf[21] ?? 0;
      const b1 = buf[22] ?? 0;
      const b2 = buf[23] ?? 0;
      const b3 = buf[24] ?? 0;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    return null;
  }

  // JPEG — walk the marker segments to the first SOFn frame header.
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1] ?? 0;
    // Standalone markers (RSTn, SOI, EOI, TEM) carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segLen = buf.readUInt16BE(offset + 2);
    if (segLen < 2) return null;
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + segLen;
  }
  return null;
}

export interface ImagePolicy {
  /** Bytes. */
  maxBytes: number;
  /** Longest allowed side, in pixels. */
  maxDimension: number;
  /** Smallest allowed side, in pixels — blocks 1×1 "screenshots". */
  minDimension: number;
  /** MIME type the client declared (multer's `file.mimetype`). */
  declaredMime?: string;
}

export type ImageIssue =
  | { code: 'NOT_AN_IMAGE'; message: string }
  | { code: 'BLOCKED_FORMAT'; message: string }
  | { code: 'MIME_MISMATCH'; message: string }
  | { code: 'TOO_LARGE'; message: string }
  | { code: 'DIMENSIONS_UNKNOWN'; message: string }
  | { code: 'DIMENSIONS_OUT_OF_RANGE'; message: string };

/**
 * Validate raw bytes against the policy. Returns the parsed image info on
 * success, or the first violation found (in the order a reviewer would care
 * about: is it an image at all → is it the claimed type → is it sane).
 */
export function inspectImage(
  buf: Buffer,
  policy: ImagePolicy,
): { ok: true; info: ImageInfo } | { ok: false; issue: ImageIssue } {
  if (buf.length === 0) return { ok: false, issue: { code: 'NOT_AN_IMAGE', message: 'The uploaded file is empty.' } };

  const kind = sniffImage(buf);
  if (!kind) {
    if (isBlockedRaster(buf)) {
      return { ok: false, issue: { code: 'BLOCKED_FORMAT', message: 'GIF and BMP uploads are not accepted — send a JPG, PNG or WebP screenshot.' } };
    }
    return { ok: false, issue: { code: 'NOT_AN_IMAGE', message: 'That file is not a real image (content does not match an image format).' } };
  }

  if (policy.declaredMime && policy.declaredMime !== kind) {
    return {
      ok: false,
      issue: {
        code: 'MIME_MISMATCH',
        message: `The file is really ${kind.replace('image/', '').toUpperCase()} but was sent as ${policy.declaredMime}. Re-save it and try again.`,
      },
    };
  }

  if (buf.length > policy.maxBytes) {
    return { ok: false, issue: { code: 'TOO_LARGE', message: `Image must be under ${Math.round((policy.maxBytes / 1024 / 1024) * 10) / 10}MB.` } };
  }

  const dims = imageDimensions(buf, kind);
  if (!dims || dims.width <= 0 || dims.height <= 0) {
    return { ok: false, issue: { code: 'DIMENSIONS_UNKNOWN', message: 'Could not read the image dimensions — the file may be truncated or corrupt.' } };
  }
  if (
    dims.width > policy.maxDimension ||
    dims.height > policy.maxDimension ||
    dims.width < policy.minDimension ||
    dims.height < policy.minDimension
  ) {
    return {
      ok: false,
      issue: {
        code: 'DIMENSIONS_OUT_OF_RANGE',
        message: `Screenshot must be between ${policy.minDimension}px and ${policy.maxDimension}px on each side (got ${dims.width}×${dims.height}).`,
      },
    };
  }

  return { ok: true, info: { kind, width: dims.width, height: dims.height } };
}
