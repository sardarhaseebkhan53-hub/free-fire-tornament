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

export function invalidateSetting(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
