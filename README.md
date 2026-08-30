# CLUTCHNEX — Free Fire Tournament Platform

**COMPETE. CLUTCH. CONQUER.**

CLUTCHNEX is a premium, production-grade Free Fire esports platform for Pakistan:
tournaments (Solo / Duo / Squad / Clash Squad), teams, matches with timed
room-credential release, an immutable wallet ledger, manual payment
verification (JazzCash / EasyPaisa / bank transfer), prize distribution,
referrals, leaderboards, support, SEO, PWA and a full admin control center.

- 🎨 **UI design: APPROVED & LOCKED** — the implementation follows the locked
  obsidian/violet glassmorphism design system. Concept mockups were removed from
  the repo for a clean production tree; the live app renders every surface from
  actual components.
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
| Email | Provider-swappable (`log` / SMTP / Resend / Postmark) — retries transient faults, never fails an auth flow |
| Currency | PKR default, admin-configurable |

---

## Progress — 17 of 17 phases complete + Phase 18 hardening

| # | Phase | Status |
|---|---|---|
| 0 | UI design gate (46 screens + design system) | ✅ Approved & locked |
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
| 11 | Support + WhatsApp + NEXA chatbot | ✅ Done |
| 12 | SEO + Blog CMS | ✅ Done |
| 13 | PWA | ✅ Done |
| 14 | Security hardening | ✅ Done |
| 15 | Testing | ✅ Done |
| 16 | Deployment | ✅ Done |
| 18 | Production security + financial hardening | ✅ Done — [PHASE18_SECURITY.md](./PHASE18_SECURITY.md) · [PR #21](https://github.com/sardarhaseebkhan53-hub/free-fire-tornament/pull/21) |

Completed work lives in the merged history (PR #1, PR #2, PR #3, PR #4) plus
[PR #5](https://github.com/sardarhaseebkhan53-hub/free-fire-tornament/pull/5)
(Phases 14–16) — one commit per phase, each independently verified. Phase 18 is the
hardening pass on top of that history: 252 backend tests, a live concurrency
harness and a dependency audit that comes up clean.

---

## Polish & hardening change set (this branch)

In-place fixes on top of the locked design — no redesign, no rewrites:

- **Console error fixes.** The 404 on `/uploads/banners/cs-rumble.jpg` is gone:
  seeded banners now point at bundled original art (`/art/banners/*.jpg`),
  every image surface renders through the new reusable `TournamentImage`
  component (loading shimmer → error fallback → branded gradient placeholder,
  never a broken icon), and `/uploads/*` is proxied to the API so admin
  uploads render on the same origin. Missing static files now return a clean
  404 (previously 500). `scroll-behavior: smooth` was removed from `<html>`
  (Next.js route-transition warning); in-page smooth scrolling is JS-driven.
  The stale CSS/image-preload warning went away with the 404 fix.
- **401 `/teams/my` root cause fixed.** Several client components bypassed the
  shared API client, so an expired 15-minute access token produced raw 401s
  instead of a transparent refresh. Teams, join-tournament, notifications and
  tickets now go through `client-api` (refresh-once-then-sign-in), the
  notification bell never polls while signed out, and SOLO registration never
  calls `/teams/my` at all (solo = no team).
- **PWA install.** The deferred `beforeinstallprompt` is stored, prompted
  exactly once per event, and cleared after the user choice resolves — no
  `InvalidStateError` on double-click, banner only shows when installable.
- **48-seat allocation.** `tournament_registrations.seatNumber` is assigned
  atomically inside the join transaction via `UPDATE … RETURNING` (two racers
  can never share a seat; team modes share the team's seat). Seats surface on
  the join receipt, dashboard, My Matches, and the public participants grid;
  cards show Almost Full / Full states and the detail CTA locks at capacity.
- **One PKR wallet (player-facing).** Coins/diamonds UI removed from every
  player screen — dashboard, wallet, add-money, payment and withdraw pages now
  show a single **Available Balance (PKR)** (server-computed `balance` =
  cash + winnings, `withdrawable` = winnings). Backend buckets and ledger
  remain untouched (admin accounting, withdrawal rules).
- **User-to-user transfers.** New `WalletTransfer` model + `POST/GET
  /api/wallet/transfers` + admin `/api/admin/transfers` review page. One DB
  transaction: debit sender, credit recipient, transfer row, audit, both
  notifications — all or nothing. Client-generated `requestId` makes replays
  idempotent; min/max/daily limits and the high-value fraud alert are
  admin-configurable settings; self-transfer/unknown recipients/overdraws are
  refused server-side. Ledger types `TRANSFER_SENT` / `TRANSFER_RECEIVED` /
  `REFUND` added to the immutable ledger enum.
- **WhatsApp.** `platform.whatsappCommunity` setting separates *WhatsApp
  Support* from *WhatsApp Community* across the support center, footer and
  wallet help cards — each with its own destination, nothing duplicated.
- **NEXA chatbot.** New intents for transfers, seats/capacity, game modes and
  teams; coin references removed from deposit/withdrawal answers; guardrails
  unchanged (NEXA still cannot touch money, results or credentials).
- **Tournament detail page.** Banner art, consistent status badges (Open /
  Almost Full / Full / Upcoming / Live), remaining-seat summary and a seat
  grid for participants.

All backend verify suites (join/wallet/results/finance/support/security/
pwa/seo), the Vitest suite (now 170 tests incl. a new transfers suite) and
both production builds are green.

### ZP Battle zone feature & readiness pass (this session)

- **Admin can now see payment & result proof screenshots.** `AuthedImage`
  routes any `/api/*` proof URL through the browser-safe `/api/backend/*`
  proxy, so deposit proofs (`/api/wallet/deposits/:id/screenshot`) and match
  result screenshots (`/api/matches/results/:id/screenshot`) actually load in
  the admin Deposits / Results panels instead of 404-ing.
- **ZP Battle ranked ladder.** A live rank tier (Bronze → Silver → Gold →
  Platinum → Diamond → Master → Grandmaster) is derived on the fly from a
  player's total points via `src/lib/rank.ts`. It's shown as a badge on the
  public Leaderboard, the public player profile (with % to next tier) and the
  player dashboard — no schema change, no drift.
- **NayaPay + SadaPay payment methods.** Added to the `PaymentMethod` enum +
  a migration, the wallet validation/deposit/withdrawal services (treated as
  `03XXXXXXXXX` mobile wallets), the Add Money / Submit Proof / Withdraw
  screens, and the seed's payment destinations.
- **Full admin control over payment destinations.** New **Payment Accounts**
  admin screen (`/admin/payment-accounts`) with create / edit / activate /
  hide / delete, all audited — the accounts players pay into on Add Money are
  now entirely admin-managed.
- **Admin settings edit bug fixed.** Editing a digits-only setting (e.g. the
  WhatsApp number `03001234567`) no longer coerces it to a JS `Number` (which
  dropped the leading zero and broke the number); each setting retains its real
  type (number / boolean / JSON object / string).
- **UI concept mockups removed.** The 103 MB `design/` mockup + design-system
  folder was deleted for a clean production tree; app assets (icons, PWA,
  banners) are kept.
- **Hardening for scale.** Pagination, DB pool sizing, per-IP/per-user rate
  limits and indexes were road-tested; the backend build + the 170-test Vitest
  suite + the production `next build` are all green.

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

### ⬜ Phase 11 — Support + WhatsApp + NEXA → ✅ done

- **Player support tickets** (`/api/support`): create with category / priority /
  subject / message + **screenshot attachment** (MIME/size-gated), paginated
  *My Tickets* with last-message previews and status counts, full thread,
  owner-checked everywhere, player reply reopens (`WAITING_USER → OPEN`),
  player close, `CLOSED` tickets immutable (open a new one). Attachments are
  served through an **owner-or-staff gated** download route. Staff get in-app
  nudges on new tickets/replies; the Phase 9 admin reply flow (now correctly
  marking `isStaff`) notifies the player.
- **UI (design 44, user-approved)**: Support Center at `/support/tickets` —
  status filter pills, ticket cards with category/status/priority, thread with
  staff/player bubbles + attachment previews, reply bar with attach, New Ticket
  modal with dropzone. Table-grade desktop layout collapses to stacked cards on
  mobile — one design for both. Admin support panel now previews player
  attachments inline.
- **NEXA rule-based chatbot** (`POST /api/nexa`, public, 20 req/5 min):
  14 intents incl. deposit status, withdrawals, entries, refunds, prizes,
  referrals, account, human escalation — with **hard limits by construction**:
  it is a pure read-only function, never approves payments, never changes
  balances, never reveals room credentials (guarded refusals always carry the
  limits notice; every response includes it). Unknown input → WhatsApp/ticket
  escalation. `NexaEngine` interface is the swap point for a real AI later.
  Floating NEXA widget + configurable WhatsApp bubble across the user app;
  WhatsApp help strip on the payment-proof page (add-money already had it).
- **Verified:** `npm run verify:support` — 42/42 (lifecycle, cross-player
  isolation, attachment gating incl. staff access, reopen/close/immutability,
  validation, all NEXA guardrails incl. tricky room-credential phrasings, rate
  limit, zero auditable actions from NEXA) + finance/wallet/join/results suites
  still green; live e2e through the Next proxy; `next build` + `tsc` clean.

### ⬜ Phase 12 — SEO + Blog CMS → ✅ done

- **SEO routes (design 45, user-approved)**: `/free-fire-tournaments` hub
  (hero, four mode cards, featured tournaments, FAQ) and
  `/tournaments/solo | duo | squad | clash-squad` mode landings — live data,
  per-mode copy, prize notes, mode FAQs, server-driven status filters.
- **Metadata everywhere**: one `pageMetadata()` builder (canonical URL, Open
  Graph, Twitter cards, keywords) on home, tournaments + details, leaderboard,
  winners, blog + articles, support, player profiles, register — login is
  noindex; admin `SeoConfig` overrides are **finally served to the site**
  through the new `GET /api/public/seo/:pageSlug` and win over built-ins.
- **Structured data**: Organization + WebSite + FAQPage (home, support, hub,
  mode pages), BreadcrumbList (hub, modes, tournament details, articles),
  Event with entry-fee Offer (tournament details), Article (blog).
- **sitemap.xml + robots.txt**: hourly-revalidating sitemap with all static
  routes + live tournament slugs + published blog slugs; robots disallow
  /admin, app pages and /api.
- **Blog CMS SEO fields**: `seoTitle`/`seoDescription` flow from the admin
  composer through the API to the public article page (title, OG, Article
  JSON-LD) with graceful fallback to title/excerpt.
- **Verified:** `npm run verify:seo` — 47/47 live checks against the running
  site (robots, sitemap contents, every JSON-LD type, canonicals/OG, the full
  admin-override → live-page loop, blog SEO round-trip, noindex) + all five
  previous suites still green; `next build` + `tsc` clean.

### ⬜ Phase 13 — PWA → ✅ done

- **Installable standalone app**: `manifest.webmanifest` (standalone display,
  obsidian theme, start_url/scope `/`, app shortcuts to Tournaments / My
  Matches / Wallet) + iOS standalone metas and apple-touch-icon.
- **Real app icons, deterministic**: `frontend/scripts/gen-icons.sh` draws the
  brand tile with ImageMagick (violet gradient rounded square + white "C" arc)
  and exports 192 / 512 / **maskable 512** / apple 180 — verified pixel-exact.
- **Hand-rolled service worker** (zero dependencies, version-busted cache):
  navigations network-first → cached page → **/offline shell**; hashed static
  assets cache-first; **`/api/**` never intercepted** (auth, wallets, live
  tournament state and room credentials always hit the server). Registration
  is production-gated so dev hot-reload stays intact.
- **Offline fallback page** (design 46): wifi-off hero, "your wallet and
  tickets are safe", Try Again / Home — noindex and precached.
- **Install prompt** (design 46): glass "Install CLUTCHNEX" card via
  `beforeinstallprompt` (Chrome/Android/desktop) with iOS Safari Add-to-Home-
  Screen instructions; 14-day dismissal memory; auto-hide when running
  standalone.
- **Verified:** `npm run verify:pwa` — 28/28 (manifest fields, exact PNG
  dimensions parsed from IHDR bytes, SW handlers + `/api/` non-interception +
  offline precache, head metas, crawl rules, source wiring) against the
  production build; all six previous suites still green; `next build` clean.
  The live preview now runs the production server — install it for real.

### ⬜ Phase 14 — Security hardening → ✅ done

- **Uploads are validated by their bytes, not their claims.** A browser-supplied
  `Content-Type` is a lie an attacker controls, so every upload is sniffed
  (JPEG/PNG/WebP magic bytes), the declared type must match the real one, the
  pixel dimensions are parsed straight out of the container header (32px–4096px),
  and rejected files are deleted from disk before the caller sees them. HTML
  renamed to `.png`, GIF/BMP, mislabelled PNGs, 1×1 "screenshots" and 9000px
  bombs are all refused; extensions on disk come from the sniffed type.
- **Private uploads are no longer statically served.** `/uploads` now blocks the
  `deposits/`, `tickets/` and `results/` folders outright (403) — payment proofs
  are reachable only through their owner-or-staff routes, which resolve paths
  traversal-safely and serve files as inert data (`nosniff`, sandboxed CSP,
  `Content-Disposition`, type from the sniffed extension).
- **Fraud & abuse detection (`FraudAlert`)** — 15 detectors wired into live
  traffic: duplicate/reused transaction IDs, **reused payment screenshots**
  (SHA-256 content hash, per-account and cross-account), deposit bursts,
  outlier amounts vs the player's own history, withdrawal bursts,
  deposit→withdraw churn, brand-new accounts cashing out, one payout account
  shared by several players, multi-account signups from one IP/device,
  credential stuffing, **refresh-token replay** (also revokes every live
  session), repeated rejected joins, coupon-code guessing and identical match
  result claims. Detection is **fire-and-forget, deduplicated, admin-tunable
  via `security.*` settings, and never blocks or alters the request it
  observes** — a flagged withdrawal still debits exactly once.
- **Review queue**: `GET /api/admin/fraud` + `POST /api/admin/fraud/:id/review`
  (ADMIN+, audited, idempotent) and a new **Fraud & Abuse** admin screen with
  severity ordering, evidence inspector, review note and status tabs.
- **Audit coverage extended to failures**: `LOGIN_FAILED`, `LOGIN_LOCKOUT`,
  `LOGIN_SUCCESS`, `USER_REGISTERED`, `PASSWORD_CHANGED/RESET`,
  `REFRESH_TOKEN_REUSED`, `COUPON_REJECTED`, `TOURNAMENT_JOIN_REJECTED` and
  `FRAUD_ALERT_*` — with source IP and user-agent on every row. Rejections are
  written outside the rolled-back transaction, so abuse stays visible.
- **CSRF**: the only cookie-authenticated endpoints (`/auth/refresh`,
  `/auth/logout`) now require a first-party marker header and refuse
  cross-site requests — on top of SameSite=Lax, a path-scoped HttpOnly cookie
  and CORS pinned to one origin. The Next.js proxy forwards the marker,
  `Sec-Fetch-Site` and the real client IP.
- **Stricter budgets, three tiers**: global (env-tunable `RATE_LIMIT_PER_WINDOW`,
  default 600/15min), identity (login 10/15min, register 5/h, reset & resend
  5/15min) and financial (deposits 10/h, withdrawals 6/h, joins 30/15min,
  coupons 15/15min, conversions 20/h, admin writes 240/15min) — financial
  limiters key **per user**, so one player cannot lock out a whole NAT.
- **Transport & payload hardening**: helmet with an explicit
  `default-src 'none'` CSP + `frame-ancestors 'none'`, HSTS in production,
  COOP/CORP, no-referrer; JSON bodies capped at 256kb (413 on overflow, clean
  400 on malformed JSON); bcrypt cost raised 10 → **12**; upload quota per
  player per day.
- **Verified:** `npm run verify:security` — **76/76** live checks (byte-level
  upload rejection, upload privacy + traversal, every detector from real
  traffic, dedupe, the detection-never-changes-money proof, audit coverage,
  CSRF, headers, limits, RBAC, review idempotency, bcrypt cost) and all seven
  previous suites still green; `next build` + `tsc` clean.

### ⬜ Phase 15 — Testing → ✅ done

- **`npm test` (Vitest) — 127 tests, no Docker, no live dev server.** A private
  PostgreSQL is booted per run: Vitest's `globalSetup` starts the same embedded
  PGlite the dev workflow uses on its own port (`:55432`) and data directory
  (`.test-pgdata`, wiped each run), applies every migration in order, seeds the
  baseline settings + payment destinations, and tears it all down afterwards.
  `pgdata/` and the dev database are never touched.
- **Suites** (`backend/tests/`):
  - `unit/image.test.ts` — the Phase 14 byte validator: magic-byte sniffing,
    container dimension parsing, MIME-mismatch, 1×1 and oversized rejections,
    byte caps, truncated headers.
  - `unit/economics.test.ts` — the master pricing tier reproduced to the rupee,
    team-size math, kill pools budgeted at their **cap**, uncapped pools
    refused, loss detection and the admin-tunable loss threshold.
  - `integration/auth.test.ts` — registration uniqueness, bcrypt cost 12,
    login by email/username, per-identifier lockout (the correct password is
    refused while locked), banned accounts, **refresh rotation with replay
    detection that revokes every live session**, tokens stored only as hashes.
  - `integration/wallet.test.ts` — credit/debit with before/after on every row,
    **overdraw refused and nothing written**, bucket isolation, whole
    transaction rollback when one leg fails, coin conversion, and a
    `ledgerIsConsistent` invariant (chain continuity + wallet mirror) re-derived
    from the immutable ledger after each scenario.
  - `integration/payments.test.ts` — deposits never auto-credit, duplicate TIDs
    across players, **approval credits exactly once** (second approval refused),
    rejection moves no money, the full PENDING→APPROVED→PROCESSING→PAID chain
    with skipped steps refused, mandatory payout reference, **withdrawals that
    exceed the winning balance refused** (and not fundable from cash/bonus),
    reversals on reject/cancel.
  - `integration/join.test.ts` — **double-click → one registration**, ten racers
    for three slots → exactly three in and the slot counter truthful, full and
    deadline refusals, coupon percentage/fixed/cap/usage-limit math under
    concurrency, refunds per `refundPercent`.
  - `integration/prizes.test.ts` — submission guards, verification writing
    `placement + kills × pointsPerKill`, admin overrides, disqualification
    reverting stats, standings tie-breaks, and **idempotent distribution**:
    a second run is refused and credits not one extra rupee.
  - `integration/permissions.test.ts` — the RBAC ladder, and the real Express
    app over HTTP: every admin route is 401 anonymous / 403 for players,
    moderators are refused ADMIN-only routes, forged and wrong-secret tokens
    are rejected, public listings carry no room credentials, and no error body
    leaks a stack.
  - `integration/fraud.test.ts` — every Phase 14 detector from real traffic,
    dedupe into one OPEN alert, the master switch, and the two properties that
    matter: a flagged withdrawal still debits **exactly once** with a clean
    ledger, and a detector that throws cannot break the request it watches.
- **Verified:** `npm test` → 127/127 green; all eight `verify:*` harnesses still
  green; `tsc --noEmit` now covers `tests/` and `vitest.config.ts`.

### ⬜ Phase 16 — Deployment → ✅ done

Full guide in **[`DEPLOYMENT.md`](DEPLOYMENT.md)** — still no Docker anywhere.

- **Production builds that actually run.** `npm run build` now compiles through
  `tsconfig.build.json` (`rootDir: src`, `src/**` only), so the artifact is
  `dist/index.js` — exactly what `npm start` executes. It previously emitted
  `dist/src/index.js`, which meant `npm start` was broken; the build also no
  longer ships tests or scripts. Verified by booting the compiled server and
  serving `/api/health` + `/api/public/tournaments`.
- **Fail-fast production guards** (`src/lib/env.ts`). In `NODE_ENV=production`
  the API refuses to boot on: an empty/placeholder/short/low-entropy JWT secret
  (`.env.example`'s `change-me-…` values are explicitly rejected — a server that
  starts with a known secret is worse than one that won't start), identical
  access and refresh secrets, a non-Postgres `DATABASE_URL`, and non-`https`
  `PUBLIC_URL` / `CLIENT_ORIGIN`. Each error names the variable and the fix.
  HSTS switches on only in production (verified in the response headers).
- **Environment docs**: a full variable table for both apps, secret generation,
  managed-PostgreSQL guidance (`sslmode`, `connection_limit` sizing, pooler
  mode), `prisma migrate deploy` as the only forward path, TLS/reverse-proxy
  configuration matched to `trust proxy = 1`, persistent-storage requirements
  for private uploads, health checks, log prefixes worth paging on, and a
  release checklist.
- **`frontend/.env.example`**: `BACKEND_URL` (server-side only — the browser
  only ever sees the `/api/backend/*` proxy) and `PUBLIC_URL`. No
  `NEXT_PUBLIC_` secrets exist in this app by design.
- **Real email delivery** (`src/lib/mailer.ts` + `email.service.ts`): the
  provider was a stub that printed `mail skipped` in production, which would
  have silently broken email verification and password reset. It now supports
  `log` / `smtp` (nodemailer) / `resend` / `postmark`, with per-attempt
  timeouts, exponential-backoff retries on transient faults only (a 4xx is
  never retried — a bad key or address will not fix itself), and a hard
  guarantee that a failed send never fails the auth request (the token stays
  valid and the player can ask for a resend). `EMAIL_PROVIDER=log` is refused
  at boot in production for exactly that reason. Covered by 15 unit tests with
  `fetch` and `sleep` injected, so no test touches the network.
- **Verified:** compiled server boots and serves in both dev and production
  mode; the placeholder-secret guard exits non-zero while a strong-secret
  production boot serves `/api/health` with HSTS and still returns 403 for
  `/uploads/deposits/*`; `npm test` 127/127; all eight `verify:*` harnesses
  green; `next build` + `tsc --noEmit` clean.

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

### ✅ Phase 18 — Production security + financial hardening

A gate phase, not a feature phase: eleven release blockers around real money were
closed or re-proven, with **no UI changes** (the design is not the problem). Full
evidence, `file:line` per finding and the residual-risk list live in
[PHASE18_SECURITY.md](./PHASE18_SECURITY.md). The short version:

- **Race safety.** Every balance movement is a conditional `UPDATE … RETURNING`
  inside the caller's transaction, every admin approval is a `WHERE status = …`
  claim, and settlement takes `FOR UPDATE` on the tournament — so double-clicks,
  retried requests and two admins at one deposit cannot pay twice or overdraw.
- **The paid roster is frozen.** `TournamentRegistration.rosterUserIds`
  (additive migration `20260830120000_roster_snapshot`) records the exact ids
  that were charged; prize distribution pays that snapshot and nothing else, and
  leaving/kicking/joining is refused while a paid entry is live.
- **Settlement lifecycle.** Prizes require every match published, are
  idempotent, abort if a recipient has no wallet instead of re-routing money,
  reconcile to the cent, and the scoring formula freezes once results exist.
- **Database contention is a 409, never a 500.** `src/lib/tx-conflict.ts` is one
  retry vocabulary (deadlock / serialization / lost connection / idempotency-key
  collision). Retryable money operations replay their own earlier attempt;
  un-anchored ones answer `409` instead of blind-retrying a possible payout.
- **Two security finds.** `X-Forwarded-For` was trusted from the *client's* side
  of the chain (spoofable origin for every rate limiter, lockout and fraud rule)
  and now comes from the trusted hop; admin-authored ad embeds were injected with
  `dangerouslySetInnerHTML` (stored XSS → session theft) and now render in a
  sandboxed frame.
- **Gates.** 252 backend tests (21 of them financial races), 12 unit tests for
  the retry semantics, 8 `verify:*` suites, the live `verify:concurrency` burst
  harness (12 assertions, five consecutive clean runs, zero 5xx), both typechecks,
  both builds, frontend lint at zero — and `npm audit` clean in both packages
  after overriding the transitive `deepmerge-ts` advisory that Prisma pinned.

### Demo accounts (development seed — PKR)

| Role | Login | Password |
|---|---|---|
| Super admin | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_USERNAME` (default `admin@clutchnex.local` / `clutchnexadmin`) | `SEED_ADMIN_PASSWORD` (dev default `ChangeMe@Dev123`) |
| Admin | `ops@clutchnex.gg` | `OpsAdmin@123` |
| Moderator | `mod@clutchnex.gg` | `ModPass@123` |
| Players | `<username>@example.com` (e.g. `areeb_ff`) | `Player@123` |

The super-admin is PERMANENT and identical in every environment — dev seed
(`db:seed`) and the production-safe upserter (`db:seed:admin`) both create the
same account, and `db:seed:admin` re-syncs its password hash on every run.

### Useful scripts

| Where | Script | Purpose |
|---|---|---|
| backend | `npm run verify:join` | Concurrency/financial test suite for the join engine |
| backend | `npm run verify:wallet` | Wallet ledger + manual payments test suite |
| backend | `npm run verify:results` | Results, verification & prize distribution test suite |
| backend | `npm run verify:finance` | Financial dashboard suite (P&L truth, CSV, RBAC) |
| backend | `npm run verify:support` | Support tickets + NEXA guardrails suite |
| backend | `npm run verify:seo` | SEO + Blog CMS live checks against the web app |
| backend | `npm run verify:pwa` | PWA manifest / SW / icons / offline checks |
| backend | `npm run verify:security` | Security hardening suite (uploads, fraud, CSRF, limits) |
| backend | `npm test` | Vitest suite (127 tests) — boots its own embedded PostgreSQL |
| backend | `npm run build` | Production build → `dist/index.js` (server only) |
| backend | `npm run db:seed` | Reset demo data |
| backend | `npm run db:seed:admin` | Upsert permanent super-admin (production-safe) |
| backend | `npm run typecheck` | `tsc --noEmit` |
| backend | `npx vitest run` | Full suite — 271 tests incl. financial race + 100-way scale tests |
| backend | `npm run verify:concurrency` | Live burst harness (19 checks): double-spend, idempotency, double approval, ledger chaining, 100-way join surge |
| backend | `npm run audit` | Production-dependency `npm audit` (must be 0) |
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
   changes write `AuditLog` rows. In-transaction (`tx.auditLog.create` /
   `auditIn`) whenever the row must die with the change, and deliberately outside
   the transaction for rejection trails that must survive a rollback.
8. **Prize money follows the roster that paid** — distribution reads the frozen
   `rosterUserIds` written under the same row lock that charged the entry fee, so
   a member leaving, being kicked or joining after the fact cannot move money.
9. **An idempotency-key collision is never an error** — it means "another attempt
   of yours is committing"; the original record is replayed, and only if it
   cannot be found does the API answer `409` telling the player to check their
   history. Nobody is told their money vanished because two tabs raced.
10. **Transient ≠ failed** — deadlock/serialization/connection-blip errors are
    retried only where the operation is anchored (idempotency key or a conditional
    state claim); a commit whose response was lost is never blindly re-sent.

## Security principles

- Passwords hashed with bcrypt (cost 12); refresh tokens stored only as SHA-256
  hashes, rotated single-use, and a replayed token kills every live session.
- Uploads are validated by their **bytes** (magic signature, declared-type match,
  pixel dimensions) — never by the client's `Content-Type` or filename.
- Private uploads (payment proofs, ticket attachments, result screenshots) are
  served only through owner-or-staff routes, as inert data, from
  traversal-safe paths.
- Room credentials are served exclusively to registered players after the release
  instant — never in public responses.
- RBAC on every privileged route; admin actions **and failed security events**
  are audited with source IP.
- Fraud detection observes and reports; it never moves money, changes a status
  or blocks a player — a human reviews every alert.
- Rate limiting in three tiers (global / identity / financial) + per-email
  lockout; financial limits key per user so shared NATs stay usable. The origin IP
  is taken from the **last** hop of `X-Forwarded-For` (the one our proxy wrote) —
  the first entry is whatever the client typed.
- A short-lived bearer token is never trusted for identity or privilege: the
  account is re-read on every authenticated request, so suspension and a role
  change take effect immediately, and a database blip cannot turn a valid session
  into a forced logout or a 500.
- Admin-authored HTML (sponsor ad embeds) renders inside a sandboxed `srcDoc`
  iframe — opaque origin, no top-navigation — because staff-only authoring is not
  a security boundary: raw markup in our document could read a visitor's token.
- CSRF defence in depth on the cookie-authenticated endpoints (SameSite +
  path-scoped HttpOnly cookie + pinned CORS + first-party marker header).
- No secrets in code — everything via `.env` (see `.env.example`).

---

## Repository layout

```text
free-fire-tornament/
├── DEPLOYMENT.md      # production deployment guide (no Docker)
├── backend/           # Express 5 + TypeScript + Prisma 7 API
│   ├── prisma/        # schema, migrations, seed
│   ├── src/           # routes / services / middleware / validation / lib
│   └── scripts/       # embedded dev database, verification harnesses
├── frontend/          # Next.js 16 App Router website + user app
└── README.md          # this file
```

**Build record:** PR #1 (Phase 1, merged) · [PR #2](https://github.com/sardarhaseebkhan53-hub/free-fire-tornament/pull/2) (Phases 2–6, merged) · PR #3 (Phases 7–9, merged) · [PR #4](https://github.com/sardarhaseebkhan53-hub/free-fire-tornament/pull/4) (Phases 10–13, merged) · [PR #5](https://github.com/sardarhaseebkhan53-hub/free-fire-tornament/pull/5) (Phases 14–16: security, testing, deployment).
