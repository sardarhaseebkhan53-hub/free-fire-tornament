# Browser E2E (Playwright) — status, how to run it, and what it does NOT prove

## Status: collected, type-checked, and **not executed in this sandbox**

```
$ npx playwright test --list
Total:  13 tests in 3 files
```

That is the honest limit of what can be claimed here: the config resolves, the specs compile
(`npx tsc --noEmit` clean), lint is clean over `src e2e`, and Playwright discovers all 13
tests. **No spec has been run against a browser**, because the Chromium/Firefox binaries
`playwright install` downloads are not obtainable from this environment. Do not treat this
directory as executed evidence — treat it as the suite that will run in CI/staging.

Where the money and lifecycle invariants actually live, coverage is executed elsewhere:

| Concern | Proven by |
| --- | --- |
| Entry fee, slots, refunds, ledger, double-charge | `backend/tests/integration/phase18-*.test.ts`, `phase19-*.test.ts` (real SQL state, not HTTP echoes) |
| 100-way surge on a real PostgreSQL | `npm run verify:concurrency`, `tests/integration/phase18-scale.test.ts` |
| The whole journey over HTTP (login → … → withdrawal) | `backend/scripts/verify-journey.mjs` (`npm run verify:journey`) |
| UI wiring of check-in / credentials / bell / push opt-in | **this directory — pending a browser run** |

## Running it

Prerequisites: the API (with the Phase 19 migrations applied and a seeded admin), a built or
dev frontend, and Playwright's browsers.

```bash
npx playwright install chromium          # on a machine that can download them
cd backend  && PORT=4000 npm run dev     # the API
cd frontend && npm run dev               # :3000
cd frontend && E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npx playwright test
```

Environment (all read in `playwright.config.ts` / `e2e/global-setup.ts`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `E2E_BASE_URL` | `http://localhost:3000` | the web app under test |
| `E2E_API_URL` | `http://localhost:4000/api` | the API; used by setup and by `request` fixtures |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | — required | an existing staff account; the specs promote nothing and never reset a password |

`global-setup.ts` fails loudly if the API or the frontend is not answering — a red run here
means "the target is wrong", never "the app is fine".

## What the specs cover

- **`smoke.spec.ts`** — the home rail renders live events; `sw.js` is served with the right
  scope and MIME type; the API health endpoint the UI depends on answers.
- **`journey.spec.ts`** (serial, one scenario) — sign in with a freshly registered account →
  event page shows the join CTA and seat count → joining assigns a seat and the receipt is
  real (money moved, so the receipt is asserted against the API, not the DOM) → check-in
  refuses politely before the window opens → staff open the window, the button appears, and
  checking in sticks → the check-in lands in the inbox and re-clicking is not an error → a
  second account gets a different seat → the leaderboard renders.
- **`push.spec.ts`** — the bell shows an honest device-alerts state, and with permission
  granted but no VAPID configuration the UI says "not configured" instead of claiming
  success.

UI selectors go through `data-testid` hooks added in `src/components/join-tournament.tsx`,
`src/components/notifications-bell.tsx` and `src/app/(app)/matches/page.tsx`. They are
attribute-only additions — no styling or layout change.

## Before this suite is trusted

1. Run it in CI against a disposable Postgres (never a shared dev DB: `journey.spec.ts`
   creates real paid entries).
2. Keep the money assertions pointed at the API responses; the DOM is evidence of wiring,
   never of a ledger.
3. Add a video/screenshot artifact on failure (`playwright.config.ts` already sets
   `trace: 'retain-on-failure'`).
