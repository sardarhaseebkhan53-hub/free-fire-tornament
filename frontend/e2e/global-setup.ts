// Creates the world one E2E run needs, through the public API only:
//   • health probe, so a missing stack fails with an instruction instead of a timeout
//   • a brand-new player account (unique email, real password, real bcrypt cost)
//   • a published, free-entry SOLO event with 6 seats
//   • an admin token, used to open/close the check-in window at the right moment
// Nothing here mutates the database directly: if these calls work, that is itself part
// of what the suite proves.
import fs from 'node:fs';
import path from 'node:path';
import { CONTEXT_FILE, api, type RunContext } from './context';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
// The browser reaches the API through Next's /api/backend proxy; the setup runs in node
// and therefore needs the absolute URL. Same path, same middleware.
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error(
      'E2E needs an admin to open and close the check-in window. Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD ' +
        '(the account must already exist — use the seeded admin, e.g. npm run db:seed).',
    );
  }

  let health;
  try {
    health = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5_000) });
  } catch (e) {
    throw new Error(`E2E cannot reach the API at ${API_URL} (${(e as Error).message}). Start it: (cd ../backend && npm run dev).`);
  }
  if (!health.ok) throw new Error(`API health returned ${health.status} — refusing to run the journey against a sick backend.`);

  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const player = {
    email: `e2e-${stamp}@clutchnex.test`,
    username: `e2e${stamp}`.slice(0, 20),
    fullName: 'E2E Player',
    password: 'E2eTest@12345',
  };

  const bootstrap = { apiUrl: API_URL };

  await api<{ user?: { id: string } }>(bootstrap, 'POST', '/auth/register', { body: player }).catch((e: Error) => {
    throw new Error(`E2E could not register a player: ${e.message}`);
  });

  const login = await api<{ accessToken: string }>(bootstrap, 'POST', '/auth/login', {
    body: { identifier: player.username, password: player.password },
  });
  const adminLogin = await api<{ accessToken: string }>(bootstrap, 'POST', '/auth/login', {
    body: { identifier: adminEmail, password: adminPassword },
  });

  const title = `E2E Check-In Cup ${stamp}`;
  const event = await api<{ id: string; slug: string; title: string }>(
    bootstrap,
    'POST',
    '/admin/tournaments',
    {
      token: adminLogin.accessToken,
      body: {
        title,
        type: 'SOLO',
        description: 'Created by the browser E2E suite. Safe to delete.',
        map: 'Bermuda',
        startTime: new Date(Date.now() + 6 * 3_600_000).toISOString(),
        // Registration stays open for the whole run so the join step is always legal;
        // the check-in window is opened explicitly later, which is also what staff do.
        registrationDeadline: new Date(Date.now() + 30 * 60_000).toISOString(),
        maxSlots: 6,
        minSlotsToStart: 2,
        entryFeePerPlayer: 0,
        publish: true,
        prizes: [{ kind: 'PLACEMENT', amount: 100, label: '1st' }],
      },
    },
  );

  const ctx: RunContext = {
    baseURL: BASE_URL,
    apiUrl: API_URL,
    player,
    playerToken: login.accessToken,
    event: { id: event.id, slug: event.slug, title: event.title ?? title },
    adminToken: adminLogin.accessToken,
  };
  fs.mkdirSync(path.dirname(CONTEXT_FILE), { recursive: true });
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(ctx, null, 2));

  return async () => {
    // Cancel the event so a stale E2E tournament never shows up in a public list again.
    // (There is no delete endpoint on purpose: financial history is never erased.)
    await api(ctx, 'POST', `/admin/tournaments/${ctx.event.id}/status`, {
      token: ctx.adminToken,
      body: { status: 'CANCELLED' },
    }).catch(() => undefined);
    fs.rmSync(CONTEXT_FILE, { force: true });
  };
}
