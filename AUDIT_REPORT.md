# CLUTCHNEX Production Audit

**Audit date:** 29 August 2026 (PKT)  
**Repository:** `sardarhaseebkhan53-hub/free-fire-tornament`  
**Branch:** `arena/01a04c90-free-fire-tornament`  
**Scope:** full repository review before runtime changes

## Executive decision

**Release recommendation: NO-GO until the release blockers below are fixed and retested.**

> ### ✅ Status — 30 August 2026 (Phase 18)
>
> **Every P0 in this audit is closed, and every finding was re-verified against the
> source rather than assumed.** See
> [PHASE18_SECURITY.md](./PHASE18_SECURITY.md) for the `file:line` evidence per
> finding, the two additional security issues found during that pass (a spoofable
> `X-Forwarded-For` origin and a stored-XSS path in admin ad embeds), and the
> residual-risk list.
>
> Nine of the eleven blockers were already fixed in the code this audit was written
> against; prize-distribution lifecycle and post-registration roster mutability were
> genuinely open and are closed here, together with the dependency audit.
>
> Proof, all green: 279 backend tests (a 100-way scale tier, a lifecycle certification,
> 24 unit tests on the retry semantics), 8 `verify:*` suites, and `npm run
> verify:concurrency` — a live HTTP burst harness — at 19/19 across consecutive runs
> with **zero bare 500s and zero spurious 401s**, including "8 admins approve one
> deposit → `200,409×7`, credited exactly once" and "5 concurrent 800-PKR withdrawals
> on a 1000 balance → exactly one wins". `npm audit` is 0 in both packages, frontend
> lint is 0, and both production builds pass.
>
> **The concurrency proof was then re-run against a real multi-backend PostgreSQL 17,
> not just the embedded single-writer dev engine — and that found a bug the dev engine
> structurally could not show:** two simultaneous joins by one player both cleared the
> double-join guard (it ran before the tournament row was locked), so the entry fee was
> debited twice against one registration row, the loser's upsert re-seated the winner,
> and `registeredSlots` counted a phantom seat. Fixed — `SELECT … FOR UPDATE` now opens
> the join transaction and the registration is created-or-revived rather than
> overwritten — reproduced 6/6 before and 8/8 clean after. Full write-up, the 100-wide
> prize-distribution certification, paid-roster integrity and wallet-vs-ledger
> reconciliation: [PHASE18_CERTIFICATION.md](./PHASE18_CERTIFICATION.md).
>
> **Release recommendation is now conditional-GO:** the remaining NO-GO items are
> operational, not architectural — no CI workflow enforcing these gates, and the
> `onDelete: Cascade` edges on financial rows (§5.1–5.2 of the Phase 18 report).
> No UI was changed: the design was not the problem.
>
> ### ✅ Status — 30 August 2026 (Phase 19, follow-up to PR #21)
>
> The two capabilities that certification left open are implemented, and the whole
> tournament journey is now **proven end-to-end rather than assembled from unit results**:
> reliable check-in (window derived from `registrationDeadline … startTime`, admin-overridable;
> one guarded idempotent mutation; a live 30 s no-show pass; staff board; audit rows) and Web
> Push for `MATCH_STARTING` / `ROOM_CREDENTIALS`, where **a push can never affect money** —
> sends happen after commit, outside the money transaction, and the feature is inert (not
> mocked-success) when no VAPID keys are configured.
>
> New gate: `npm run verify:journey` drives login → team → registration → eligibility → slot
> → atomic payment → confirmation → check-in → match → room credentials → results →
> verification → leaderboard → prizes → wallet → withdrawal → payout against a running API
> and **real PostgreSQL 17**, finishing with cohort conservation (Σ balances === Σ signed
> ledger) and an audit census: **94/94 checks green**, alongside 333 unit/integration tests,
> `verify:concurrency` 19/19 on the same database, both builds, and 0 audit findings.
>
> The journey found a defect no API response ever reported: publishing an event **with** its
> match settings creates the match before anyone registers, so `match_participants` stayed
> empty forever — blank room roster, scoring that could not be frozen ("No played
> participants"), and credential/start notifications with no recipients. Fixed with an
> idempotent re-sync after a confirmed join and when staff open the room, always outside the
> money transaction.
>
> Not claimed: the Playwright suite (`frontend/e2e/`, 13 tests) is collected, type-checked and
> linted but **no browser binary was installable here, so no spec has executed**; real
> FCM/autopush delivery, managed-Postgres sizing and `audit_logs` write-revocation remain
> deployment items. `backend/PHASE19_NOTES.md` §6 keeps that list honest.


The repository has a credible foundation: the requested architecture is present, the Prisma schema and migration history are aligned locally, manual payments and wallet movements use server-side calculations, PWA/SEO infrastructure is substantial, and the existing automated suites cover many important happy paths. However, several concurrency, lifecycle, authorization, privacy, and admin-client defects can cause incorrect financial state, expose protected data, or leave a tournament in a state that does not match its ledger history.

This audit intentionally contains **no runtime implementation changes**. The next implementation phase must remain targeted and additive, and must not start until the UI direction in [`UI_CONCEPTS.md`](./UI_CONCEPTS.md) is approved.

## Audited areas

- Next.js App Router / React 19 / TypeScript / Tailwind v4 / Framer Motion / PWA
- Express 5 API, JWT access tokens, rotating HttpOnly refresh tokens, CSRF header guard, RBAC, rate limits, Helmet/CORS
- Prisma 7 schema, generated client, migrations, PostgreSQL integration and financial relations
- Solo, duo, squad and clash-squad registration, team membership and slot allocation
- Manual deposits, wallet ledger, transfers, withdrawals, refunds, referral rewards and prize credits
- Match lifecycle, room credential release, result submissions, result review, standings, leaderboard and winners
- Admin pages and browser API helper contract
- Upload validation, private-file routes, Markdown sanitization and ad/content handling
- SEO metadata, sitemap, robots, structured data, service worker and offline route
- Support tickets, NEXA guardrails and configurable WhatsApp support

## Validation results

| Check | Result | Notes |
|---|---:|---|
| Backend build | PASS | TypeScript compilation succeeds |
| Backend typecheck | PASS | Existing generated Prisma setup typechecks |
| Backend tests | PASS | 184/184 |
| Frontend tests | PASS | 18/18 |
| Frontend production build | PASS | Next production build succeeds |
| Frontend lint | **FAIL** | 5 errors, 7 warnings; see below |
| PWA verification | PASS | Manifest, icons, service worker, offline route and crawlability checks pass |
| SEO verification | PASS after cleanup | First run hit a stale `seotest_admin` unique key; deleting the leftover fixture and rerunning passed all checks |
| Support verification | PASS | Privacy, staff replies, NEXA guardrails, rate limits and audit checks |
| Security verification | PASS | Upload privacy, fraud, auth rotation/reuse, CSRF, headers/limits, audit coverage and bcrypt-cost checks; concurrency is not covered |
| Prisma migrations | PASS locally | Migrations through `20260829100000_match_results_slots` are recorded finished; local actual schema contains latest result/slot/evidence/team fields |
| Production dependency audit | **FAIL** | 3 high, 0 critical: Prisma 7 → `@prisma/config` → `deepmerge-ts`; npm proposes an incompatible Prisma 6 downgrade |

### Existing lint failures

- `frontend/src/app/(admin)/admin/results/page.tsx`: two `setState`-inside-effect errors and one unescaped-entity error; one internal navigation warning
- `frontend/src/app/(admin)/admin/slots/page.tsx`: two `setState`-inside-effect errors, one unused import and one hook-dependency warning
- `frontend/src/components/admin/match-table.tsx`: one `setState`-inside-effect error
- `frontend/src/app/(admin)/admin/matches/page.tsx`: one unused import and one internal navigation warning
- `frontend/src/components/admin/admin-shell.tsx`: two unused imports

The lint failures are not cosmetic only: they cluster around admin result/slot flows that are financially and operationally sensitive.

## Release-blocking findings

### P0 — financial concurrency and conditional state changes are not safe

`backend/src/services/wallet.service.ts:46-83` reads a wallet balance, calculates the new value, inserts a ledger row, and then updates the wallet. The read is not protected by a row lock and the update is not conditional on the expected balance. Concurrent withdrawals, entries, transfers, admin adjustments, conversions, or prize credits can both validate against the same balance. The ledger rows can then contain conflicting `balanceBefore`/`balanceAfter` values and the mirrored balance can lose one movement or permit an overdraft.

The same pattern is duplicated in the tournament join and cancellation code (`backend/src/services/tournament.service.ts`). Tournament registration uses a race-safe slot counter, but each payer's cash balance is still read and later overwritten without a conditional debit. Two independent tournaments can spend the same wallet balance concurrently.

**Required fix:** make every debit/credit use an atomic, row-locked or conditional update that returns the authoritative before/after values; create the immutable ledger row from those values in the same transaction. Add simultaneous-request tests for one wallet, two wallets in opposite transfer directions, multiple registrations, withdrawal holds, deposit approval and prize distribution.

### P0 — deposit and withdrawal reviews have check-then-update races

`backend/src/services/payment.service.ts:472-559` checks `Deposit.status === PENDING`, credits on approval, and later updates the row without a conditional `WHERE status = PENDING` transition. Two reviewers can both credit one deposit, or an approval and rejection can race and leave the status inconsistent with the ledger.

`backend/src/services/payment.service.ts:591-660` has the same state check before the status update. An `APPROVE` and `REJECT` can both observe `PENDING`; the rejection can return the held winnings while the approval leaves the withdrawal approved, or the final status can disagree with the movement.

**Required fix:** conditional state transitions with affected-row assertions, or lock the payment row before applying the movement. The operation and its audit/notification must remain one transaction. Add concurrent review tests and verify exactly one terminal outcome and exactly one compensating movement.

### P0 — suspended/banned accounts retain active bearer authorization

`backend/src/middleware/auth.ts:23-43` accepts a valid JWT and trusts its `sub`, `role` and username without loading the user or checking current account status. `auth.service.ts` checks status at login and refresh, but an access token issued before suspension remains usable until expiry for joins, transfers, deposits, withdrawals, support, team changes and other protected actions. The token also retains its old role if an account's role is changed.

**Required fix:** enforce current user status and current role in authorization middleware, preferably with a short-lived cache-safe lookup or a token/session version that is revoked on status/role changes. Ensure a missing/deleted user is rejected. Add tests that suspend/ban/demote an account after token issuance and assert all sensitive routes reject it.

### P0 — admin cancellation can commit `CANCELLED` before rejecting populated tournaments

`backend/src/services/admin.service.ts:458-484` updates the tournament status before counting confirmed registrations. When an administrator attempts to cancel a tournament with registered players, the method throws the “use the cancellation flow” error **after the update has already committed**. The tournament can be left cancelled without refunds. The update and guard are not in one transaction.

The dedicated `adminCancelTournament` path is transactional (`backend/src/services/tournament.service.ts:483-530`), but callers can still reach the defective generic status endpoint.

**Required fix:** validate all lifecycle preconditions before mutation, then perform the status change, refunds, notifications and audit atomically. Use one canonical cancellation service and reject arbitrary status writes that bypass it.

### P0 — result publication and prize distribution do not share a strict lifecycle gate

- `setResultsStatus` (`backend/src/services/result.service.ts:782-836`) accepts arbitrary enum jumps such as `DRAFT → PUBLISHED` or `DRAFT → CONFIRMED`; it does not require the immediate predecessor state.
- `confirmStandings` (`result.service.ts:844-900`) does not require or set `resultsStatus === CONFIRMED`, so “confirm” is not tied to the workflow state.
- `distributePrizes` (`result.service.ts:364-520`) ranks `PLAYED` participants without requiring every tournament match to be published/confirmed. It can distribute from partial results.
- `tournamentStandings` aggregates played rows without a published-state predicate. Admin recalculation also includes rows from every result state.

**Required fix:** enforce a transition matrix in the service, require completed matches and verified rows, require all tournament matches to be in the approved terminal state before distribution, and lock the tournament/results set while calculating. Prize distribution should be idempotent on a unique award key and must have a reconciliation test against total awarded, total credited and any documented rounding remainder.

### P0 — team membership can mutate after a paid registration

`backend/src/services/team.service.ts:218-235` lets captains remove members or members leave without checking confirmed registrations, match participation, or an in-flight tournament. Prize distribution resolves team recipients from the **current** team membership (`result.service.ts:445-495`), not a registration-time snapshot. A paid member can be removed before play, a team can become underfilled, or the eventual award split can change after the entry fee is collected. Team acceptance and join-by-code capacity checks are also outside a transaction (`team.service.ts:64-91`, `186-215`), so concurrent accepts can exceed the 2/4-member cap.

**Required fix:** freeze relevant membership once a team is registered, or store an immutable registration participant snapshot; reject leave/remove operations that would invalidate a paid registration; make invite acceptance and code joins conditional/locked; define admin replacement/refund behavior explicitly.

### P0 — audit persistence is best-effort for some sensitive mutations

`backend/src/lib/security.ts:54-82` deliberately swallows audit write failures. This is acceptable only for non-critical telemetry, but the platform requirement is that sensitive mutations have an audit record. A post-transaction call can succeed while its audit row is lost. Some flows use `audit()` after commit, while others write directly inside transactions.

**Required fix:** classify events. Financial, authorization, result publication, prize, refund and admin lifecycle mutations must write with `auditIn(tx, ...)` atomically; if audit persistence fails, roll back the business transaction or place the entire event in a durable outbox. Keep best-effort logging only for non-critical diagnostics.

## High-priority correctness, privacy and security findings

### Public and protected data boundaries

1. `backend/src/services/team.service.ts:270-304` returns any team's members, full names, Free Fire UIDs, IGNs and stats to any authenticated caller. There is no ownership check and `showPublicProfile` is ignored. A user who knows a team ID can enumerate private identity data.
2. `backend/src/services/public.service.ts:218-234` exposes recent winners when **any** match in the tournament is published. The final results endpoint correctly requires all matches to be published, but the winners feed does not. Gate the feed on all-match publication and credited status.
3. `backend/src/services/public.service.ts:139-159` passes stored `embedHtml` through the public ad response. It is not currently rendered, but if a renderer is added it becomes a stored-XSS boundary. Keep it unused or sanitize it with a strict iframe/provider allow-list; never inject arbitrary admin HTML.
4. `backend/prisma/schema.prisma` uses `onDelete: Cascade` from `User` to `WalletTransaction`, `Deposit`, `Withdrawal`, `WalletTransfer`, `Winner`, and related participation/history rows. The application has no normal delete UI, but a physical user deletion would destroy immutable financial history. Replace destructive paths with archive/anonymize semantics and use restrictive foreign keys for immutable records in an additive migration.

### Admin browser contract regressions

`frontend/src/lib/client-api.ts:57-69` expects backend-relative paths such as `/admin/...` and prefixes `/api/backend`. Eight admin pages call `apiGet()` with an already-prefixed path, producing requests such as `/api/backend/api/backend/admin/ads` after a refresh/action:

- `admin/ads/page.tsx`
- `admin/blog/page.tsx`
- `admin/deposits/page.tsx`
- `admin/payment-accounts/page.tsx`
- `admin/seo/page.tsx`
- `admin/settings/page.tsx`
- `admin/tournaments/page.tsx`
- `admin/withdrawals/page.tsx`

The initial list may load while a post-action refresh silently fails because `apiGet` converts the failure to `null`.

`frontend/src/components/navbar-client.tsx:46-51` and `frontend/src/components/user/user-shell.tsx:87-92` call cookie-authenticated logout without the required `x-clutchnex-client` header. The API CSRF guard is expected to reject these calls, even though the UI clears local storage and appears logged out.

`frontend/src/components/admin/match-table.tsx:131` and `frontend/src/app/(admin)/admin/results/page.tsx:401-402` expose protected CSV URLs as ordinary links. A browser navigation cannot attach the localStorage bearer token, so the export will normally return 401. Use an authenticated blob download through `authedFetch`, or add a short-lived, scoped server download token.

### Result/stat reconciliation defects

- `reviewResult` only compensates `PlayerStat` for a previously played **solo** participant (`result.service.ts:192-205`, `249-260`). Correcting or rejecting a previously approved team result leaves member stats stale.
- `saveAdminResult` can alter result rows before publication, but scoring changes are not frozen by match/tournament lifecycle. Reconcile any already-saved or published history before permitting a scoring edit.
- `recalculateLeaderboard` (`backend/src/services/admin.service.ts:619-660`) selects `match.resultsStatus` but does not filter it; its audit text explicitly says `published + draft`. It upserts represented users but never resets stale `PlayerStat` rows for users no longer represented. A prior manual/old result can survive a rebuild.
- Team prize splits use floor-to-cents per member (`result.service.ts:472-475`) without recording or crediting the remainder. The awarded winner amount can exceed the sum of wallet credits. Define a deterministic remainder recipient or a liability/reconciliation row.

### Tournament and scoring lifecycle

`updateTournamentScoring` (`backend/src/services/admin.service.ts:264-295`) has no freeze condition. It can change points after registration, after results exist, or after a published financial outcome. This changes standings without changing the historical scoring configuration used to calculate them.

`setTournamentStatus` accepts broad enum transitions and performs no transition matrix. `setMatchStatus` likewise accepts arbitrary operational states. Lifecycle changes need server-side legal transition maps, conditional updates and match/tournament consistency checks.

### Upload and request-context defects

- `backend/src/lib/upload.ts:160-168` rejects only when `used > quota`; the user can upload one more item at exactly the quota. Change to `used >= quota`.
- Upload validation writes a file before the subsequent database mutation. If deposit/result/support creation fails, the accepted file can remain orphaned. Use a cleanup-on-error hook or a pending upload record with a reconciliation job.
- `backend/src/lib/security.ts:23-39` trusts the first caller-provided `X-Forwarded-For` entry. With the configured one-hop proxy, a client can spoof that value and poison IP-attributed audit/fraud/rate controls. Derive the origin from a trusted proxy chain or accept a forwarded client header only after explicit platform configuration.

### Frontend product gaps that affect conversion and supportability

- There is no authenticated `/profile` screen even though `PUT /api/auth/profile` and profile fields exist. The user shell labels Referrals, Notifications and Settings as “Soon”; the requested player profile/dashboard flow is therefore incomplete.
- There is no forgot-password/reset-password frontend route. The login copy tells the player to use “Support → Email”, while the backend has dedicated endpoints.
- Registration labels Free Fire UID and IGN optional, but solo join requires them and the join component does not collect them. A newly registered player who skipped those fields reaches a dead end instead of a join-time profile step.
- The user shell top wallet chip (`user-shell.tsx:94-96`, `214-226`) displays cash + coins + winnings + bonus as a single `PKR` value, while the wallet page correctly presents cash + winnings as the player-facing PKR balance. Coins/bonus must not be silently added to the PKR chip.
- `frontend/src/lib/client-api.ts:100-108` maps every non-`UNAUTHORIZED` API error to status 400. A failed refresh returns `TOKEN_INVALID` and is not recognized as a 401 by callers that need to send the player to login.
- Public tournament participants include usernames and avatars. Confirm the product decision that these are public, and do not expand the response to email, phone, Free Fire UID, payment data or unpublished results.

## Existing strengths to preserve

- Server-side fee, score, wallet and prize calculations; no client-supplied balance or prize authority.
- Unique registration constraint and atomic tournament slot increment; keep this while making wallet debits atomic.
- Manual payment review and immutable ledger direction; do not delete or edit financial rows.
- Rotating hashed refresh-token records, replay detection and revocation on password reset.
- CSRF header guard for refresh/logout, pinned CORS, Helmet, upload byte inspection and private upload routes.
- Markdown sanitizer with explicit tags/attributes/schemes and protected screenshot responses.
- Solo join path does not require `/teams/my` or a team; team modes require a captain and full team.
- NEXA server guardrails, support privacy checks, configurable WhatsApp settings, PWA offline shell and SEO structured data.

## Targeted implementation sequence after approval

1. **Financial and authorization guardrails:** atomic wallet primitive, conditional deposit/withdrawal transitions, current-status authorization, immutable audit transaction/outbox, cancellation fix.
2. **Results and tournament lifecycle:** transition matrix, all-match publication gate, scoring freeze/version snapshot, team participant snapshot, leaderboard rebuild filter/reset, payout reconciliation.
3. **Privacy/data durability:** team authorization/profile visibility, winners gate, archive semantics and restrictive financial foreign keys, upload cleanup/quota/IP handling.
4. **Browser contract fixes:** admin paths, CSRF logout, authenticated CSV downloads, refresh error classification and lint.
5. **Player and admin UX:** profile and password recovery routes, join-time identity collection, wallet chip correction, explicit loading/error/empty states, then implement the approved concepts.
6. **Regression/operations:** deterministic serial fixtures, concurrency tests against PostgreSQL, migration/drift checks on a production-like database, dependency remediation plan for Prisma/deepmerge-ts, and a final full validation run.

No immutable financial history should be deleted during these changes. Corrections must be reversal entries or new audit-linked records.

## Approval gate

Please approve the visual direction and the implementation order in [`UI_CONCEPTS.md`](./UI_CONCEPTS.md) before runtime/UI changes begin. A useful approval is one of:

- **Approve all:** implement the guardrails first, then the complete UI direction.
- **Approve with changes:** name the screen/flow changes.
- **Audit only:** keep this PR documentation-only and defer implementation.
