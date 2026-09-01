import { describe, expect, it } from 'vitest';
import { normalizeAuthedSrc } from './authed-src';

describe('normalizeAuthedSrc', () => {
  it('rewrites an API screenshot path onto the Next proxy without doubling /api', () => {
    expect(normalizeAuthedSrc('/api/wallet/deposits/abc/screenshot'))
      .toBe('/api/backend/wallet/deposits/abc/screenshot');
    expect(normalizeAuthedSrc('/api/matches/results/xyz/screenshot'))
      .toBe('/api/backend/matches/results/xyz/screenshot');
  });

  it('leaves an already-proxied path alone', () => {
    expect(normalizeAuthedSrc('/api/backend/support/tickets/1/attachment'))
      .toBe('/api/backend/support/tickets/1/attachment');
  });

  it('collapses a leftover /api/backend/api/ prefix from the old bug', () => {
    expect(normalizeAuthedSrc('/api/backend/api/wallet/deposits/abc/screenshot'))
      .toBe('/api/backend/wallet/deposits/abc/screenshot');
  });
});
