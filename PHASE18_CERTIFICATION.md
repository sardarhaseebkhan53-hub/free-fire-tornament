# PHASE 18 — FINAL CERTIFICATION (real PostgreSQL + full tournament lifecycle)

Branch `arena/01a05152-free-fire-tornament` · PR #21 · continues `PHASE18_SECURITY.md`
(§1–§8). This file is the **certification stage**: nothing was built to make the
platform bigger, everything here either verifies an existing guarantee or fixes a
defect the verification exposed.

---

## 1. Verdict

| Gate | Result |
|---|---|
| Backend `tsc --noEmit` | ✅ 0 errors |
| Backend `npx vitest run` | ✅ **279 / 279** (21 files), incl. the 8-test certification suite |
| **Real PostgreSQL 17.10** (multi-process, `fsync=on`, `synchronous_commit=on`) | ✅ `verify:concurrency` **19/19 × 3 consecutive runs** |
| Same real-DB target: `verify:join` / `wallet` / `results` / `finance` / `security` / `support` | ✅ all green, twice (the join engine now also asserts "charged once, one seat, capacity not over-counted") |
| Double-click on a real backend (8 forced rounds) | ✅ before the fix **8/8 charged twice**; after the fix **8/8 clean** — one 201, one 409, one row, one fee, `registeredSlots=1` |
| 100 simultaneous "Distribute Prize" requests | ✅ exactly **1** settlement, 1 winner row, 2 credits totalling the prize, `COMPLETED`, 1 audit row |
| Reconciliation after the lifecycle | ✅ every wallet == Σcredits − Σdebits; **0 discrepancies** |
| Frontend `npm run lint` / `npx vitest run` / `npm run build` | ✅ 0 errors 0 warnings · 18/18 · build OK |
| `npm audit --omit=dev` (both packages) | ✅ 0 |
| `git diff --check` | ✅ clean |

**One real production bug was found at this stage and fixed** (§2). That is the whole
point of the certification stage.

---

## 2. The finding: a double-charge that only a real PostgreSQL could show

Reproduced 6/6 rounds before the fix, on `verify:join` against real PG — two parallel
`POST /api/tournaments/join` for the **same player, same tournament**:

```
round 1 | A 201 seat 1 | B 201 seat 2 | rows [{seatNumber:2,status:CONFIRMED}] | slots 2 | fees 2
round 2 | A 201 seat 1 | B 201 seat 2 | rows [{seatNumber:2,status:CONFIRMED}] | slots 2 | fees 2
...
```

One registration row. **Two `ENTRY_FEE` debits.** `registeredSlots` burned a phantom
seat, so the event sold 9 seats while counting 10. And the second request's upsert
**re-seated the first player's row** — the entry the winner already paid for moved to
seat 2, orphaning the first ledger row's link to a seat.

**Root cause (a check-then-act window, not a missing lock).** `runJoin` inside
`moneyTx` did:

1. *"am I already registered?"* — a plain read, **no lock held yet**;
2. `UPDATE tournaments SET registeredSlots = registeredSlots + 1 … RETURNING` — this
   takes the tournament row lock;
3. scan for the smallest free seat, charge, upsert the registration.

Under READ COMMITTED with real backends, tab B evaluated (1) before tab A committed,
so it passed; it then blocked at (2), resumed with A's row visible, picked seat 2,
charged again, and its upsert overwrote A's row. The dev engine is single-writer, so
step (1) always saw the committed row and answered `ALREADY_REGISTERED` — the window
is unreachable there, which is exactly why 271 green tests had not caught it.

**The fix** (`src/services/tournament.service.ts`, targeted and additive):

* the transaction now takes `SELECT … FROM "tournaments" FOR UPDATE` **before** it reads
  or decides anything, so the guard, the capacity claim and the seat scan are one
  critical section (lock order tournament → team, matching every other path — no
  inversion, no new contention: the seat UPDATE already held that lock to commit);
