# CLUTCHNEX — Free Fire Tournament Platform

**COMPETE. CLUTCH. CONQUER.**

CLUTCHNEX is a premium, production-grade Free Fire esports platform for Pakistan:
tournaments (Solo / Duo / Squad / Clash Squad), teams, matches with timed
room-credential release, an immutable wallet ledger, manual payment
verification (JazzCash / EasyPaisa / bank transfer), prize distribution,
referrals, leaderboards, support, SEO, PWA and a full admin control center.

- 🎨 **UI design: APPROVED & LOCKED** — 43 concept screens in [`design/`](design/)
  plus the design system spec [`design/DESIGN_SYSTEM_DRAFT.md`](design/DESIGN_SYSTEM_DRAFT.md).
  All UI implements this design; no redesigns without explicit approval.
- 🔧 **API-first backend** — the same REST API will serve the web app today and a
  future Flutter Android/iOS app without changes.
- 🌐 **Web + PWA first** — no Docker, no Flutter in this version.

---

## Technology stack (approved & locked)

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Framer Motion · Lucide icons |
| Backend | Node.js · Express 5 · TypeScript · modular routes/services/middleware/validation |
| Database | PostgreSQL via Prisma 7 (dev: embedded PGlite — `npm run db:dev`, no install) |
| Auth | JWT access tokens + rotating HttpOnly refresh cookies, bcrypt, RBAC |
| Validation | Zod everywhere — the server never trusts frontend financial values |
| Currency | PKR default, admin-configurable |

---

## Progress — 11 of 17 phases complete

