// Dynamic admin settings (Setting table) with a small in-memory cache.
// No source-code edits needed for normal configuration changes.
import { prisma } from '../lib/prisma';

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 30_000;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const row = await prisma.setting.findUnique({ where: { key } });
  const value = (row?.value ?? fallback) as T;
  cache.set(key, { value, at: Date.now() });
  return value;
}

/**
 * Boolean settings are stored as JSON. Admin edits, seed rows and older
 * migrations have produced `true`, `"true"` and `1` for the same flag — a
 * strict `=== true` then silently disabled independent Duo/Squad entry.
 */
export function settingEnabled(value: unknown, fallback = true): boolean {
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  return fallback;
}

export async function getFlag(key: string, fallback = true): Promise<boolean> {
  return settingEnabled(await getSetting<unknown>(key, fallback), fallback);
}

export function invalidateSetting(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
