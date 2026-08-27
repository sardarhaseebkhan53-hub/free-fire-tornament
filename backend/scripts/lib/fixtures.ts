// Shared test fixture — a REAL PNG encoder.
//
// Phase 14 validates uploads by their bytes (magic signature, declared-type
// match and pixel dimensions), so the old 1×1 base64 blob is no longer a valid
// "screenshot". These helpers build genuine PNG/JPEG/WebP buffers of any size
// with no external dependency, so every suite tests the production rules.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** A valid RGBA PNG. `png(64)` is square; `png(320, 240)` is not. */
export function png(
  size = 64,
  heightOrRgba: number | [number, number, number, number] = size,
  rgba: [number, number, number, number] = [124, 58, 237, 255],
): Buffer {
  const height = typeof heightOrRgba === 'number' ? heightOrRgba : size;
  const colour = typeof heightOrRgba === 'number' ? rgba : heightOrRgba;
  const width = size;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const row = Buffer.alloc(1 + width * 4);
  row[0] = 0; // filter: none
  for (let x = 0; x < width; x++) {
    row[1 + x * 4] = colour[0];
    row[2 + x * 4] = colour[1];
    row[3 + x * 4] = colour[2];
    row[4 + x * 4] = colour[3];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** PNG bytes whose IHDR claims `width × height` but carries no pixel data —
 * enough for dimension-policy tests without megabytes of payload. */
export function pngHeaderOnly(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ]);
}

/** Minimal baseline JPEG (SOI + APP0 + SOF0 + EOI) of the given dimensions. */
export function jpeg(width = 64, height = 64): Buffer {
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Lossy WebP container (RIFF/WEBP/VP8 ) with the given dimensions. */
export function webp(width = 64, height = 64): Buffer {
  const frame = Buffer.alloc(10);
  frame.writeUInt16LE(0x9d01, 0); // frame tag + start code
  frame[2] = 0x2a;
  frame.writeUInt16LE(width & 0x3fff, 6);
  frame.writeUInt16LE(height & 0x3fff, 8);
  const vp8 = Buffer.concat([Buffer.from('VP8 ', 'latin1'), Buffer.alloc(4), frame]);
  const riff = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'latin1'),
    vp8,
  ]);
  riff.writeUInt32LE(riff.length - 8, 4);
  vp8.writeUInt32LE(frame.length, 4);
  return riff;
}

/** Bytes that are definitely NOT an image (an HTML page, the classic polyglot). */
export function notAnImage(): Buffer {
  return Buffer.from(
    '<!doctype html><html><body><script>alert("clutchnex")</script></body></html>',
    'utf8',
  );
}

/** A GIF — a real image format the platform deliberately refuses. */
export function gif(): Buffer {
  return Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\x21\xf9\x04\x00\x00\x00\x00\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x44\x01\x00\x3b', 'latin1');
}
