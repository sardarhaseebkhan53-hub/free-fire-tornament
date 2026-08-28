// `npm start` guard — kills the classic
//   Error: Cannot find module '.../dist/index.js'
// before it happens: `npm start` ran before `npm run build` (fresh checkout,
// CI, or the deploy start command skipped the build). If dist/index.js is
// missing we build right here instead of crashing with a confusing error.
//
// npm runs this automatically as the `prestart` hook — zero-cost when the
// build already exists (a single fs.existsSync check).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const distIndex = fileURLToPath(new URL('../dist/index.js', import.meta.url));

if (existsSync(distIndex)) process.exit(0);

console.log('[start] dist/index.js not found — running `npm run build` first ' +
  '(generate Prisma client + compile TypeScript)…');
const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('[start] build failed — fix the errors above, then `npm start` again.');
}
process.exit(result.status ?? 1);
