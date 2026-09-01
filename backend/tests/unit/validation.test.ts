// =============================================================================
// Unit — validation schemas that guard stored, later-rendered values.
//
// Zod's .url() only proves a string parses. `javascript:alert(1)` parses, so a
// plain .url() field is an XSS payload with a waiting render site. These tests
// pin the safe-URL policy used by admin-storeable links.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { createAdSchema, safeUrl, tournamentListQuerySchema, userListQuerySchema } from '../../src/validation/admin.schema';

describe('safeUrl', () => {
  it('accepts http and https links', () => {
    expect(safeUrl().safeParse('https://example.com').success).toBe(true);
    expect(safeUrl().safeParse('http://example.com/a?b=1#c').success).toBe(true);
  });

  it('accepts an empty value (the field is optional)', () => {
    expect(safeUrl().safeParse('').success).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(document.domain)',
    'JAVASCRIPT:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('rejects the executable scheme %s', (value) => {
    expect(safeUrl().safeParse(value).success).toBe(false);
  });

  it('rejects a scheme hidden behind leading whitespace or control characters', () => {
    expect(safeUrl().safeParse('  javascript:alert(1)').success).toBe(false);
    expect(safeUrl().safeParse('java\tscript:alert(1)').success).toBe(false);
  });

  it('rejects something that is not a URL at all', () => {
    expect(safeUrl().safeParse('not a url').success).toBe(false);
  });

  it('enforces the length cap', () => {
    expect(safeUrl(20).safeParse('https://example.com/this-is-far-too-long').success).toBe(false);
  });
});

describe('createAdSchema', () => {
  const base = { placement: 'HEADER' as const, name: 'Launch banner' };

  it('accepts an ad with an https target', () => {
    const r = createAdSchema.safeParse({ ...base, targetUrl: 'https://shop.example.com' });
    expect(r.success).toBe(true);
  });

  it('accepts an ad with no target at all', () => {
    expect(createAdSchema.safeParse(base).success).toBe(true);
    expect(createAdSchema.safeParse({ ...base, targetUrl: '' }).success).toBe(true);
  });

  it('refuses a javascript: target URL', () => {
    const r = createAdSchema.safeParse({ ...base, targetUrl: 'javascript:alert(1)' });
    expect(r.success).toBe(false);
  });

  it('refuses an unknown placement and an empty name', () => {
    expect(createAdSchema.safeParse({ placement: 'SIDEWALK', name: 'x' }).success).toBe(false);
    expect(createAdSchema.safeParse({ placement: 'HEADER', name: '' }).success).toBe(false);
  });
});

describe('tournamentListQuerySchema', () => {
  it('parses an empty query and a pageSize-only query (winners/slots/results)', () => {
    expect(tournamentListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(tournamentListQuerySchema.parse({ pageSize: '50' })).toEqual({ page: 1, pageSize: 50 });
  });

  it('accepts a tournament status and drops leftover user/deposit statuses', () => {
    expect(tournamentListQuerySchema.parse({ status: 'REGISTRATION_OPEN' }).status).toBe('REGISTRATION_OPEN');
    expect(tournamentListQuerySchema.parse({ status: 'PENDING' }).status).toBeUndefined();
    expect(tournamentListQuerySchema.parse({ status: 'ACTIVE' }).status).toBeUndefined();
  });

  it('documents why the user-list schema must not gate this endpoint', () => {
    expect(userListQuerySchema.safeParse({ status: 'REGISTRATION_OPEN' }).success).toBe(false);
    expect(userListQuerySchema.safeParse({ status: 'PENDING' }).success).toBe(false);
  });
});
