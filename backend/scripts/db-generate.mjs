// Prisma client generation that works in restricted networks. The Prisma 7 CLI
// compiles schemas with WASM but insists on "ensuring" (downloading) the native
// schema-engine first; scripts/offline-prisma-patch.mjs + the env var below
// skip that download. If the WASM path fails for any reason we retry plainly so
// normal networks are never worse off.
import { spawnSync } from 'node:child_process';

const run = (env) => {
  const r = spawnSync('npx', ['prisma', 'generate'], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return r.status ?? 1;
};

let code = run({ PRISMA_SKIP_NATIVE_SCHEMA_ENGINE: '1' });
if (code !== 0) {
  console.log('[db-generate] WASM/offline attempt failed — retrying with default behaviour…');
  code = run({});
}
process.exit(code);
