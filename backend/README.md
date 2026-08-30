# CLUTCHNEX Backend

API-first backend for the CLUTCHNEX Free Fire tournament platform.
**Express 5 + TypeScript + Prisma 7 + PostgreSQL.** The same REST APIs will
serve the web app today and a future Flutter app later without changes.

> 📋 Full project status — every phase with detailed scope and what's
> completed — lives in the **root [`README.md`](../README.md)**.

## Quick start (no Docker, no Postgres install)

```bash
npm install

# 1. Local database — embedded PostgreSQL (PGlite) on :5432, data in ../pgdata
npm run db:dev

# 2. Generate the Prisma client (into backend/generated/, git-ignored)
npm run db:generate

# 3. Apply migrations + seed realistic demo data (PKR, DEV ONLY)
npm run db:migrate:dev        # or: npm run db:migrate for deploy-style apply
npm run db:seed
```

Copy `.env.example` to `.env` first if you want to override defaults.

> **Restricted networks** (no access to `binaries.prisma.sh`): `npm install`
> auto-applies `scripts/offline-prisma-patch.mjs`, and `npm run db:generate`
> uses the CLI's bundled WASM engines, so client generation works fully
> offline. Apply migrations with `node scripts/apply-migrations-offline.mjs`
> instead of `npm run db:migrate:dev`.

## Deploying (Railway / Render / Fly / VPS)

Full guide: [root `DEPLOYMENT.md`](../DEPLOYMENT.md) — §0 is a step-by-step
quick start for **Vercel (web) + Railway (API)**. The short version:

```bash
npm ci
npm run build        # generates the Prisma client, then compiles to dist/
npm run db:migrate   # idempotent, forward-only — safe on every boot (uses DIRECT_URL)
npm run db:seed:admin # upserts the permanent super-admin — safe on every boot
npm start            # node dist/index.js, binds 0.0.0.0:$PORT
```

On Windows PowerShell, run these one at a time — `&&` is not a valid
statement separator there.

- **Connection split (Neon / managed Postgres).** `DATABASE_URL` = **pooled**
  endpoint (host contains `-pooler`) for runtime API traffic — it absorbs
  1,000–2,000 concurrent users via PgBouncer. `DIRECT_URL` = **direct**
  (unpooled) endpoint, read by `prisma.config.ts` for migrations and studio.
  Both with `sslmode=require`. The runtime adapter enforces TLS for any
  non-localhost host.
- **`npm run build` always generates the Prisma client first.** The client
  lives in `generated/` (git-ignored) — a fresh checkout without that step
  fails `tsc` with ~100 `Cannot find module '../../generated/prisma'`
  errors, the most common deploy failure for this repo.
- **`npm start` is self-healing** — a `prestart` hook (`scripts/ensure-build.mjs`)
  builds automatically when `dist/index.js` is missing instead of crashing
  with `Error: Cannot find module '.../dist/index.js'`.
- **`npm run db:migrate`** runs `prisma migrate deploy` and falls back to
  the offline SQL applier if the engine download is blocked.
- **`npm run db:seed:admin`** (prisma/admin-seed.ts) upserts the super-admin
  identified by `SEED_ADMIN_EMAIL` / `SEED_ADMIN_USERNAME` and re-bakes the
  password hash from `SEED_ADMIN_PASSWORD` on every run — so the owner login
  can never desync after an `.env` change. In production `SEED_ADMIN_PASSWORD`
  is required (min 12 chars); when it is unset the seed is skipped rather than
  provisioning a predictable password. Unlike `db:seed` it touches nothing else
  and is production-safe.
- The repo root's `railway.yaml` wires exactly these commands into a Railway
  `api` service — no manual build/start command entry needed.
- In `NODE_ENV=production` the API **refuses to boot** on placeholder or
  missing secrets (JWT, email, origins), a localhost `DATABASE_URL` (the
  source of `P1001: Can't reach database server at 127.0.0.1:5432`), or an
  `http://` `PUBLIC_URL`/`CLIENT_ORIGIN`, and names the offending variable in
  the first line of the log. That's the deploy failing on purpose, not a
  bug — fix the variable it names.

## Scripts

| Script                | What it does                                            |
| --------------------- | ------------------------------------------------------- |
| `npm run dev`         | Express dev server (tsx watch, port 4000)               |
| `npm run build`       | Compile to `dist/`                                      |
| `npm run start`       | Run compiled server                                     |
| `npm run typecheck`   | `tsc --noEmit`                                          |
| `npm run db:dev`      | Embedded PostgreSQL on :5432 (PGlite, persistent data)  |
| `npm run db:generate` | Generate Prisma client                                  |
| `npm run db:migrate`  | `prisma migrate deploy` (production-style)              |
| `npm run db:migrate:dev` | `prisma migrate dev` (dev, creates migrations)       |
| `npm run db:push`     | `prisma db push` (prototyping, no migration files)      |
| `npm run db:seed`     | Seed the demo dataset                                   |
| `npm run db:seed:admin` | Upsert the permanent super-admin (production-safe)    |
| `npm run studio`      | Prisma Studio                                           |
| `npm run verify:finance` | Financial dashboard suite (P&L truth, CSV, RBAC)     |
| `npm run verify:support` | Support tickets + NEXA guardrails suite (Phase 11)  |
| `npm run verify:seo`     | SEO + Blog CMS live checks against the web app (Phase 12) |
| `npm run verify:pwa`     | PWA manifest / SW / icons / offline checks (Phase 13)  |
| `npm run verify:security` | Upload validation, fraud detection, CSRF, limits (Phase 14) |
| `npm test`            | Vitest unit + integration suites (boots its own PGlite DB on :55432) |
| `npm run test:watch`  | Vitest watch mode                                   |