| # | Phase | Status |
|---|---|---|
| 0 | UI design gate (43 screens + design system) | ✅ Approved & locked |
| 1 | Project setup & scaffolding | ✅ Done (merged, PR #1) |
| 2 | Database | ✅ Done |
| 3 | Authentication | ✅ Done |
| 4 | Public website + public API + financial engine | ✅ Done |
| 5 | Tournament engine | ✅ Done |
| 6 | Teams & matches | ✅ Done |
| 7 | Wallet & manual payments | ✅ Done |
| 8 | Results & prize distribution | ✅ Done |
| 9 | Admin panel | ✅ Done |
| 10 | Financial dashboard | ✅ Done |
| 11 | Support + WhatsApp + NEXA chatbot | ⬜ Next |
| 12 | SEO + Blog CMS | ⬜ |
| 13 | PWA | ⬜ |
| 14 | Security hardening | ⬜ |
| 15 | Testing | ⬜ |
| 16 | Deployment | ⬜ |

All completed work lives in **[PR #2](https://github.com/sardarhaseebkhan53-hub/free-fire-tornament/pull/2)**
(one commit per phase, each independently verified).

---

## Phase details

### ✅ Phase 0 — UI design gate
42 approved concept screens (public site, user dashboard, admin panel, mobile/PWA)
and the locked design system: obsidian/deep-navy base, electric-violet accent,
glassmorphism panels, Space Grotesk + Inter, 16px card radius, breakpoints from
320px to 1920px with a deliberately designed mobile experience.

### ✅ Phase 1 — Setup
Express 5 + TypeScript backend scaffold, Next.js + TypeScript + Tailwind frontend
scaffold, embedded PostgreSQL dev script (no Docker), environment templates.

### ✅ Phase 2 — Database
- **34 models / 34 enums**: users + profiles, auth tokens, wallet (4 buckets) with an
  **immutable ledger** (`balanceBefore/balanceAfter` on every movement), deposits,
  withdrawals, tournaments, registrations, teams + invites, matches, participants,
  result submissions, prizes, winners, referrals, coupons, tickets, disputes,
  notifications, blog, static/legal pages, FAQs, settings, payment accounts, ads,
  SEO configs, player stats, audit logs, fraud alerts, expenses.
- Indexes and unique constraints that encode business rules (one entry per user per
  tournament, unique deposit TIDs, unique team tags…).
- Initial migration verified on PostgreSQL 17.5 & 18.3 with **zero drift** vs the
  generated client; all enum memberships exact.
- Realistic PKR seed: 15 users, 7 tournaments in every lifecycle state, 5 teams,
  matches with verified results, winners with credited prizes, deposits/withdrawals
  in every review state, coupons, referrals, tickets, blog, legal pages.
- **Audited invariants:** 0 ledger-chain violations, 0 negative balances, wallet
  mirrors match ledger finals, no duplicate TIDs, no double registrations.

### ✅ Phase 3 — Authentication
Register (username/email/phone/FF UID uniqueness + referral link), login by email or
username, JWT access (15m) + **rotating single-use refresh cookies** (reuse blocked),
logout, email verification (grants the configurable welcome bonus via the ledger),
resend verification, forgot/reset password (revokes all sessions), change password,
per-email lockout (settings-driven), route rate limits, RBAC middleware
(`USER < MODERATOR < ADMIN < SUPER_ADMIN`), machine-readable error codes.
**Verified:** 14-step live smoke suite.

### ✅ Phase 4 — Public website, public API & financial engine
- **Public API** (`/api/public/*`): tournaments (filters/search/paging), details with
  transparent economics, home stats, leaderboard (all/weekly/monthly), winners, blog,
  legal pages, FAQs, whitelisted settings, public player profiles (privacy-respecting).
- **Financial engine**: the 9-tier master pricing table (Solo Starter/Standard/Elite,
  Duo Standard/Elite, Squad Standard/Elite, Clash Standard/Elite) seeded as
  admin-editable settings; prize kinds `PLACEMENT | KILL_POOL | MVP | BONUS` with
  per-kill rates and **mandatory kill caps**; server-side profit calculator;
  economic-safety gate (projected losses require explicit confirmation);
  `Expense` model for gross-vs-net accounting.
- **Next.js public site** on the locked design: Home (hero, live indicator, stats,
  featured tournaments, modes, how-it-works, trust cards, leaderboard preview,
  winners, referral, PWA note, FAQ, WhatsApp), tournament listing + details,
  leaderboard, winners wall, blog + articles, support center, legal pages, player
  profiles, login/register, dashboard & wallet pages — all live API data.
- **Verified:** all 9 tiers reproduce the master table to the rupee; uncapped kill
  pools rejected; 20-route render suite; zero credential leakage; `next build` clean.

### ✅ Phase 5 — Tournament engine
- **Race-safe join** in one DB transaction: account/status/deadline checks →
  **atomic slot guard** (conditional UPDATE — cannot oversell under concurrency) →
  coupon validation with concurrency-safe usage increments → ledger debit(s) →
  registrations, notifications, audit. The unique `(tournament, user)` index is the
  final double-join defense. Entry fees are never accepted from clients.
- **Team joins**: the captain registers the full squad/duo; every member pays their
  own share; any insufficient balance rolls back everything; type/size enforced;
  non-captains refused.
- **Coupons**: percentage (with cap) and fixed, expiry/usage/per-user limits,
  mode restrictions, single redemption per user; preview endpoint before paying.
- **Cancellation**: player cancel refunds per the tournament's refund percentage and
  frees the slot (captain cancels the whole team in team modes); admin cancel service
  refunds everyone with full audit.
- **Verified:** 20/20 checks — 10 overlapping joins for 3 slots → exactly 3 in, no
  oversell; double-click → exactly 1 registration; coupon math exact; refunds restore
  balances; ledger consistent throughout.

### ✅ Phase 6 — Teams & matches
- **Teams**: create (one duo + one squad per player, unique tags, capacities 2/4),
  invite/accept/decline with notifications, remove member, leave (captains must
  transfer first), captaincy transfer, team details with FF UIDs, stats, history,
  winnings. All captain-only actions enforced server-side.
- **Matches**: admin/moderator scheduling with auto-generated room credentials,
  participant sync from confirmed registrations, admin-configurable release window.
- **Timed room-credential release**: `GET /api/matches/my` is the *only* endpoint that
  can return room ID/password — only to registered players, only after the release
  instant, with lazy `CREDENTIALS_RELEASED` transition + notifications. Public API
  remains credential-free (verified).
- **UI**: join-flow team picker, `/teams`, `/teams/[id]`, `/matches` (locked countdown
  → live unlock with copy chips), bottom nav per spec.
- **Critical fix**: settings reads inside financial transactions deadlocked the
  single-writer dev database; all settings lookups hoisted out of transactions.
- **Verified:** 19/19 backend checks + Phase 5 regression green.

### ✅ Phase 7 — Wallet & manual payments
- **Wallet API** (`/api/wallet`): overview (balances + admin-configured limits + recent
  ledger rows), paginated transaction history with in/out/net totals over any filter
  (type/bucket/direction/date-range/reference search), server-side **CSV export**,
  and atomic cash→coins conversion at the admin-set rate.
- **Manual deposits**: JazzCash / EasyPaisa / bank instructions from the seeded
  `PaymentAccount` rows → transaction ID + sender + **screenshot upload** (multer,
  MIME/size-gated, served back owner-or-staff-only) → `PENDING`. Duplicate TIDs are
  blocked by a DB unique constraint (`DUPLICATE_TRANSACTION`), min/max deposit from
  settings; deposits are **never auto-credited**.
- **Admin review**: approve credits the cash ledger exactly once (PENDING-status
  guard + audit + notification); reject records the reason with no money movement.
- **Withdrawals**: winning-balance-only with the full approval chain
  (PENDING → APPROVED → PROCESSING → PAID with mandatory payout reference).
  Funds are debited into a holding at request time; rejection or player cancel
  reverses the holding via a `WITHDRAWAL_REVERSAL` ledger entry. Overdraw,
  below-minimum, and chain-skipping are all refused.
- **UI (design-locked, screens 12/14/15/16/17/22)**: user-app shell (sidebar +
  wallet chips + profile card), redesigned dashboard, wallet home, Add Money
  (stepper, quick amounts, coins preview, method cards), Submit Payment Proof
  (account details with copy + QR, drag-drop screenshot, verification timeline),
  Transactions (filters, summary cards, balance before/after, pagination, CSV),
  and Withdraw Winnings (MAX/quick amounts, method picker, live rules panel,
  recent withdrawals). Fonts (Space Grotesk + Inter) now self-hosted.
- **Verified:** `npm run verify:wallet` — 41/41 checks (duplicate TID across
  users, idempotent approval, chain enforcement, reversals, coin conversion,
  totals math, screenshot ownership, audits, ledger integrity) + Phase 5 join
  regression green; `next build` clean.

### ✅ Phase 8 — Results & prize distribution
- **Player result submission**: `POST /api/matches/:matchId/result` — participants only
  (solo or via team), completed matches only, one live submission per player per match,
  optional screenshot upload, audited.
- **Admin verification API**: pending queue with player/match context, screenshot access
  (owner or staff), **approve / reject / disqualify** with optional placement/kills
  override; approval writes `placement + kills × pointsPerKill` (placement table
  12/9/8/7/…) onto the match participant and updates `PlayerStat` (corrections apply
  compensated deltas); disqualification excludes the player and reverts prior stats.
- **Winner determination**: aggregate points per player/team across a tournament's
  matches (tie-break on kills), public standings endpoint
  (`/api/public/tournaments/:slug/results`) with credited prizes.
- **Idempotent prize distribution**: one command generates **placement prizes** from the
  ranking, a **pro-rata kill pool** capped at its configured budget, and **MVP** for the
  top rank; team awards split equally across current members. Every award anchors on the
  unique `(tournament, position)` Winner row — a second run is refused, a crashed run
  completes without double-crediting. Credited through the immutable ledger with
  notifications, stat earnings and a full audit entry; tournament marked COMPLETED.
- **UI (design 13)**: My Matches rebuilt — Upcoming/Live/Completed tabs with counts,
  rich match cards (entry fee, prize pool, your slot), live room credentials with
  password reveal/copy, completed cards showing placement/kills/points/earnings,
  result submission modal (placement + kills + notes + screenshot) with
  under-review/rejected states, and a final-standings modal with credited prizes.
- **Infra fix**: the pg pool now recycles idle connections before the dev PGlite
  server's 120s teardown — no more one-shot failures after idle periods.
- **Verified:** `npm run verify:results` — 34/34 checks (guards, points math, stat
  corrections, disqualification, ranking, kill-pool cap, MVP, exact crediting,
  idempotency, notifications, audits, ledger integrity) + wallet and join suites
  still green; live e2e through the Next proxy; `next build` clean.

### ✅ Phase 9 — Admin panel
- **Admin shell** (design 26): gated sidebar (Dashboard → Audit Logs), global user
  search, profile chip; client RBAC gate + `ADMIN+` enforcement on every API route.
- **Dashboard**: live KPIs (users, active today, live tournaments, pending
  deposits/withdrawals with totals, open tickets), 30-day revenue chart,
  registrations chart, deposits-vs-withdrawals-vs-prizes donut, recent activity
  feed and open fraud alerts — all from a real aggregate endpoint.
- **Users** (27): search by username/email/FF UID, status filters, ban/suspend/
  restore (super-admin protected) and **audited wallet adjustments** across all
  four buckets with mandatory notes and player notifications.
- **Tournaments + builder** (28/29): list with status flow (publish → live →
  completed/cancel-with-guard) and a 5-step wizard (basics, schedule, pricing,
  prizes, review) with the **live profit calculator** and the economic-safety
  gate — loss-projecting configurations require explicit confirmation.
- **Matches** (30): per-tournament list, scheduling with room credentials +
  participant sync, live/complete transitions.
- **Result verification** (31): the full design-31 workspace — status tabs,
  submission queue, kill/placement override with auto points, screenshot viewer,
  verify / disqualify / reject-for-resubmission, live standings draft, points
  legend and the **idempotent prize distribution** trigger.
- **Deposits (32) / Withdrawals (33)**: filtered queues, proof viewer, one-click
  approval (credits once) and the full payout chain with mandatory reference.
- **Revenue** (34): entry collection vs prizes vs net (deposits never conflated
  with revenue), daily ledger with 30/60/90-day windows.
- **Support (35), Blog CMS (36), Ads (37), SEO (38), Settings (39), Audit Logs
  (40)**: ticket threads with replies/resolve + player notifications, markdown
  blog publishing, ad placements with pause/activate, per-page SEO overrides,
  the full settings table with audited inline edits, and a filterable audit
  trail with before/after inspectors.
- **Verified:** all 15 screens render; live e2e through the proxy — deposit
  approved & credited, withdrawal chain to PAID, result verified with override,
  settings round-trip — every action in the audit trail; wallet/results/join
  suites still green; `next build` + `tsc` clean.

### ⬜ Phase 10 — Financial dashboard → ✅ done

- **One rule above all: deposits are player funds, never revenue.** The only
  revenue line is entry fees actually charged (confirmed registrations);
  everything the platform pays out or gives away is a cost.
- **`GET /api/admin/finance`** (ADMIN+): window totals — gross entry collection,
  coupon discounts (foregone), refunds, prizes distributed, payment costs,
  referral & bonus costs, platform gross, net revenue + margin — plus
  deposits/withdrawals reported strictly as player-fund context;
  **daily/weekly/monthly bucket series over 30/60/90-day windows** that
  reconcile with the totals to the rupee; **all-time per-tournament P&L**
  (collected − refunded − prizes). `format=csv` exports an audit-friendly
  Summary + Series + Per-tournament spreadsheet.
- **UI (design 43, user-approved)**: "Financials" in the admin sidebar — dual
  KPI rows, entry-collection-vs-prizes-vs-net multi-line chart with
  Daily/Weekly/Monthly pills, "where entry fees went" donut, per-tournament P&L
  (table on desktop, stacked cards on mobile), daily ledger with player-fund
  columns marked reconciliation-only, Export CSV. Same design on mobile & PC.
- **Offline Prisma fix**: `npm install` now auto-patches `@prisma/engines`
  (`scripts/offline-prisma-patch.mjs`) so `npm run db:generate` works with the
  WASM engines even where `binaries.prisma.sh` is unreachable.
- **Verified:** `npm run verify:finance` — 36/36 checks (every P&L line
  recomputed straight from SQL, end-to-end payment-cost flow, a deposit approval
  provably changes zero profit lines, bucket reconciliation across all nine
  window/granularity combos, tournament P&L truth, CSV type/content, RBAC) +
  wallet/join/results suites still green; live e2e through the Next proxy
  (login → dashboard JSON → CSV → page); `next build` + `tsc` clean.

### ⬜ Phase 11 — Support + WhatsApp + NEXA
Ticket system (categories, priorities, statuses, attachments), configurable WhatsApp
number across header/footer/payment pages, NEXA rule-based chatbot (replaceable by a
real AI later) with hard limits — it can never approve payments, change balances or
reveal room credentials.

### ⬜ Phase 12 — SEO + Blog CMS
Dynamic metadata, sitemap, robots, canonicals, Open Graph, structured data
(Organization, FAQ, Breadcrumb, Event), SEO routes
(`/free-fire-tournaments`, `/tournaments/solo|duo|squad|clash-squad`, …),
admin-managed blog with SEO fields.

### ⬜ Phase 13 — PWA
Manifest, service worker, app icons, offline fallback, install prompt
("Install CLUTCHNEX"), standalone mode.

### ⬜ Phase 14 — Security hardening
Upload validation (MIME/size/dimensions), fraud/duplicate detection alerts, audit
logging on every financial action, CSRF review, stricter rate budgets.

### ⬜ Phase 15 — Testing
Vitest suites: auth, wallet, deposits/withdrawals, tournament join
(double-click/concurrency), idempotent prize distribution, admin permissions,
withdrawal-exceeding-balance.

### ⬜ Phase 16 — Deployment
Environment docs, production builds for frontend + backend, managed PostgreSQL
configuration, live preview run. No Docker anywhere.

---

## Run locally (no Docker)

```bash
# 1. Database + API
cd backend
cp .env.example .env
npm install
npm run db:dev          # embedded PostgreSQL on :5432 (data in ../pgdata)
npm run db:generate     # Prisma client
npm run db:migrate:dev  # apply migrations
npm run db:seed         # realistic demo data (DEV ONLY)
npm run dev             # API on :4000

# 2. Website
cd ../frontend
npm install
npm run dev             # http://localhost:3000
```

### Demo accounts (development seed — PKR)

| Role | Login | Password |
|---|---|---|
| Super admin | `admin@clutchnex.gg` | `ChangeMe-Admin123` |
| Admin | `ops@clutchnex.gg` | `OpsAdmin@123` |
| Moderator | `mod@clutchnex.gg` | `ModPass@123` |
| Players | `<username>@example.com` (e.g. `areeb_ff`) | `Player@123` |

### Useful scripts

| Where | Script | Purpose |
|---|---|---|
| backend | `npm run verify:join` | Concurrency/financial test suite for the join engine |
| backend | `npm run verify:wallet` | Wallet ledger + manual payments test suite |
| backend | `npm run verify:results` | Results, verification & prize distribution test suite |
| backend | `npm run db:seed` | Reset demo data |
| backend | `npm run typecheck` | `tsc --noEmit` |
| frontend | `npx next build` | Production build check |

---

## Financial safety principles (enforced in code)

1. **The database is the source of truth** — all money math is server-side.
2. **Immutable ledger** — every balance movement writes a `WalletTransaction` with
   before/after balances; corrections are reversal entries, never edits.
3. **Manual payments are never auto-credited** — deposits become real balance only
   after admin verification; duplicate transaction IDs are blocked at the DB level.
4. **Race-safe spending** — joins and withdrawals use DB transactions with atomic
   guards; double-clicks and concurrent racers cannot oversell or overdraw.
5. **Idempotent payouts** — prize distribution can never run twice for one tournament.
6. **Gross ≠ net** — deposits are user funds; platform revenue is collection minus
   player rewards; profit further deducts payment costs, refunds, promotions,
   referral costs, operations and taxes.
7. **Everything sensitive is audited** — balance changes, approvals, bans, settings
   changes write `AuditLog` rows.

## Security principles

- Passwords hashed with bcrypt; refresh tokens stored only as SHA-256 hashes.
- Room credentials are served exclusively to registered players after the release
  instant — never in public responses.
- RBAC on every privileged route; admin actions audited.
- Rate limiting on auth routes + per-email lockout.
- No secrets in code — everything via `.env` (see `.env.example`).

---

## Repository layout

```text
free-fire-tornament/
├── design/            # 42 approved screens + locked design system spec
├── backend/           # Express 5 + TypeScript + Prisma 7 API
│   ├── prisma/        # schema, migrations, seed
│   ├── src/           # routes / services / middleware / validation / lib
│   └── scripts/       # embedded dev database, verification harnesses
├── frontend/          # Next.js 16 App Router website + user app
└── README.md          # this file
```

**Build record:** PR #1 (Phase 1, merged) · [PR #2](https://github.com/sardarhaseebkhan53-hub/free-fire-tornament/pull/2) (Phases 2–6, merged) · Phases 7–9 in review on this branch.
