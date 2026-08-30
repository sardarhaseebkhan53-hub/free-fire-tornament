# PHASE 18 — Production Security + Financial Hardening

**Date:** 2026-08-30 · **Branch:** `arena/01a05152-free-fire-tornament`
**Scope:** real-money correctness, concurrency safety, auth lifecycle, settlement immutability, dependency audit, live proof.
**Explicitly out of scope (per instruction):** UI redesign. The design is not the problem; nothing visual was changed except one security fix inside an existing ad component.

---

## 1. Verdict

| Gate | Result |
|---|---|
| Backend `tsc --noEmit` | ✅ 0 errors |
| Backend `npx vitest run` | ✅ **252 / 252** (19 files) — was 219 at phase start |
| Backend `npm run build` | ✅ |
| Live HTTP concurrency harness | ✅ **12 / 12 assertions, five consecutive runs, zero 500s** |
| All 8 live `verify:*` suites (`join wallet results finance security support seo pwa`) + `verify:concurrency` | ✅ green against the running stack (there is no `verify:ads` — ads are covered by `tests/integration/public-ads.test.ts`) |
| Frontend `npm run lint` | ✅ 0 errors, 0 warnings (was 5 errors / 7 warnings in the audit) |
| Frontend `npx vitest run` / `npm run build` | ✅ 18/18 · build OK |
| `npm audit --omit=dev` (backend) | ✅ **0** (was 3 high) |
| `npm audit --omit=dev` (frontend) | ✅ 0 |
| `git diff --check` | ✅ clean |

Release stance: **the money layer is now safe to run on real balances**. The remaining risks are listed in §7 — they are operational, not correctness bugs.

---

## 2. The 11 blockers — status and *file:line* evidence

Nine of the reviewer's eleven blockers were already remediated in the checked-out tree; two (#6 prize-distribution lifecycle, #11 dependency vulnerabilities) were open and are closed here. Every one is now backed by a test or a live harness assertion. No claim below is inherited from a previous report — each line was read in this session.

