# CLUTCHNEX — Full Project Audit & Implementation Checklist

> Session: `arena/01a04c2a-free-fire-tornament` · Audit date: 2026-08-29
> Scope: complete codebase read-through (backend, Prisma, frontend, PWA, admin),
> live-site sanity check (API healthy via `/api/backend/health`), and a fresh
> baseline build/typecheck of both workspaces.

---

## 1. What exists today (verified working)

### Stack (locked, do not replace)
- **Frontend**: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4
  · Framer Motion available · Lucide icons · self-hosted fonts (Inter + Space Grotesk).
- **Backend**: Node 22 · Express 5 · TypeScript · modular routes/services/middleware.
- **DB**: PostgreSQL via Prisma 7 (dev fallback: embedded PGlite — `npm run db:dev`).
- **Auth**: JWT access + rotating HttpOnly refresh cookie (proxied through
  `/api/backend/*`), bcrypt, RBAC (USER / MODERATOR / ADMIN / SUPER_ADMIN),
  CSRF marker header, rate limits, security headers.
- **Design system**: obsidian `#070A14` + neon violet `#8B5CF6`, glassmorphism,
  locked in `globals.css` (documented as APPROVED & LOCKED in README).
- **Deployment**: Railway (api + web), Neon DB, PWA-first, no Docker/Flutter.

### Backend features confirmed in code
| Area | State |
|---|---|
| Auth (register/login/refresh/logout/verify/forgot/change-password, `/auth/me`) | ✅ |
| Solo / Duo / Squad / Clash Squad join engine (single transaction, race-safe seat via `UPDATE … RETURNING`, unique `(tournamentId,userId)`) | ✅ |
| **Solo join = no team required** (`teamSize=1` path never reads `/teams/my` in the shared client; server never demands a team for SOLO) | ✅ |
| Coupons (percentage/fixed, caps, per-user limits, redemption lock) | ✅ |
| Cancellation + per-tournament refund % (player + admin cancellation flow) | ✅ |
| Teams (create/invite-by-username/accept/decline/remove/leave/transfer captaincy; DUO+SQUAD) | ✅ partial — no team *code* or invite *link* |
| Matches (schedule, map, round, auto room-id/password, timed credential release, participant sync) | ✅ |
| My Matches (credentials only after release, slot number, my result + submission state) | ✅ |
| Player result submission + staff verification (approve/reject/disqualify, screenshot proof) | ✅ |
| Idempotent prize distribution (placement + capped kill pool + MVP → immutable ledger → WINNING balance → PlayerStat) | ✅ |
| Wallet ledger (CASH/COINS/WINNING/BONUS buckets, every tx has before/after; player UI shows one PKR balance) | ✅ |
| Manual deposits (proof upload, screenshot hash dedupe, admin approve→credit / reject) | ✅ |
| Withdrawals (PENDING→APPROVED→PROCESSING→PAID, reject reversal) | ✅ |
| User-to-user transfers (single tx debit+credit, idempotent `requestId`, limits, audit) | ✅ |
| Referrals, notifications, support tickets + disputes, fraud alerts, expenses, settings | ✅ |
| Admin: dashboard KPIs, revenue, finance P&L + CSV, users (+ban/suspend/adjust balance), tournament builder with economic-safety check, payments review, payment accounts CRUD, support, blog, ads CRUD, SEO config, settings, audit logs, transfers | ✅ |
| Leaderboard (all-time from PlayerStat; weekly/monthly via lastPlayedAt window), rank tiers, public player profile | ✅ |
| SEO: metadata + OG + Twitter, sitemap.xml, robots.txt, per-page overrides | ✅ |
| PWA: manifest.webmanifest, icons (192/512/maskable/apple), SW (network-first navigations, cache-first static, `/api` never cached), install prompt + iOS A2HS path | ✅ |
| WhatsApp: floating FAB + support center/help card, separate support vs community numbers | ✅ |
| NEXA chatbot: intents for register/join/modes/teams/seats/payments/transfers/refunds/schedule/prizes/referral/account/contact + sensitive-issue guardrails | ✅ |

### Frontend surfaces confirmed
Public: home, tournaments list + solo/duo/squad/clash-squad mode pages, tournament
details (economics, prizes, schedule, participant seat pills, join flow), winners,
leaderboard, blog, legal pages, support, login/register/verify, player profile.
Player (app shell + bottom nav): dashboard, matches, teams, wallet (add-money,
payment, transactions, transfer, withdraw), support tickets.
Admin: dashboard, users, tournaments (+builder), matches, results, deposits,
payment accounts, withdrawals, transfers, finance, revenue, support, blog, ads,
SEO, fraud, settings, audit logs — responsive sidebar/drawer.
Shared: TournamentImage (shimmer → fallback, never a broken icon), Countdown,
skeletons on list pages, glass cards, status pills, responsive tables.

