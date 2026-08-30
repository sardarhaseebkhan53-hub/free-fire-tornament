// =============================================================================
// Playwright — browser E2E for the player journey (PHASE 19 item 4).
//
// WHAT THIS IS: a real suite, against a real Next build and a real API, driving the
// same DOM the players use. It is NOT run by `npm test` and it is NOT green by
// default: it needs a stack (API + PostgreSQL + a published event) and the browser
// binary, so it runs where those exist — CI or a developer machine.
//
//   1. backend up:            (cd ../backend && npm run dev)              → :4000
//   2. this app built + run:  npm run build && npm run start              → :3000
//      (the app proxies /api/backend/* → the API, so the browser only ever talks
//       to this origin; that is what makes the suite CSRF-representative)
//   3. one-time:              npx playwright install chromium
//   4. run:                   E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npm run test:e2e
//
// The run context (a freshly registered player + a freshly published free-entry
// event) is created by e2e/global-setup.ts through the API, so repeated runs never
// collide with each other and nothing has to be seeded by hand.
//
// Money-bearing legs (deposit approval, prize credit, withdrawal) are intentionally
// NOT in the browser suite: they depend on operator actions and external payment
// providers. Those invariants are pinned by the backend suites and by
// `npm run verify:journey` in ../backend, which asserts database state — a strictly
// stronger check than clicking through a UI.
// =============================================================================
import { defineConfig, devices } from '@playwright/test';

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Serial on purpose: the suite shares one created event, and a parallel fan-out over
  // a single seat-limited event produces failures that look like product bugs.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: base,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
