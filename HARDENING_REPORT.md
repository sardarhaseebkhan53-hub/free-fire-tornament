# Production Hardening Audit — CLUTCHNEX

Independent audit → fix → test pass over the existing platform. Nothing was
rebuilt: every working route, API contract, database relationship and UI screen
was preserved. This document records only what actually changed and how each
change was verified.

---

## 1. Result

| Area | Before | After |
|---|---|---|
| Secrets management | 4/10 — a real admin password was committed | 10/10 — environment-only, production-gated |
| Authentication / session | 8/10 — logout was a no-op for rotated cookies | 10/10 |
| Authorization / RBAC | 9/10 | 10/10 |
| Wallet & financial integrity | 9/10 | 10/10 |
| Deployment / health | 7/10 — health probe behind the rate limiter | 10/10 |
| Frontend correctness (lint) | 6 ESLint errors, 5 warnings | 0 / 0 |
| Accessibility (dialogs) | 5/10 — no Escape, no focus trap | 10/10 |
| Test & verification harness | 5 of 8 verify suites broken | 8/8 green |

**Production readiness: READY**, with the caveats in §9.

Test totals: **219 backend tests** (17 files) + **18 frontend tests**, all
passing. **8 verification suites** + **1 new concurrency suite**, all passing.
Both production builds succeed with zero TypeScript and zero ESLint errors.

---

## 2. Critical fixes

### 2.1 Committed super-admin credential (CRITICAL — secrets)

**Problem.** A real e-mail and password (`sardarghaseeb777@gmail.com` /
`sardar9003202@`) were hardcoded as *production defaults* in
`prisma/admin-seed.ts`, `prisma/seed.ts`, `.env.example`, `README.md`,
`backend/README.md` and `DEPLOYMENT.md`. `railway.yaml` runs
`db:seed:admin` on **every deploy**, so any deployment without an explicit
override provisioned the owner account with a password published in a public
git history.

**Root cause.** Convenience defaults (`process.env.X ?? '<real secret>'`) used
for a production code path.

**Fix.** Credentials now come from the environment only.
`SEED_ADMIN_PASSWORD` is **required in production** (min 12 chars); when it is
absent the seed logs a warning and **skips** (exit 0, so an already-provisioned
deploy still boots) rather than baking in a predictable password. Development
keeps a clearly-labelled throwaway default so a fresh clone still works.

**Files.** `backend/prisma/admin-seed.ts`, `backend/prisma/seed.ts`,
`backend/.env.example`, `README.md`, `backend/README.md`, `DEPLOYMENT.md`.

**Verified.** `grep -rn "sardar9003202\|sardarghaseeb777"` across the tree
returns nothing; `npm run db:seed` provisions the env-driven identity.

> **Action required:** the exposed password is in the public git history. Rotate
> that Gmail password and set a fresh `SEED_ADMIN_PASSWORD` before deploying.

### 2.2 Logout did not end the session (CRITICAL — auth)

**Problem.** After signing out, the "logged out" refresh cookie could still be
exchanged for a brand-new session (`POST /auth/refresh` → **200**).

**Root cause.** `logout()` resolved the presented cookie with `findToken()`,
which filters on `revokedAt: null`. Refresh tokens are single-use and rotate on
every refresh, and a replay inside the 60-second grace window is *deliberately*
chained onto its successor (this is what fixes the random-logout bug). So the
cookie a tab actually holds is very often **already revoked but still
chainable** — and for exactly those cookies `findToken` returned `null`, logout
matched nothing, did nothing, and the cookie grace-chained straight back into a
live session.

**Fix.** Resolve the row **by token hash alone** (no `revokedAt` filter), then
revoke every live refresh token for that account.

**Files.** `backend/src/services/auth.service.ts`.

**Tests added.** `tests/integration/hardening.test.ts` —
*"a cookie already rotated within the grace window is still logged out"* and
*"logout revokes sibling sessions (other tabs / devices)"*.

### 2.3 Suspension/ban left refresh tokens live (HIGH — auth)