---

## 2. Verified gaps vs. your spec (ordered by priority)

### P0 — Admin Match/Slot/Result control (the core missing feature set)
1. **No admin match-result table.** Admin "Matches" is a bare list
   (schedule + status). There is no slot/player/UID/team/status/position/
   kills/points/prize table, no search/filter/sort, no per-row actions.
2. **No admin result editor.** Results page only verifies *player-submitted*
   claims (placement + kills override). Missing: direct admin entry of
   Position / Kills / Bonus / Penalty / Final Score / Prize for every
   participant, Save Draft / Save Result / Reset / Disqualify, and a
   **Draft → Review → Confirm → Calculate → Publish** workflow.
3. **No slot control.** No API/UI to assign/move/remove/lock a slot, mark
   ready/absent, or replace a player. `seatNumber` exists but only changes on
   join/cancel; admin cannot edit it.
4. **Scoring hard-coded.** `PLACEMENT_POINTS = [12,9,8,7,6,5,4,3,2,1]` lives in
   `result.service.ts` (and is duplicated in the admin UI with `perKill = 1`
   preview). `pointsPerKill` is configurable; **placement table, bonus,
   penalty and final-score formula are not**. `MatchParticipant` has no
   `bonus` / `penalty` / `finalScore` / `prize` / `notes` / `ready` columns.
5. **Match statuses incomplete for the room lifecycle** (SCHEDULED /
   CREDENTIALS_RELEASED / LIVE / COMPLETED / CANCELLED only; no
   ROOM_CREATED / ROOM_OPEN / UPCOMING naming) and **no `notes` field** or
   result-publish state on `Match`. `createMatch` is also not audited.
6. **No leaderboard admin controls** (edit score/kills/wins, add/remove
   penalty, recalculate, publish/unpublish). Leaderboard changes can only
   happen indirectly through result verification.
7. **No Winners admin screen** and no explicit "PUBLISH RESULTS" gate before
   winners are publicly shown (`distribute-prizes` flips everything at once
   and marks the tournament COMPLETED).
8. **No Teams / Reports admin sections** (revenue + finance dashboards exist;
   teams are player-only; no reports listing).

### P1 — Functional gaps / bugs to fix
9. **Admin 401 risk remains.** `useAdminList` (admin kit) and many admin pages
   use a raw `fetch('/api/backend/...', {authorization: Bearer …})` with **no
   transparent refresh**, so a >15-min-old admin session surfaces raw 401s.
   Player flow was already migrated to `client-api` (refresh-once), admin was not.
10. **Ads admin CRUD exists but nothing renders ads** on the site.
11. **Duo "independent registration + admin pairing" alternative** is not
    implemented (teams-only DUO). Solo join also does not *confirm* FF UID /
    nickname at registration time (profile-only today, email verification is
    required instead).
12. **Squad invites are username-only** — no team code / shareable registration
    link (requirement §8).
13. **48-slot public board is a pill wrap**, not a professional slot board;
    no ready/payment state (public view deliberately hides UID — correct);
    admin has no board at all.
14. **No per-match evidence upload from admin** (player proof exists via
    `ResultSubmission.screenshot`; admin has no evidence column/history).
15. **Mobile tables** exist with horizontal scroll; some admin tables are not
    card-ified on small screens (acceptable, but flagged for the approved UI).
16. Live data hygiene only (not code): a few cancelled test tournaments
    ("Solo PC ban") exist on the live DB — clean-up list, not code.

### Verified NOT broken (so we won't touch)
- Single PKR wallet, immutable ledger, manual payment verification, transfers,
  refunds, race-safe seat allocation, credential release timing, PWA manifest/SW,
  image fallback pipeline, sitemap/robots, NEXA guardrails, RBAC + CSRF + limits.

---

## 3. Database work needed (after UI approval — safe, additive migrations)

1. `MatchParticipant`: add `bonus Int?`, `penalty Int?`, `finalScore Int?`,
   `prizeAmount Decimal(14,2)?`, `notes String?`, `readyAt DateTime?`,
   `absent Boolean @default(false)`, `evidenceUrl String?`.
2. `Match`: add `notes String?`, `resultsPublishedAt DateTime?`,
   `resultsStatus MatchResultStatus @default(DRAFT)` (new enum
   `DRAFT / UNDER_REVIEW / CONFIRMED / PUBLISHED`), maybe `roomCreatedAt`.