## Architecture notes

- **Prisma 7, Rust-free runtime.** The client is generated to
  `generated/prisma/` and runs through the `@prisma/adapter-pg` driver
  adapter with a WASM query compiler — no native engine is required at
  runtime (`src/lib/prisma.ts`). This keeps the backend portable and works in
  networks where `binaries.prisma.sh` is unreachable.
- **Connection URL** lives in `prisma.config.ts` (Prisma 7 removed `url` from
  the schema datasource block). Runtime code reads `DATABASE_URL` directly.
- **Money is a ledger.** `Wallet` balances are mirrored state; every movement
  writes an immutable `WalletTransaction` with `balanceBefore/balanceAfter`.
  All financial flows run inside database transactions.
- **Never hard-coded economics.** Entry fees, prize pools, platform fees,
  refund percentages, referral rewards, deposit/withdrawal limits and the coin
  conversion rate are `Setting` rows managed from the admin panel.
- **Room credentials are derived, never trusted.** A tournament's custom room
  (`TournamentRoom` — one row per event) stores the values plus an optional pinned
  `releaseAt` or per-event `releaseMinutes`, but every read recomputes the status from the
  event's `startTime` (`resolveRoomState`, `src/services/room.service.ts`), so rescheduling an
  event moves its room window with it — which a cached `AVAILABLE` column could not do. A
  player's values are served by exactly one endpoint, only inside the window and only to a
  confirmed seat; every list and detail payload selects state columns without the password.
  The lead itself is data, not code: `Setting tournament.roomReleaseMinutes`, falling back to
  `ROOM_RELEASE_MINUTES` (default 5). See `PHASE20_TOURNAMENT_ROOM.md`.

## Seed data (development only)

| Account class | Login                          | Password (dev default) |
| ------------- | ------------------------------ | ---------------------- |
| Super admin  | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_USERNAME` (default `admin@clutchnex.local` / `clutchnexadmin`) | `SEED_ADMIN_PASSWORD` (dev default `ChangeMe@Dev123`) |
| Admin         | `ops@clutchnex.gg`             | `OpsAdmin@123`         |
| Moderator     | `mod@clutchnex.gg`             | `ModPass@123`          |
| Players       | `<username>@example.com`       | `Player@123`           |

The super-admin credentials are PERMANENT and identical in every environment:
`prisma/seed.ts` (dev) and `prisma/admin-seed.ts` (production) both create the
same account from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` /
`SEED_ADMIN_USERNAME`.

The seed covers every lifecycle state: completed/open/cancelled/draft
tournaments, verified matches with results and winners, credited prizes,
pending/approved/rejected deposits, pending/processing/rejected withdrawals,
coupons, referrals, tickets, notifications, blog, FAQs, legal pages, settings
and audit logs — with a fully consistent wallet ledger in PKR. Tournament rooms are seeded
across all four states (available, scheduled, hidden, cancelled, plus one event with no room
row at all) so the admin room panel and the player's room card can be opened and read without
inventing data first.

## Auth API (Phase 3)

Base: `/api/auth`. Envelope: `{ success, message?, code?, data }`.

| Method | Path                  | Auth  | Purpose |
| ------ | --------------------- | ----- | ------- |
| POST   | `/register`           | —     | Create account (+ referral link, verification email) |
| POST   | `/login`              | —     | Access JWT + rotating HttpOnly refresh cookie |
| POST   | `/refresh`            | cookie| Rotate session (old token single-use) |
| POST   | `/logout`             | cookie| Revoke refresh + clear cookie |
| POST   | `/verify-email`       | —     | Verify email (grants configurable welcome bonus) |
| POST   | `/resend-verification`| —     | Re-send verification link |
| POST   | `/forgot-password`    | —     | Email a 1-hour reset token |
| POST   | `/reset-password`     | —     | Set new password, revoke all sessions |
| POST   | `/change-password`    | Bearer| Change password (revokes other sessions) |
| GET    | `/me`                 | Bearer| Profile + wallet + stats |

Security: bcrypt hashing, JWT access (15m) + rotating refresh (7d) stored as
SHA-256 hashes, per-email login lockout (settings-driven), route rate limits,
RBAC middleware (`USER < MODERATOR < ADMIN < SUPER_ADMIN`), and no secret or
stack-trace leakage in responses. In development, emails print to the API log
and register/forgot responses include a `…TokenDevOnly` field for easy testing.
