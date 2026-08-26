# CLUTCHNEX Backend

API-first backend for the CLUTCHNEX Free Fire tournament platform.
**Express 5 + TypeScript + Prisma 7 + PostgreSQL.** The same REST APIs will
serve the web app today and a future Flutter app later without changes.

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
| `npm run studio`      | Prisma Studio                                           |

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

## Seed data (development only)

| Account class | Login                          | Password (dev default) |
| ------------- | ------------------------------ | ---------------------- |
| Super admin   | `admin@clutchnex.gg`           | `ChangeMe-Admin123`    |
| Admin         | `ops@clutchnex.gg`             | `OpsAdmin@123`         |
| Moderator     | `mod@clutchnex.gg`             | `ModPass@123`          |
| Players       | `<username>@example.com`       | `Player@123`           |

The seed covers every lifecycle state: completed/open/cancelled/draft
tournaments, verified matches with results and winners, credited prizes,
pending/approved/rejected deposits, pending/processing/rejected withdrawals,
coupons, referrals, tickets, notifications, blog, FAQs, legal pages, settings
and audit logs — with a fully consistent wallet ledger in PKR.

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