3. `MatchStatus`: extend enum with `UPCOMING`, `ROOM_CREATED`, `ROOM_OPEN`
   (keep existing values for compatibility; map `CREDENTIALS_RELEASED` → shown
   as ROOM OPEN in UI).
4. `Tournament`: add `placementPoints Json?` (per-position table, e.g.
   `[12,9,8,7,6,5,4,3,2,1]`), `bonusPerMatch Decimal?`, `penaltyRules Json?`,
   `resultsPublished Boolean @default(false)` (or rely on Match status), and
   optional `roomId/roomPassword` defaults + `matchNumber` label.
5. `SeatLock`/slot control: add `slotLocked Boolean @default(false)` +
   `slotNote String?` on `TournamentRegistration`; admin slot changes create
   `AuditLog` rows (no new table required) and can reuse `seatNumber`.
6. Optional `TeamJoinCode String? @unique` on `Team` for join links.
7. New enums are additive; no destructive changes. One migration, then
   `prisma generate`, then verify scripts + tests.

---

## 4. API work needed (after UI approval)

- `GET /admin/matches/:id/table` — participants joined with
  registrations (seat, reg id, payment, ready), user profile (UID/IGN),
  team, current result fields.
- `PUT /admin/matches/:id/participants/:pid` — position/kills/bonus/penalty/
  final score/prize/status/ready/absent/notes/slot; recalculates score
  server-side from the tournament's placement table; audits before/after.
- `POST /admin/matches/:id/results/publish` — controlled workflow
  (DRAFT → CONFIRM → PUBLISH); public results stay hidden until PUBLISHED.
- `POST|GET /admin/tournaments/:id/slots` + `PUT /admin/slots/:regId` —
  assign/move/remove/lock/unlock slot; audited; race-safe via the same
  conditional-UPDATE pattern.
- `POST /admin/leaderboard/recalculate` + `POST /admin/leaderboard/:userId/points`
  (add/remove penalty, audit, never touch financial entries).
- `GET /admin/winners` + `POST /admin/tournaments/:id/winners/publish`.
- `GET /admin/teams`, `GET /admin/reports` (fills missing nav sections).
- `GET /admin/matches/:id/export` (CSV) + bulk actions.
- Admin route mutations must also write `AuditLog` (today `createMatch` is
  not audited).

---

## 5. UI work needed (mockups generated this session, awaiting approval)

New/changed screens (concepts follow the locked obsidian/violet design system):
1. Admin Match Management — room-style table (slot, player/team, FF name, UID,
   reg id, payment, ready, position, kills, points, final score, prize, status,
   actions) + search/filter/sort/export/bulk.
2. Admin Slot Management — visual 48-slot board; click slot → drawer with
   change player, move slot, ready/absent/DQ, payment, match history.
3. Admin Result Entry — editor modal/page with Save Draft / Save Result /
   Reset / Disqualify + publish confirmation.
4. Public 48-slot board on tournament details (name-first, no UID).
5. Admin Winners + Leaderboard management; Teams; Reports.
Existing screens (home, listing, details, wallet, dashboard, support, etc.)
stay on the already-approved locked design — mockups included for review only.

---

## 6. Baseline verification (this session)

- `npm ci` backend + frontend: clean.
- Backend `npm run db:generate` + `tsc --noEmit`: running/verified above.
- Frontend `next build`: running/verified above.
- Live API health via `/api/backend/health`: `{"status":"ok"}` ✅
- Live homepage renders with the locked design; images resolve from `/art/*` ✅

---

## 7. Exact commands

```bash
# Backend (Terminal 1)
cd backend
npm ci
npm run db:dev            # embedded PGlite (no external DB needed for dev)
npm run dev               # API on :4000

# Frontend (Terminal 2)
cd frontend
npm ci
npm run dev               # app on :3000

# Verification
cd backend && npm run typecheck && npm test
cd backend && npm run verify:join && npm run verify:wallet && npm run verify:results \
  && npm run verify:finance && npm run verify:support && npm run verify:seo \
  && npm run verify:pwa && npm run verify:security
cd frontend && npm run build && npm test
```

---

## 8. Next step (per the mandated workflow)

1. ✅ Audit (this doc)
2. ✅ Problems identified (sections 2–4)
3. ✅ UI mockups generated (see `mockups/`)
4. ⏳ **WAITING FOR YOUR APPROVAL** before any implementation
5. Then implement approved UI → fix functionality → test → report.
