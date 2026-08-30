// Shared run context: created once by global-setup, read by every spec.
import fs from 'node:fs';
import path from 'node:path';

export const E2E_DIR = path.join(__dirname);
export const CONTEXT_FILE = path.join(E2E_DIR, '.auth', 'run.json');

export interface RunContext {
  baseURL: string;
  apiUrl: string;
  player: { email: string; username: string; password: string; fullName: string };
  /** Minted by setup so a spec can verify server state without replaying the UI. */
  playerToken: string;
  event: { id: string; slug: string; title: string };
  adminToken: string;
}

let cached: RunContext | null = null;

/**
 * Lazily read the run context. Specs must NOT read it at module scope: Playwright loads
 * every spec file during collection, before global-setup has created the file, so an
 * eager read turns `--list` (and any dry run) into a crash that looks like a broken suite.
 */
export function run(): RunContext {
  cached ??= readContext();
  return cached;
}

export function readContext(): RunContext {
  if (!fs.existsSync(CONTEXT_FILE)) {
    throw new Error(
      `E2E run context missing (${CONTEXT_FILE}). Run the suite through \`npm run test:e2e\` so global-setup can create it.`,
    );
  }
  return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8')) as RunContext;
}

/** Direct API call — used for setup/verification, never to fake a UI step. */
export async function api<T>(
  // Setup runs before the context exists, so only the origin is required here.
  ctx: Pick<RunContext, 'apiUrl'>,
  method: string,
  route: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${ctx.apiUrl}${route}`, {
    method,
    headers: {
      ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; message?: string; code?: string };
  if (!res.ok || json.success === false) {
    throw new Error(`E2E API ${method} ${route} → ${res.status} ${json.code ?? ''} ${json.message ?? ''}`.trim());
  }
  return json.data as T;
}