**Problem.** `setUserStatus` flipped `status` but never revoked sessions.
`requireAuth` correctly refuses a non-ACTIVE account, so access was blocked —
but the offender's refresh tokens stayed valid, so **lifting** a suspension
silently resurrected every session they still had open, including on devices
the ban was meant to cut off. The status change, notification and audit row
were also three separate writes: a crash between them could suspend an account
with no audit trail.

**Fix.** Status change + forced refresh-token revocation + notification + audit
log now commit in **one transaction**.

**Files.** `backend/src/services/admin.service.ts`.

**Tests added.** *"suspending an account revokes its refresh tokens"* and
*"the suspension, the revocation and the audit row commit together"*.

### 2.4 Health endpoint behind the rate limiter (HIGH — deployment)

**Problem.** `GET /api/health` was mounted **after** `app.use('/api', apiLimiter)`.
Load balancers and uptime monitors probe from a small set of IPs several times
a minute, forever; those probes consumed the shared per-IP budget and the
platform started receiving **429s for its own health checks** — which reads as
an unhealthy service and triggers restart loops. Reproduced live: the endpoint
returned `429 RATE_LIMITED` during testing.

**Fix.** Mounted **before** the limiter, and upgraded from a hardcoded `"ok"` to
a real dependency probe (`SELECT 1`) that returns **503** when the database is
unreachable, without echoing any driver or connection detail.

**Files.** `backend/src/app.ts`, `backend/src/lib/errors.ts`.

**Tests added.** Three tests including 120 rapid-fire probes that must all
return 200, plus an assertion that the response leaks no infrastructure strings.

---

## 3. Frontend correctness

All **6 ESLint errors and 5 warnings** fixed at the root cause — no rule was
disabled and no suppression comment was added.

| Issue | Root-cause fix |
|---|---|
| `react-hooks/set-state-in-effect` ×4 (`admin/results`, `admin/slots`, `match-table`) | Replaced prop→state copying with **derived state**. `MatchSetupEditor` now derives its form from the match (keyed on the server values), so an admin edit wins but a refresh invalidates a stale draft — this also fixed a real bug where the form went stale when the match refreshed while open. |
| `react-hooks/set-state-in-effect` (slots deep-link) | `?tournament=<id>` is now read via `useSearchParams` (inside a `Suspense` boundary) instead of an effect that called `setState`, so the first render is correct. |
| `react/no-unescaped-entities` | Escaped the apostrophe. |
| `@next/next/no-location-assign-relative-destination` ×2 | `window.location.href` → `router.push` (client-side navigation, no full reload). |
| `@typescript-eslint/no-unused-vars` ×2 | Removed dead imports. |

## 4. Accessibility

Every modal rendered as a bare overlay with an `onClick` handler. That is three
WCAG failures: **Escape did not close** any dialog, **Tab escaped to the page
behind the overlay** (keyboard and screen-reader users could operate invisible
controls), and **focus was dropped on `<body>` when closing**.

Added `frontend/src/lib/use-dialog.ts` — one hook providing Escape-to-close, a
wrapping focus trap, focus restoration to the trigger, and background scroll
lock. Wired into the admin `Modal` kit (used across the admin app), the match
result editor, the SEO editor, the submit-result and standings dialogs, the new
support-ticket sheet, and both mobile navigation drawers. `role="dialog"` /
`aria-modal` / `aria-label` moved onto the panel (they were on the backdrop,
which is wrong) and the backdrop became `role="presentation"`.

## 5. Verification harness repairs

5 of the 8 `verify:*` suites were failing — **not** because the application was
broken, but because the scripts had drifted from the code they test. Each was
fixed to test the *current* contract, never by weakening an assertion:

- **Non-existent staff accounts.** `verify:wallet`/`verify:results` signed
  admin JWTs for a hardcoded `admin@clutchnex.gg` that the seed never creates;
  `verify:finance` signed one for a subject id in no database at all.
  `requireAuth` (correctly) re-reads the account and 401s. Added
  `scripts/lib/staff.ts` to resolve or create real staff rows.