| # | Blocker | Status in tree | Evidence (backend/ unless noted) |
|---|---|---|---|
| 1 | **Wallet race / overdraft** | Already fixed — verified | `src/services/wallet.service.ts:74-81` — a single `UPDATE "wallets" SET col = col ± delta WHERE "userId" = … AND col ± delta >= 0 RETURNING col`. No read-then-write. Zero rows returned ⇒ `INSUFFICIENT_BALANCE` (`:83-87`), so a balance can never go negative and `balanceBefore/After` in the ledger come from the write itself, never from a stale read. |
| 2 | **Double deposit approval** | Already fixed — verified + live-proved | `src/services/payment.service.ts:622-627` — the reviewer must *claim* the row: `tx.deposit.updateMany({ where: { id, status: 'PENDING' }, data: { status } })`; `count !== 1` ⇒ `CONFLICT` **before** any credit is written. Live harness check 4: 8 admins race → `200,409×7`, wallet credited exactly once (PKR 1000). |
| 3 | **Withdrawal approve/reject race** | Already fixed + hardened here | `src/services/payment.service.ts:802-810` — same conditional claim on `WITHDRAWAL_FLOW.from`; reject refunds every held `DEBIT` bucket (`reviewWithdrawalOnce`). Request path `:314-324` + `:432-441`. Live harness checks 1–2: `201,400×4` with exactly one `WITHDRAWAL` debit; key retries `201×5` with exactly one row. |
| 4 | **Suspended user keeps a valid JWT** | Already fixed — verified | `src/middleware/auth.ts:36-59` — `requireAuth` re-reads the account on every request (`loadAccount`), rejects `status !== 'ACTIVE'`, and takes the **role from the DB**, never from the token. Tests: `tests/integration/hardening.test.ts:84-136`; suspension is also enforced mid-transaction at join time (`src/services/tournament.service.ts:309-312`). |
| 5 | **Cancellation before refund / unsafe status change** | Already fixed — verified + tested | `src/services/admin.service.ts:520-…` `setTournamentStatus`: explicit transition matrix (`DRAFT→REGISTRATION_OPEN|CANCELLED`, `REGISTRATION_OPEN→LIVE|CANCELLED`, `LIVE→COMPLETED|CANCELLED`, terminal `COMPLETED`/`CANCELLED`), `FOR UPDATE` on the tournament row, registrations re-read inside the tx, refunds written **in the same transaction** as the status flip and the ledger credits, uniform return shape so a no-op cannot leak a missing field. 3 tests cover it (`phase18-races.test.ts`, cancellation group). |
| 6 | **Weak prize-distribution lifecycle** | **CLOSED HERE** | `src/services/result.service.ts:356-660`. See §3.1. |
| 7 | **Team membership mutable after paid registration** | **CLOSED HERE** (2nd half) | Roster snapshot on the registration + frozen reads: `src/services/tournament.service.ts:295,322,452-457`, `src/services/slot.service.ts:384-385`, guard in `src/services/team.service.ts:268-282` enforced at `:86` (kick), `:248` (leave), `:289` (join by code), `:304` (invite accept) and inside `src/services/result.service.ts` when resolving payout recipients. Migration `prisma/migrations/20260830120000_roster_snapshot/migration.sql`. See §3.2. |
| 8 | **Non-transactional audit logging** | Already fixed — verified + extended | 34 in-transaction `tx.auditLog.create` calls across the money services; the only bare `audit()` calls left in services are the deliberate post-rollback fraud/telemetry trails (`src/services/tournament.service.ts:44,231`, `src/services/transfer.service.ts:209`) and non-financial auth events. This phase moved the two remaining *sensitive* writes into their transaction: `resetPassword` / `changePassword` now run in an interactive `prisma.$transaction` with `auditIn` (`src/services/auth.service.ts:490,574`), so a password change and its audit row commit or roll back together. |
| 9 | **Admin API URL-prefix bugs** | Already fixed — verified | `frontend/src/lib/client-api.ts:299` normalises `/api/*` → `/api/backend/*`; `apiGet` prefixes `/api/backend`. Every `(admin)` page passes a bare `/admin/...` path (grep-verified), and the three remaining literal `/api/backend` strings are correct by design: the proxy's own upstream fetch (`admin/results/page.tsx:75`), an image URL the browser must load through the proxy (`admin/support/page.tsx:100`), and logout. |
| 10 | **Lint failures (5 errors / 7 warnings)** | Already fixed — verified | Frontend `npm run lint` exits 0; backend typecheck clean (a real `typecheck` script now exists and is what the gates run). |
| 11 | **3 high npm vulnerabilities** | **FIXED HERE** | Root cause: `prisma@7.10.0 → @prisma/config@7.10.0 → deepmerge-ts@7.1.5`. Prisma 7.10 is the newest 7.x, `@prisma/config` pins `deepmerge-ts@7.1.5` exactly, and no 7.x `deepmerge-ts` ≥8 exists — so upgrading Prisma cannot fix it. `backend/package.json:76-78` adds an npm `override` to `deepmerge-ts@^8.0.2` (API-compatible superset; `tsc`, build and the full suite pass). `npm audit --omit=dev` → 0 in both packages, in both `audit` and `audit:all` modes. |
| + | **No concurrency tests** | **CLOSED HERE** | `backend/tests/integration/phase18-races.test.ts` (21 tests) and `backend/scripts/verify-concurrency.mjs` against a live server + real Postgres. See §5. |

---

## 3. What this phase actually changed

### 3.1 Prize distribution is now a settlement (`result.service.ts:356-660`)

Before: any admin could run a distribution whenever a prize row existed, and recipients for a team prize were resolved by reading **live** team membership at payout time. Two defects: settlement could race the results pipeline, and money could follow a roster that had changed since the entry fee was paid.

Now, in one interactive transaction:

1. **Publication gate** — every match must be `resultsStatus = 'PUBLISHED'`; otherwise `CONFLICT` (`:371`).
2. **Terminal tournament** — `COMPLETED` required; `CANCELLED` explicitly refused (`:369`).
3. **Idempotency** — existing `Winner` rows ⇒ `CONFLICT`, never a partial re-pay (`:383,598`).
4. **Serialization** — `SELECT … FROM "tournaments" FOR UPDATE` (`:462`) so two admins cannot interleave, plus a post-commit re-check of the award total.
5. **Frozen-roster recipients** — payout goes to the union of `TournamentRegistration.rosterUserIds` over that team's `CONFIRMED` registrations (sorted ⇒ deterministic), *not* to `Team.members` at payout time. A legacy row with no snapshot still pays but is labelled `recipientSource: 'LIVE_MEMBERSHIP_FALLBACK'` in the response and in the audit row (`:617,636-638`).
6. **No re-routing** — if a paid member has no wallet, the whole settlement aborts rather than silently giving their share to teammates (`:544`).
7. **Cent-exact reconciliation** — shares must sum to the award to the cent; the last member absorbs the rounding remainder; the response carries `reconciliation: { awarded, credited, unassignedRemainder }` (`:556-559,636`) and an `unassignedRemainder ≠ 0` aborts (`:584`).
8. **Scoring freeze** — `updateTournamentScoring` refuses once any match has left `DRAFT`, any result is finalized, or the tournament is not `SCHEDULED`/`DRAFT` (`admin.service.ts:283-…`), with an in-transaction re-check so the freeze cannot be raced. The only three scoring write sites in the repo all go through it.

