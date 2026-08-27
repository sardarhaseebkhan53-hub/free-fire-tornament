// Offline Prisma CLI patcher — for sandboxes where binaries.prisma.sh is
// unreachable (the native schema-engine download fails even though the CLI
// ships WASM engines that do the actual work).
//
// Idempotently patches node_modules/@prisma/engines/dist/index.js so that
// ensureNeededBinariesExist() becomes a no-op WHEN the env var
// PRISMA_SKIP_NATIVE_SCHEMA_ENGINE=1 is set. Without the env var behaviour is
// unchanged, so normal networks are unaffected.
//
//   node scripts/offline-prisma-patch.mjs
//
// Combine with scripts/db-generate.mjs (which sets the env var) to generate
// the client fully offline. Migrations apply offline through
// scripts/apply-migrations-offline.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GUARD = 'PRISMA_SKIP_NATIVE_SCHEMA_ENGINE';
const MARK = `if (process.env.${GUARD} === "1") return;`;

let path;
try {
  path = require.resolve('@prisma/engines/dist/index.js');
} catch {
  console.log('[offline-prisma-patch] @prisma/engines not installed — nothing to patch.');
  process.exit(0);
}

const src = readFileSync(path, 'utf8');
if (src.includes(MARK)) {
  console.log('[offline-prisma-patch] already patched.');
  process.exit(0);
}

const anchor = 'async function ensureNeededBinariesExist({ download }) {';
if (!src.includes(anchor)) {
  console.log('[offline-prisma-patch] anchor not found (new @prisma/engines layout?) — skipping.');
  process.exit(0);
}

writeFileSync(path, src.replace(anchor, `${anchor}\n  ${MARK}`));
console.log('[offline-prisma-patch] patched ensureNeededBinariesExist for offline use.');
