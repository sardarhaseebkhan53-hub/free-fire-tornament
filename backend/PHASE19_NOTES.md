# PHASE 19 — check-in, room-credential delivery, and the gap the live journey found

Date: 30 August 2026. Branch: `arena/01a05152-free-fire-tornament` (follows PR #21, Phase 18).

Phase 18 closed the money paths. Phase 19 closes the two things the certification stage listed
as still missing — a reliable check-in system and push delivery for `MATCH_STARTING` /
`ROOM_CREDENTIALS` — and adds the one real defect the end-to-end journey harness found on a
real PostgreSQL (`backend/scripts/verify-journey.mjs`, `npm run verify:journey`).

Nothing here is mocked. Where a capability cannot be proven from this sandbox it is written
down as unproven instead of green.

---

## 1. What shipped

| Area | Files |
| --- | --- |
| Check-in (window, attendance, no-show, desk view) | `src/services/checkin.service.ts`, `src/validation/tournament.schema.ts`, `src/routes/tournament.routes.ts`, `prisma/migrations/20260831120000_check_in/` |
| Admin: set the window, board, staff check-in, single no-show | `src/validation/admin.schema.ts`, `src/routes/admin.routes.ts`, `src/services/admin.service.ts` |
| Web Push (subscribe/unsubscribe, fan-out, pruning) | `src/lib/push.ts`, `src/routes/push.routes.ts`, `src/validation/push.schema.ts`, `prisma/migrations/20260831130000_push_subscriptions/`, `scripts/push-keys.mjs`, `frontend/src/lib/push.ts`, `frontend/public/sw.js` |
| Boot guard + background tick | `src/lib/env.ts`, `src/index.ts` (30 s tick, never under vitest) |
| **Match participants of a pre-created match** | `src/services/match.service.ts` (`syncTournamentParticipants`), `src/services/tournament.service.ts` (post-join), `src/services/admin.service.ts` (`setMatchStatus`) |
| Player surfaces | `frontend/src/app/(app)/matches/page.tsx`, `frontend/src/components/notifications-bell.tsx`, `frontend/src/components/join-tournament.tsx`, `myRegistrations` in `src/services/tournament.service.ts` |
| Harnesses + tests | `scripts/verify-journey.mjs`, `tests/integration/phase19-{checkin,push,routes,match-participants}.test.ts` |

## 2. Semantics worth knowing before you change any of it

- **The check-in window is derived, unless an admin overrides it.** `resolveCheckInWindow`
  returns `{ opensAt, closesAt, derived, state }` where the derived window is
  `registrationDeadline … startTime`. Explicit `checkInOpensAt` / `checkInClosesAt` win
  outright. `opensAt` is inclusive, `closesAt` is exclusive, and a window whose bounds are
  inverted is reported as `MISCONFIGURED` and refuses every check-in — it is never silently
  repaired. The admin route rejects an inverted window before storing anything.
- **Attendance is one guarded mutation.** `checkIn` is a conditional `updateMany` on
  `checkedInAt IS NULL`, so a double-tap or a replayed request is idempotent (the second call
  answers `alreadyCheckedIn: true`), writes exactly one notification and one audit row, and
  cannot stamp a seat that was cancelled or refunded.
- **A no-show never touches money.** `markNoShows` records `noShowAt`, audits
  `CHECK_IN_NO_SHOW_MARKED`, and writes no ledger row. Refunds remain a *cancellation*
  decision, not an attendance one. The sweep only selects actionable events
  (`REGISTRATION_OPEN`/`LIVE`, a confirmed seat with `checkedInAt IS NULL AND noShowAt IS NULL`,
  resolved shut-off already past), takes 50 per tick, and re-running it changes nothing.
- **Push can never affect a transaction.** Every send happens *after* the committing
  transaction, outside `moneyTx`, and is wrapped so failures cannot propagate. Notification
  rows are the durable record; `push_subscriptions` is a disposable delivery address, upserted
  by `endpoint` and pruned on `404`/`410` or after `PUSH_MAX_FAILURES`. Stored endpoints must be
  `https://`. Without VAPID keys the whole feature is inert — `/api/push/config` answers
  `enabled: false` and nothing is pretended.
- **No new `NotificationType`.** Both pushed events reuse existing types
  (`MATCH_STARTING`, `ROOM_CREDENTIALS`), which is why no `ALTER TYPE … ADD VALUE` (and its
  offline-migration problem) was needed.
- **The push payload is a flat five-key contract shared with `sw.js`**:
  `{ title, body, tag ?? null, url ?? '/matches', data ?? {} }`. Changing it on one side
  breaks delivery silently, so it is pinned from both directions in
  `tests/integration/phase19-push.test.ts`.

## 3. The defect the journey harness found (and what "tested" means here)

Publishing an event through the admin builder with match settings (`matchNumber` defaults to
`1`) inserts the first match **inside the publish transaction — before anybody has
registered**. `createMatch` snapshots participants at creation, so that match has an empty
`match_participants` table forever. Consequences, all of them real: the room table is blank,
a player has nowhere to submit a result, `confirmStandings` refuses to freeze scoring
("No played participants"), and `ROOM_CREDENTIALS` / `MATCH_STARTING` have no recipients.
The API answered 200 to all of it, so only a real end-to-end run surfaced it.

Fix: `syncTournamentParticipants(tournamentId)` (idempotent) is now called after a confirmed
join and when staff open the room (`ROOM_CREATED`/`ROOM_OPEN`/`CREDENTIALS_RELEASED`/`LIVE`),
always after the money work has committed and with failures logged, never thrown — a missing
participant row must not roll back or refuse an entry fee. `tests/integration/
phase19-match-participants.test.ts` pins the gap, the repair, the CONFIRMED-only rule, and
that the join's own charge is unaffected (wallet −100, exactly one `ENTRY_FEE` debit).

## 4. Proof

| Gate | Result |
| --- | --- |
| `npx vitest run` (embedded PG) | see §4.1 — all green, run twice consecutively |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean |
| `npm run audit` / `audit:all` | 0 production vulnerabilities |
| Real-PostgreSQL concurrency (`npm run verify:concurrency`) | unchanged and green after the join-path edit |
| Live journey (`npm run verify:journey`) | 11 stages, ~60 checks against a running API + real PG |
| Frontend `npx tsc --noEmit`, `npx eslint src e2e`, `npx vitest run`, `npx next build` | clean |
| `git diff --check` | clean |

### 4.1 Phase 19 test files

`phase19-checkin` 20 · `phase19-push` 12 · `phase19-routes` 16 · `phase19-match-participants` 6.
The journey harness additionally proves the *HTTP* shape of all of it (forged-token rejection,
staff-only board, admin window endpoints, credentials release, notification rows, audit rows,
ledger conservation across the cohort).

### 4.2 Reproduce the real-database run

```bash
npm run db:real                                   # PostgreSQL 17 on :55433
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/postgres' \
  node scripts/apply-migrations-offline.mjs
npm run db:seed
PORT=4100 npm run dev
npm run verify:journey
```

## 5. Operating push

```bash
npm run push:keys        # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (paste into the deploy)
```

Backend env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, optional `VAPID_SUBJECT`
(default `mailto:admin@localhost`), `PUSH_TTL` (default 3600), `PUSH_MAX_FAILURES`
(default 3). Frontend env: `NEXT_PUBLIC_PUSH_APPLICATION_SERVER_KEY` = the same public key.
`src/lib/env.ts` refuses to boot with a public key and no private key (or the reverse),
because half a VAPID pair is a runtime 500 on every send.

## 6. Not proven here — read this before calling any of it "done"

1. **Browser E2E is collected, not executed.** `frontend/e2e/` (Playwright, 13 tests in 3
   specs) type-checks, lints and `playwright test --list` resolves it, but no browser binary
   is downloadable from this sandbox, so **no spec has actually run in a browser**. Money
   legs are covered by the backend suites and the HTTP journey; UI-contract legs are not yet
   executed evidence. See `frontend/e2e/README.md`.
2. **No third-party push service was contacted.** `phase19-push` sends through the real
   `web-push` library against a locally generated **HTTPS** endpoint (real VAPID-signed PUT,
   real payload encryption), which proves the request path plus the `410`/`404`/non-2xx/
   transport-error handling and the pruning rules. What is not proven is FCM / Mozilla
   autopush accepting the message and a physical device displaying it — confirm that in
   staging before announcing push to players.
3. **Production deployment items** (managed Postgres sizing, `REVOKE UPDATE, DELETE` on
   `audit_logs`, TLS termination for the push endpoint host) remain with the deploy, as in
   `PHASE18_CERTIFICATION.md` §5.
4. The dev database on `:5432` is **not** migrated — the two Phase 19 migrations were applied
   to `:55433` and auto-applied to the embedded engine. Run `npm run db:migrate` against any
   database you intend to use interactively.