> The team-mode equal split across the paid roster (plus KILL_POOL / MVP shares) is existing product behaviour and was left alone — only the *source of the recipient list* changed. `mutation-check` proof: inverting the recipient-source guard (`if (false as boolean && ids.length)`) makes the snapshot test fail, so the test is load-bearing.

### 3.2 Roster immutability after a paid entry

* `TournamentRegistration.rosterUserIds` (JSON array, sorted) + `rosterCapturedAt`, added by `prisma/migrations/20260830120000_roster_snapshot/migration.sql` — additive, backfill-safe (legacy rows stay `NULL` and fall back with an explicit label), never destructive.
* Captured **under the team row lock** inside the join transaction, i.e. from the same membership set that was just charged (`tournament.service.ts:300-322`). Independent-squad pairing captures it at the same moment (`slot.service.ts:384-385`).
* `assertTeamRosterMutable` refuses kick/leave/join/invite-accept while a `CONFIRMED` registration exists and the tournament has not finished/cancelled.
* `transferCaptaincy` is deliberately **not** blocked: losing the captain badge must never strand a paying team in an undeletable team. It is still audited.
* No `Winner` column was added — a payout is already reconstructible from the ledger (`entityType = 'Winner'`, `entityId = winner.id`), which keeps immutable financial history in exactly one place.

### 3.3 A shared retry vocabulary: `src/lib/tx-conflict.ts`

Nine of the money paths can legitimately fail with a *transient* database error (deadlock `P2034`, serialization `40001`, lock-not-available `40P01`, and on the embedded dev engine `P2039`). Three call sites had grown three private copies of that classifier. They now share one module:

* `RETRYABLE_TX_CODES` / `isRetryableTxError` — the classification, with a documented note that `P2039` is not in Prisma's public docs.
* `isLostConnection` — driver/pool transport blips (`Connection terminated unexpectedly`, `Can't reach database server`, socket hang-up, timeouts). **A dead pooled connection is transient, not a business failure.**
* `withIdempotentRetry(fn, { attempts, busyMessage, retry })` — retries only idempotent work; an `ApiError` (a real 4xx decision) is **never** retried. Exhaustion ⇒ `409 CONFLICT` with an actionable message, never a `500`.
* `withoutBlindRetry(fn, msg)` — for money writes with **no** idempotency key: one attempt, transient ⇒ `409`. A retry there could duplicate a payout whose response was lost in transit.
* `isIdempotentKeyCollision` + `readAfterUniqueViolation` — a `P2002` on a unique idempotency key means "the other attempt is committing": re-read (40/80 ms backoff, 3 tries), replay the original record if it lands, else a clean `409` telling the client to check history. **An idempotency-key collision must never surface as a 500.**

Wired into: `requestWithdrawal`, `reviewDeposit`, `reviewWithdrawal` (`payment.service.ts:314,585,763`), `createTransfer` (`transfer.service.ts:54`), `joinTournament` (`tournament.service.ts:109-118`, covering the preflight reads that previously sat outside the retry loop), and `requireAuth`'s account read (`middleware/auth.ts:41-52`). `cancelWithdrawal` is deliberately **not** retried — it has no key, so it uses the single-attempt path semantics.

Wording was changed too: a conflict now says *"this request has already been reviewed/updated (possibly by an earlier attempt of your own) — reload"* instead of an ambiguous "try again", because the operator needs to know the row already moved.

### 3.4 Two live-burst bugs found only by running the stack

