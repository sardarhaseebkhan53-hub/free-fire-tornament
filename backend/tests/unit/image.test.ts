// =============================================================================
// Unit — image validation (Phase 14). No database: this is pure byte logic, so
// it runs in milliseconds and proves the parser against hand-built containers.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { imageDimensions, inspectImage, sniffImage } from '../../src/lib/image';
import { gif, jpeg, notAnImage, png, pngHeaderOnly, webp } from '../../scripts/lib/fixtures';

const POLICY = { maxBytes: 5 * 1024 * 1024, maxDimension: 4096, minDimension: 32 };

describe('sniffImage — magic bytes, not client claims', () => {
  it('recognises a real PNG', () => {
    expect(sniffImage(png(64))).toBe('image/png');
  });

  it('recognises a real JPEG', () => {
    expect(sniffImage(jpeg(120, 90))).toBe('image/jpeg');
  });

  it('recognises a real WebP', () => {
    expect(sniffImage(webp(64, 48))).toBe('image/webp');
  });

  it('refuses an HTML page renamed to .png', () => {
    expect(sniffImage(notAnImage())).toBeNull();
  });

  it('refuses anything shorter than a header', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe('imageDimensions — read straight out of the container', () => {
  it('reads PNG width/height from IHDR', () => {
    expect(imageDimensions(png(320, 240), 'image/png')).toEqual({ width: 320, height: 240 });
  });

  it('reads JPEG width/height from the SOF segment', () => {
    expect(imageDimensions(jpeg(120, 90), 'image/jpeg')).toEqual({ width: 120, height: 90 });
  });

  it('reads WebP width/height from the VP8 frame', () => {
    expect(imageDimensions(webp(640, 360), 'image/webp')).toEqual({ width: 640, height: 360 });
  });
});

describe('inspectImage — the upload policy', () => {
  it('accepts a genuine screenshot', () => {
    const r = inspectImage(png(800, 600), { ...POLICY, declaredMime: 'image/png' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.info).toEqual({ kind: 'image/png', width: 800, height: 600 });
  });

  it('rejects a non-image payload', () => {
    const r = inspectImage(notAnImage(), { ...POLICY, declaredMime: 'image/png' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe('NOT_AN_IMAGE');
  });

  it('rejects a deliberately blocked raster format', () => {
    const r = inspectImage(gif(), { ...POLICY, declaredMime: 'image/gif' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe('BLOCKED_FORMAT');
  });

  it('rejects a PNG that claims to be a JPEG', () => {
    const r = inspectImage(png(64), { ...POLICY, declaredMime: 'image/jpeg' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe('MIME_MISMATCH');
  });

  it('rejects a 1×1 "screenshot"', () => {
    const r = inspectImage(pngHeaderOnly(1, 1), { ...POLICY, declaredMime: 'image/png' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe('DIMENSIONS_OUT_OF_RANGE');
  });

  it('rejects an oversized image', () => {
    const r = inspectImage(pngHeaderOnly(9000, 9000), { ...POLICY, declaredMime: 'image/png' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe('DIMENSIONS_OUT_OF_RANGE');
  });

  it('rejects a payload over the byte cap', () => {
    const r = inspectImage(png(400), { ...POLICY, maxBytes: 64, declaredMime: 'image/png' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe('TOO_LARGE');
  });

  it('rejects an empty file', () => {
    const r = inspectImage(Buffer.alloc(0), POLICY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe('NOT_AN_IMAGE');
  });

  it('rejects a truncated header whose dimensions cannot be read', () => {
    const broken = png(64).subarray(0, 20);
    const r = inspectImage(broken, { ...POLICY, declaredMime: 'image/png' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['DIMENSIONS_UNKNOWN', 'NOT_AN_IMAGE']).toContain(r.issue.code);
  });
});