* the registration is **created, or revived from its own non-`CONFIRMED` row** — never
  overwritten. A `P2002` on the create becomes a clean `ALREADY_REGISTERED`, and a
  revive that loses its status race (`updateMany(… status: { not: 'CONFIRMED' })` with
  `count === 0`) likewise;
* the cancel → re-join behaviour the upsert existed for is preserved (certified by
  §A test 3: the row is revived once, at a fresh charge, never duplicated).

**After the fix, 8/8 rounds clean on real PG**, and the surge's 90 refusals are
`TOURNAMENT_FULL` with **zero 500s and zero 503s** — with a real multi-process server
there is no queue to saturate, which also settles the "double-blip" caveat in
`PHASE18_SECURITY.md` §5.1: that was the dev engine, not the application.

---

## 3. Reproducing this stage (real PostgreSQL, 60 seconds)

```bash
cd backend
npm i -D embedded-postgres                      # real PG 17 binaries, dev-only
npm run db:real &                               # 127.0.0.1:55433, fsync ON, 200 connections
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55433/postgres?connection_limit=20"
npm run db:migrate && npm run db:seed           # same migrations, same seed as any deploy
PORT=4100 npm run dev &                         # the API against the real server
CONCURRENCY_API_URL=http://localhost:4100/api \
CONCURRENCY_DB_URL=postgresql://postgres:postgres@127.0.0.1:55433/postgres \
  npm run verify:concurrency                    # 19/19 including the 100-way surge
API_URL=http://localhost:4100/api npm run verify:join      # + wallet, results, finance, security, support
```

`scripts/real-db.mjs` is checked in (devDependency only — it never enters the
production image). `verify-concurrency.mjs` gained `CONCURRENCY_API_URL` /
`CONCURRENCY_DB_URL` / `CONCURRENCY_JWT_SECRET` overrides so the *same* proofs run
against any target; defaults still point at `npm run db:dev` on :4000.
`verify:support` is now re-runnable against a persistent database (it cleans its
fixtures before as well as after, so an aborted run cannot poison the next one).

---

## 4. The seven certification items