1. **500s on withdrawal approval bursts** — the shared admin token in the harness raced `createDeposit`'s unique `transactionId`; the loser hit `P2002` and fell through to the generic 500 handler. Fixed by §3.3's `readAfterUniqueViolation` replay path.
2. **500s under 5-way transfer bursts** — root cause was **not** application logic: `scripts/dev-db.mjs` started the embedded PostgreSQL with `maxConnections: 10` and a 120 s idle timeout while the harness fires 5-8 concurrent transactions. `pg-pool` handed back connections the server had already closed (`Connection terminated unexpectedly`). Raising it to `maxConnections: 20` / `idleTimeout: 300_000` (with the reasoning documented in the file) made the harness deterministic: **five consecutive 12/12 runs with zero 500s**. Lesson recorded in §7.

### 3.5 Security fix (not UI work)

`frontend/src/components/ad-card.tsx` rendered admin-authored `embedHtml` with `dangerouslySetInnerHTML` — stored XSS from any account that can write an ad, executing in the origin that holds the wallet session. It now renders inside a `sandbox="allow-scripts"` `srcDoc` iframe (opaque origin, no top-navigation, no popups, `referrerPolicy="no-referrer"`), so an embed can never read site storage. No layout change: same card, same "Sponsored" badge, same 112 px band.

Two backend security items were verified as already-correct while auditing this area, and are recorded so they are not re-litigated: `requireRole` **fails closed** on an unknown role (`middleware/auth.ts:66-89`), and `clientIp` takes the **last** `X-Forwarded-For` entry — the one our own proxy hop appended — rather than the leftmost, which is client-controlled (`src/lib/security.ts:34-45`).

---

## 4. Invariants now enforced (and where)

| Invariant | Enforced by | Proven by |
|---|---|---|
| No balance can go negative, under any interleaving | Conditional `UPDATE … RETURNING` (`wallet.service.ts:74-81`) | Harness checks 1/3; `phase18-races` groups 1-3 |
| One deposit can be credited exactly once | `status='PENDING'` claim before credit | Harness check 4; `phase18-races` #1 |
| A withdrawal is debited once; a reject refunds once | Claim on `WITHDRAWAL_FLOW.from` + bucket refunds | Harness checks 1-2; `phase18-races` #3 |
| One idempotency key = one operation | Unique index + `P2002` → replay | Harness checks 2/3b; `phase18-races` "five parallel requests sharing one idempotency key file ONE payout" |
| A seat is never sold twice; capacity is never exceeded | `UPDATE … WHERE registeredSlots < maxSlots RETURNING` + unique `(tournamentId,userId)` | `tests/integration/join.test.ts`, `independent-squad.test.ts`, `phase18-races` cross-tournament double-spend |
| Entry fee is charged iff a registration exists | Single transaction: seat → debit → registration → audit (`tournament.service.ts:336-470`) | 21-test race file + `verify:join` |
| Prize money follows the paid roster | `rosterUserIds` snapshot, read under the tournament lock | `phase18-races` #4/#5 (with mutation-check proof) |
| Settlement pays to the cent or aborts | Reconciliation gate + no-re-routing abort | `phase18-races` #6 |
| A rejected hold can never later be approved | Terminal-status guard in `reviewWithdrawalOnce` | `phase18-races` #3 |
| Ledger chains and mirrors wallets | `balanceBefore/After` from `RETURNING` | Harness check 5 (`bad=0`, `neg=0`); `verify:wallet` |
| A suspended/banned account is refused even with a live token | Per-request account re-read | `hardening.test.ts:84-136` |
| Database contention is a `409`, never a `500` | `src/lib/tx-conflict.ts` | `tests/unit/tx-conflict.test.ts` (12 tests) + harness |
| Financial history is immutable | Soft deletes everywhere + reversal entries | `admin.service.ts` `deleteUser`/`deleteTournament`, `cancelRegistration` refunds |

---

## 5. How to reproduce the proof

```bash
# 1 — database (embedded PostgreSQL, no Docker needed)
cd backend && npm run db:dev            # :5432, data in ../pgdata
# 2 — schema + seed (fresh shells)
npm run db:generate
node scripts/apply-migrations-offline.mjs && npm run db:migrate
npm run db:seed                         # admin seed is skipped unless SEED_ADMIN_PASSWORD is set
# 3 — API
npm run dev                             # :4000
# 4 — live concurrency proof (repeat it; it is deterministic now)
npm run verify:concurrency              # 12/12, zero 500s
# 5 — the rest of the gates
npx vitest run                          # 252 tests
for v in join wallet results finance security support; do npm run verify:$v; done
npm run verify:seo && npm run verify:pwa     # these two need `cd ../frontend && npm run dev`
npm run audit                           # 0 vulnerabilities
cd ../frontend && npm run lint && npx vitest run && npm run build
```

