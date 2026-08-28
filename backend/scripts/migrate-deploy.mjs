// Resilient `prisma migrate deploy`.
//
// Tries the real CLI first (the production path — validates migration
// checksums and works everywhere binaries.prisma.sh is reachable, e.g.
// Railway/Render/CI). If the engine download is blocked (restricted
// networks, some sandboxes), falls back to the offline SQL applier, which
// applies the same migration files over the pg wire protocol and records
// them in _prisma_migrations exactly as the CLI would.
//
// Safe to run on every boot: both paths are idempotent and forward-only.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const cli = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  cwd: root,
});
if (cli.status === 0) process.exit(0);

console.log(
  '\n[migrate-deploy] CLI unavailable (schema-engine download blocked?) — ' +
    'falling back to the offline SQL applier…',
);

const fallback = spawnSync(process.execPath, ['scripts/apply-migrations-offline.mjs'], {
  stdio: 'inherit',
  cwd: root,
});
process.exit(fallback.status ?? 1);