| # | Ask | Status | Where |
|---|---|---|---|
| 1 | 100 concurrent users → real PostgreSQL → real pool → real API (registration, wallet, slots, deposits, withdrawals, prize distribution) | ✅ **done** — surge 19/19 ×3 plus all six `verify:*` suites green on PG 17.10 | §3 above |
| 2 | One tournament end to end (create → squad → register → charge → slot → confirm → credentials → match → results → verify → leaderboard → prize → credit → ledger → withdrawal) | 🟡 **certified as a lifecycle test, with two honest absences** | `tests/integration/phase18-certification.test.ts` §C runs deposit → team → paid registration → seat → match → submitted/approved/published result → prize settlement → wallet credit → withdrawal (reject + approve) → reconciliation, in one test. Absent from the platform, so absent from the chain: **check-in** (no `checkedInAt` anywhere — gap §2 in `PHASE18_SECURITY.md` §6) and a *browser*-level E2E (gap §8). Room-code release timing is covered by `verify:results` and `tests/integration/results-admin.test.ts`. |
| 3 | Failure paths: payment succeeds + registration fails · registration succeeds + client times out · double-click · two captains one slot · two admins one deposit · two admins distribute · cancel during joins · suspension during registration · DB temporarily unavailable · timeout after commit | ✅ all ten have a test | double-click, re-seat refusal, revive-once → §A; two admins/one deposit, two reviewers, approval-vs-rejection → `phase18-races.test.ts`; one slot for two captains → `verify:join` + `tests/integration/join.test.ts`; distribute ×100 → §D; cancel during joins → §E; suspension mid-session → `phase18-races.test.ts`; DB unavailable / timeout-after-commit → `503 SERVICE_BUSY + Retry-After` + idempotency-key replay (`tests/unit/tx-conflict.test.ts`, `verify:concurrency` idempotency checks); "succeeds + client times out" → the idempotency replay path is what makes that safe (`readAfterUniqueViolation`) |
| 4 | Historical roster integrity: D leaves the team after a paid registration → the entry must still show A B C D | ✅ **certified, and enforced** | roster frozen at `TournamentRegistration.rosterUserIds` under the seat lock (§3.2 of the security report); `distributePrizes` pays from the snapshot, never from live membership (`result.service.ts:469-492`). §B deletes a `teamMember` row *directly*, bypassing every guard, and asserts the removed member is still paid and the winner set is still 2 people. The guards themselves are certified too: `leaveTeam`/`removeMember` refuse with "Roster is locked" while an entry is live (§B test 2). |
| 5 | 100 simultaneous "Distribute Prize" requests → 1 payout, and wallet + ledger + tournament status + audit log agree | ✅ **done** | §D (100 in-flight requests, 3 distinct admins). Exactly 1 fulfilled; 99 refused with a non-5xx code; `Winner` rows 1; `WINNING` credits 2 = 800 PKR total; `tournament.status = COMPLETED`; `auditLog` `PRIZES_DISTRIBUTED` count 1; both ledgers chain consistently |
| 6 | Reconciliation for every wallet after the whole lifecycle — and as a permanent automated test | ✅ **done, permanent** | §C asserts (a) per-user `ledgerIsConsistent` (running-balance chain, no negative step, wallet mirrors ledger), (b) the auditor's query — `Σ(cash+winning+coins+bonus)` over the participants equals `Σ(CREDIT) − Σ(DEBIT)` over their ledger rows, to the paisa, (c) zero rows with `balanceAfter < 0`, (d) the lifecycle's arithmetic (1000 in, 200 fees out, 800 prizes, 300 withdrawn ⇒ 1300 held). Opening balances are zero and all funding arrives as approved deposits, so this is a real audit rather than a tautology |
| 7 | Production deployment test (real env vars, HTTPS, domains, CORS, cookies, refresh, scheduler, payment provider, pool) | 🔴 **cannot be done from this sandbox** — checklist prepared | What IS verified here: the env gate that refuses to boot on a placeholder secret or a localhost DB in production (`src/lib/env.ts`), CORS/cookie/refresh semantics in `tests/integration/auth.test.ts` + `hardening.test.ts`, scheduler reconciliation in `verify:results`, pool/`connection_limit` behaviour under a 100-way surge (§3). What needs the real target: TLS termination + `CLIENT_ORIGIN`/`PUBLIC_URL` match, secure-cookie behaviour over HTTPS, the payment provider's own sandbox credentials, managed-Postgres `max_connections` vs instance count, cron ownership. `DEPLOYMENT.md` is the runbook; treat §6 below as its acceptance list |

---

## 5. Notification delivery while the site is closed — answer and finding

Asked directly: *"if the website is off, does a notification come when an update
comes?"*

**No — not today.** Verified at the source:

* `frontend/public/sw.js` (88 lines) registers `install`, `activate` and `fetch`
  handlers only. **There is no `push` event listener**, so nothing can wake a closed
  tab;
* `PushManager.subscribe` appears nowhere in `frontend/src`, so the browser is never
  asked for permission and no endpoint is ever captured;
* there is no `web-push` dependency, no VAPID key configuration, and no
  `PushSubscription`-shaped table in `prisma/schema.prisma`;
* the delivery model is an **in-app inbox**: `Notification` rows plus a bell that polls
  `unreadCount` every 30 s (15 s in the admin shell) — i.e. only while a component is
  mounted in an open tab (`frontend/src/components/notifications-bell.tsx:93`);
* email exists only for verification and password reset (`EMAIL_PROVIDER` defaults to
  `log`); tournament updates are never emailed.