`scripts/verify-concurrency.mjs` already existed in the base commit but did **not** pass
cleanly there — what changed is the code it exercises (§3.3, §3.4), not the script.
Latest recorded output, five consecutive runs: 

```
✅ 5 concurrent 800-PKR withdrawals from a 1000 balance → exactly one wins — withdrawals=1 debited=800 statuses=201,400,400,400,400
✅ balance never goes negative — balance=200.00
✅ 5 retries with the same idempotency key → ONE withdrawal — rows=1 statuses=201,201,201,201,201
✅ charged exactly once — debited=500.00
✅ sender+receiver conserve money (no minted PKR) — sender=400 receiver=600 statuses=201,400,400,400,400
✅ at most one 600-PKR transfer clears from a 1000 balance — transfers=1 receiver=600
✅ 5 transfer retries with one idempotency key → ONE transfer — transfers=1 recipient=400 statuses=201,201,201,201,201
✅ 8 admins approving the same deposit → approved once — ok=1 statuses=200,409,409,409,409,409,409,409
✅ credited exactly PKR 1000 (no double credit) — credited=1000
✅ every ledger row chains correctly — bad=0
✅ no negative balance anywhere in the ledger — neg=0
🏆 12 passed, 0 failed
```

---

## 6. Master-prompt conformance map

The 96-section master prompt was checked against the tree. Most of it is already implemented and verified above. This is the honest remainder, so the next phases are aimed at real gaps rather than at re-doing settled work.

**Implemented and verified:** auth (rotation, reuse-revoke, email verify, reset, rate limits, bcrypt-12, suspension enforcement) · wallet/ledger with server-side-only amounts · deposits and withdrawals with admin review, holds and refunds · teams (create/invite/accept/remove/leave/captain/disband, size + UID + duplicate guards) · eligibility checks in the join path (`tournament.service.ts:263-315`: verified/complete-profile/UID/region/level/rank/ban) · UID uniqueness (`schema.prisma:384` `freeFireUID String? @unique`) with admin review tooling · slot allocation, independent-squad auto-pairing, capacity, seats, refunds on cancellation · match engine with room credentials released only after `credentialsReleaseAt` (`schema.prisma` `Match`) · results workflow `DRAFT→UNDER_REVIEW→CONFIRMED→PUBLISHED` with evidence uploads and an immutable correction trail · configurable scoring (`pointsPerKill`, `placementPoints`, `bonusPoints`, `penaltyPoints`) — never hard-coded — with deterministic tie-breakers (`totalPoints → wins → kills → username`, `public.service.ts:298` — never row order) · prize pool / platform fee / payout maths separated in `tournament-economics.service.ts` · disputes (`Dispute` model, types, statuses, admin resolution) · fraud detection that **reports and never moves money** · notifications incl. match reminders with de-dupe stamps · scheduler with an index-backed due query and restart reconciliation · admin panel (users, teams, tournaments, matches, results, deposits, withdrawals, finance, fraud, support, audit logs, settings, ads, payment accounts, blog) · RBAC · audit logging · CSV exports · SEO/sitemap/robots · PWA with no financial caching · `verify:*` suites · 252 automated tests.

**Genuine gaps (next phases, in the order that protects money first):**