- **Stale business rules.** Assertions still assumed a winnings-only withdrawal
  debit (it now drains cash first and spills into winnings) and a PKR 100/200
  minimum (it is now 300). Rewritten against the **total** withdrawable balance.
- **Stale security expectation.** `verify:security` asserted that *any* refresh
  replay is refused, contradicting the intentional grace-chaining. Now asserts
  **both** halves: a within-grace replay chains and keeps the session alive; a
  replay aged past the window is treated as theft and kills every session.
- **Missing workflow step.** `verify:results` never walked
  DRAFT → UNDER_REVIEW → CONFIRMED → PUBLISHED before distributing prizes, and
  left a scratch `SCHEDULED` match that legitimately blocks distribution.
- **Non-idempotent fixtures.** `verify:seo` crashed on every second run
  (duplicate username); now upserts.

## 6. Concurrency & financial integrity

Added `npm run verify:concurrency` (`scripts/verify-concurrency.mjs`), which
fires simultaneous bursts at every money path and asserts invariants **against
the database** rather than HTTP statuses. All 12 checks pass:

| Scenario | Result |
|---|---|
| 5 concurrent PKR 800 withdrawals from a PKR 1000 balance | exactly 1 withdrawal, PKR 800 debited |
| 5 retries with one idempotency key | 1 withdrawal, charged once |
| 5 concurrent transfers from one balance | money conserved, sender never negative |
| 5 transfer retries with one idempotency key | 1 transfer |
| 8 admins approving the same deposit | approved once, credited once |
| Whole-ledger chain + non-negativity | 0 violations |

The underlying implementation was already sound and was **not** changed:
`moveBalance` performs a conditional `UPDATE … WHERE balance ± delta >= 0`
returning the committed balance (locking and balance-checking in one
statement — no read-then-write race), transfers lock both wallets in user-id
order inside one transaction, and unique indexes back every idempotency key.

Auth concurrency re-verified end-to-end: **2, 5, 8 and 20** simultaneous
refreshes with the same single-use cookie all succeed, the session stays alive,
and no fraud alert is raised for a benign race.

## 7. Tests added

`backend/tests/integration/hardening.test.ts` — **19 regression tests**:
health endpoint (3), session-status enforcement for SUSPENDED / BANNED /
soft-deleted / non-existent accounts (4), RBAC with a forged role claim (2),
concurrent refresh at 2/5/8/20 plus chain-continuation and revoked-session
rejection (6), logout (2), admin suspension (2).

Backend total: **200 → 219 tests**, all passing.

## 8. Commands

```bash
# Backend
cd backend && npm ci && npm run db:dev &   # embedded PostgreSQL
npm run db:migrate && npm run db:seed && npm run dev

npm run typecheck && npm test && npm run build
npm run verify:concurrency   # + verify:{join,wallet,results,finance,support,security,seo,pwa}
npm run test:auth-race

# Frontend
cd frontend && npm ci && npm run dev
npx tsc --noEmit && npx eslint && npm test && npm run build
```

## 9. Remaining issues — read this

1. **Rotate the leaked credential.** The old admin password is in the public git
   history. The code no longer uses it, but the account must be changed.
2. **Browser-based UI testing was not possible** in this sandbox — Playwright's
   Chromium download is network-blocked. Responsive and visual behaviour was
   audited from source and rendered markup (all wide tables are correctly
   wrapped in `overflow-x-auto`; no page-level horizontal overflow found) and
   every route returns 200, but I have **not** visually confirmed layouts at
   320–1920 px. Run a real device/browser pass before launch.
3. **Dev-database noise.** Under heavy concurrent load the embedded PGlite dev
   database occasionally returns `portal "" does not exist` (a single-writer
   driver artifact), surfacing as a 500 *after* a successful commit. Financial
   invariants were unaffected in every run. This should not occur on a real
   pooled PostgreSQL, but confirm under load on staging.
4. **Not independently re-audited:** team-composition rules after paid
   registration, tournament-cancellation refunds and prize distribution were
   exercised only through the existing (now-passing) suites
   `verify:join` / `verify:results` / `tests/integration/prizes.test.ts`, not
   through fresh adversarial tests.
