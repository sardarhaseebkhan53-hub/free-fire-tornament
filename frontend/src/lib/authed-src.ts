/**
 * Map an API image path onto the browser-safe `/api/backend/*` proxy.
 *
 * Backend services return `/api/wallet/deposits/:id/screenshot` (and the same
 * shape for match results / tickets). Prefixing that with `/api/backend`
 * produced `/api/backend/api/wallet/...`, which the Next proxy forwarded to
 * `/api/api/wallet/...` — a 404, so admin Proof viewers showed a blank image.
 *
 * Already-proxied paths (`/api/backend/...`) are left alone. A leftover
 * double-`/api` from an older client is collapsed once.
 */
export function normalizeAuthedSrc(src: string): string {
  if (!src) return src;
  let path = src;
  // Collapse a previously-bugged `/api/backend/api/...` prefix.
  if (path.startsWith('/api/backend/api/')) path = `/api/backend/${path.slice('/api/backend/api/'.length)}`;
  if (path.startsWith('/api/backend/')) return path;
  if (path.startsWith('/api/')) return `/api/backend${path.slice(4)}`;
  return path;
}