1. **Tournament state machine is not fully modelled.** `TournamentStatus` is `DRAFT / REGISTRATION_OPEN / LIVE / COMPLETED / CANCELLED`, and the master prompt's `REGISTRATION_CLOSED`, `FULL`, `CHECK_IN`, `PAUSED`, `SUSPENDED`, `RESULTS_PENDING`, `RESULTS_VERIFIED`, `PRIZES_PROCESSING`, `PRIZES_DISTRIBUTED` are today *derived* (from `registrationDeadline`, `registeredSlots >= maxSlots`, `match.resultsStatus`, `resultsPublishedAt`) rather than stored. The derivation is arguably the safer design (no state can drift from its evidence) but it means `canTransition` lives in `admin.service.setTournamentStatus` only — public/other services re-derive their own gates. **Recommendation:** extract one `assertTournamentTransition(from, to, facts)` used by every write path, and expose the derived states as *computed* labels in the API rather than new enum values.
2. **No check-in system.** Nothing in `Match`/`TournamentRegistration` records "I am here". Needs: `checkInOpensAt` / `checkInClosesAt` on the tournament (or match), a `checkedInAt` on the registration, one guarded mutation, a `NO_SHOW` flag, admin visibility, and a notification.
3. **No waitlist.** A full tournament returns `TOURNAMENT_FULL` and drops the intent. Needs a `WaitlistEntry` (position = timestamp order), promotion on refund, an offer window with a configurable timeout, and notifications. Money must only be taken at promotion, inside the same conditional-update pattern.
4. **Clash Squad has no bracket engine.** `CLASH_SQUAD` is today "a 4-player squad scored with battle-royale placement points" (`tournament.service.ts:22-23`, `tournament-economics.service.ts:66`). The master prompt's QF/SF/Final progression, round-win scoring and winner advancement do not exist. Needs its own `ScoringMode` (PLACEMENT_KILL vs CLASH_ROUNDS) and a bracket table, with the placement path untouched for BR events.
5. **Prize split rule is not configurable and there is no pre-distribution preview.** The split is equal-per-member with a last-member remainder absorb; the prompt asks for captain-keeps-all / equal / custom-percentage as an explicit choice, and for an admin preview before money moves.
6. **Admin role granularity.** `Role` is `USER / MODERATOR / ADMIN / SUPER_ADMIN`; `TOURNAMENT_MANAGER` and `FINANCE_MANAGER` do not exist, so "approve deposits" and "cancel a tournament" are currently the same privilege class.
7. **Money is `Decimal(14,2)`, not integer minor units.** Every write goes through `new Prisma.Decimal(...)` + a 2-dp rounding helper, so no float arithmetic touches PKR — but the prompt's "paisa integers" is a stricter model and would remove the rounding helper from the critical path. Migration-shaped, high blast radius; worth a dedicated phase.
8. **No browser-level E2E suite** (Playwright). Current coverage is service-level + HTTP-level, which is where the money invariants live; UI-contract coverage is 18 component/lib tests.

---

## 7. Residual risks / honest caveats

1. **Embedded dev engine ≠ Postgres.** The single-writer dev database surfaces `P2039` and needs a connection budget sized to the burst (see §3.4). Production `pgbouncer`/RDS sizing must be re-checked against the real `max_connections` for the deployed instance count — the pool defaults in `src/lib/prisma.ts` are conservative (20 local / 10 in prod, with `idleTimeoutMillis` shorter than the server's teardown).
2. **`verify:*` scripts mutate the seeded dev DB.** They are dev-only by design and refuse to run without a healthy `/api/health`; they must never be wired into a production release step.
3. **Manual payment proof is still human judgement.** The platform verifies that a `transactionId` is unique and that a screenshot exists; it cannot verify with the payment provider that the transfer happened. That is the residual fraud surface, and it is why deposits/withdrawals are admin-reviewed rather than auto-credited.
4. **`auditLog` is append-only by convention, not by grant.** Nothing in the app updates it, and admin reads are audited; a DB-level `REVOKE UPDATE, DELETE` on the table would close the last gap.
5. **Retried 409s still need a client that shows them.** The backend now answers contention with `409 + code`, and the frontend `api()` surfaces `message` — worth a UX pass on the two money forms to make "already reviewed, reloading" a refresh rather than a dead-end toast.

---

## 8. Files touched in this phase

**Backend, new:** `src/lib/tx-conflict.ts` · `tests/integration/phase18-races.test.ts` · `tests/unit/tx-conflict.test.ts` · `prisma/migrations/20260830120000_roster_snapshot/migration.sql`
**Backend, changed:** `prisma/schema.prisma` · `src/services/result.service.ts` (+123) · `payment.service.ts` (+85) · `tournament.service.ts` (+63) · `admin.service.ts` (+41) · `auth.service.ts` (+68) · `transfer.service.ts` (+22) · `team.service.ts` (+7) · `slot.service.ts` (+10) · `public.service.ts` (+14) · `src/middleware/auth.ts` (+19) · `src/lib/security.ts` (+22) · `scripts/dev-db.mjs` (+7) · `package.json` (override + `audit`/`audit:all` scripts)
**Frontend, changed:** `src/components/ad-card.tsx` (19 lines) — security only · `.env.local` (dev-only, untracked)
**Docs:** this file, `README.md`, `AUDIT_REPORT.md`. Nothing is committed to `main` by this phase; the branch is the unit of review.