So: an update (result published, deposit approved, prize credited, match starting) is
**recorded reliably and durably**, and reaches the player the moment they next open the
app — but nothing reaches a player whose browser is closed. For an esports platform the
time-critical ones are `MATCH_STARTING` and `ROOM_CREDENTIALS`, which is why this is
worth a decision rather than a footnote.

The smallest honest implementation, if wanted (a feature, not a defect fix — which is
why it is *not* included in this certification commit):

1. `web-push` + one VAPID keypair in env (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`,
   generated once, never committed);
2. `PushSubscription { id, userId, endpoint @unique, p256dh, auth, userAgent,
   createdAt, lastSeenAt }` — an additive migration, and a `POST /api/push/subscribe`
   + `DELETE` pair, per-device rows (a player has a phone *and* a laptop);
3. send at the point the `Notification` row is created, **outside** the money
   transaction (fire-and-forget with a bounded retry, the way `fraud`/`audit` already
   behave): a push failure must never roll back a paid seat;
4. `sw.js` gains `self.addEventListener('push', …)` → `showNotification` with the
   existing `data.slug` deep link, plus a `notificationclick` handler;
5. unsubscribe on `PushSubscriptionChange`/expiry (`410 Gone` ⇒ delete the row), or
   the platform accumulates dead endpoints and looks abusive to the push services;
6. an admin setting to disable push per event type, and the PWA cache rule that keeps
   financial responses uncached stays untouched.

**Nothing in the money path changes**, so this does not affect the certification above.

---

## 6. Production-deployment acceptance list (for whoever runs item 7 on the real target)

- [ ] `NODE_ENV=production`, real `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (the boot gate
      refuses placeholders — do not "fix" it by weakening it)
- [ ] `CLIENT_ORIGIN` exactly equals the frontend origin (CORS + cookie `sameSite`),
      `PUBLIC_URL` = the API origin, both behind TLS
- [ ] `DATABASE_URL` = the **pooled** endpoint (host contains `-pooler` when using Neon),
      `DIRECT_URL` = unpooled for migrations; `connection_limit` × instance count ≤ ~80 %
      of server `max_connections`
- [ ] migrations applied by `prisma migrate deploy` (the real CLI, checksums verified —
      the offline applier is a sandbox fallback, not a deploy step)
- [ ] seed an admin with `SEED_ADMIN_PASSWORD` once, then confirm the seed scripts are
      inert on a populated database
- [ ] scheduler owns its cron on exactly one instance (double-run = double reminders)
- [ ] payment provider credentials in the provider's sandbox, one manual deposit walked
      end to end, including a rejected one, and the `transactionId` uniqueness seen in
      the admin queue
- [ ] `uploads/` on persistent storage, `MAX_UPLOAD_MB` set, and `/uploads` served with
      the same auth rules as before
- [ ] one real 100-way surge against the deployed stack (`CONCURRENCY_API_URL=…
      npm run verify:concurrency`) — the runbook already documents it as a *dev* tool; on
      a production target use a staging copy, never live money
- [ ] audit trail: `PRIZES_DISTRIBUTED`, `TOURNAMENT_JOIN_REJECTED`, deposit/withdrawal
      reviews all visible in the admin audit view for that run

---

## 7. Deliberate non-goals of this stage

No UI redesign (the design is not the problem). No new money feature. No waitlist (see
below). No schema change. No push notifications (a product decision — §5).

### Waitlist — the wording for the product spec

> **Waitlist is currently intentionally unsupported.** A tournament that reaches
> `maxSlots` refuses further joins with `TOURNAMENT_FULL`; there is no queue, no offer
> window and no automatic promotion on cancellation. This is a product decision, not a
> defect: the seat claim is a single conditional `UPDATE`, and a waitlist must take
> money only at promotion, inside the same pattern — so it needs its own design pass
> rather than an increment.

Matching status in this repo: `PHASE18_SECURITY.md` §6 gap 3 (implementation sketch),
no `WAITLIST` status anywhere in `backend/src`.
