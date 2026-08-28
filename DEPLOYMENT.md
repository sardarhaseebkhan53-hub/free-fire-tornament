# Deploying CLUTCHNEX

Production deployment for the CLUTCHNEX platform: an **Express 5 API** and a
**Next.js 16 website**, backed by **managed PostgreSQL**.

**No Docker anywhere** — both apps are plain Node processes. Everything below
runs on a single VM, a PaaS (Render / Railway / Fly / Heroku-style), or a
serverless-ish host that can run a long-lived Node process.

---

## 0. Quick deploy — Vercel (web) + Railway (API)

The repo ships a [`railway.yaml`](railway.yaml), so both services build with
zero manual command entry.

**1 — Database.** Create a managed PostgreSQL (Neon, Supabase, Railway's
Postgres plugin…) and copy **two** `postgresql://…` connection strings:
the **pooled** one for `DATABASE_URL` and the **direct** one for `DIRECT_URL`
(§2 — on Neon the pooled host contains `-pooler`).

**2 — Railway (API + optional web).** New Project → *Deploy from GitHub* →
pick this repo. Railway reads `railway.yaml` and creates:

| Service | Source | Build | Start |
|---|---|---|---|
| `api` | `backend/` | `npm ci && npm run build` | `npm run db:migrate && npm run db:seed:admin && npm start` |
| `web` | `frontend/` | `npm ci && npm run build` | `npm start` |

Then set environment variables (Railway dashboard → service → Variables):

- `api`: `NODE_ENV=production`, `PORT=4000`, `DATABASE_URL` (pooled),
  `DIRECT_URL` (direct), `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` (two
  different `openssl rand -hex 64` outputs), `CLIENT_ORIGIN`, `PUBLIC_URL`,
  `EMAIL_PROVIDER` (`smtp`/`resend`/`postmark` — **not** `log`),
  `EMAIL_FROM` — full table in §3. The production guards in §3 refuse to
  boot on missing placeholders, and the error names the exact variable.
  If you attach the Railway Postgres plugin, `DATABASE_URL` is filled
  automatically.
- `web`: `BACKEND_URL` = the `api` service's public HTTPS URL,
  `PUBLIC_URL` = the `web` service's public HTTPS URL.

**3 — Vercel (web, recommended over the Railway `web` service).** New Project
→ import the repo → **set the root directory to `frontend`** → add
`BACKEND_URL` and `PUBLIC_URL` → Deploy. `frontend/vercel.json` handles the
rest (`npm ci` + `next build`).

> ⚠️ If you deploy the **repository root** to Vercel instead of `frontend/`,
> Vercel finds no framework and the deploy fails. The framework detection
> needs to point at the `frontend/` subdirectory (Root Directory field).

**4 — Smoke test.**

```bash
curl -sf $API_URL/api/health          # → {"success":true,…}
curl -sf $WEB_URL/ | grep -q CLUTCHNEX
```

Everything else in this document is the detailed reference behind those
steps.

---

## 1. Requirements

| Component | Version / notes |
|---|---|
| Node.js | **22 LTS or newer** (the API uses `node:crypto`, native `fetch` in tests) |
| PostgreSQL | **15+** (verified against 17.5 and 18.3). Managed: Neon, Supabase, RDS, Cloud SQL |
| npm | 10+ |
| Disk | A persistent, writable directory for `UPLOAD_DIR` (payment proofs) |

The API is stateless apart from that uploads directory and an in-memory login
lockout counter, so **one instance is enough** to start. If you scale to
multiple instances, put a shared cache in front of the lockout counter (it is
the only piece of cross-instance state) or accept per-instance lockouts.

---

## 2. Database

1. Create a database and a role with DDL rights (migrations create tables).
2. Copy **two** connection strings. In production the API keeps them separate:

| Variable | Used by | Must be |
|---|---|---|
| `DATABASE_URL` | **Runtime** API traffic (`backend/src/lib/prisma.ts`, driver adapter) | The **pooled** endpoint |
| `DIRECT_URL` | **Prisma CLI** only — `migrate deploy/dev`, `studio` (`backend/prisma.config.ts`) | The **direct** (unpooled) endpoint |

This is the Prisma 7 equivalent of the classic schema block
`url = env("DATABASE_URL")` + `directUrl = env("DIRECT_URL")`: Prisma 7 moved
the URLs out of `schema.prisma` (which keeps only `provider = "postgresql"`)
into `prisma.config.ts` (CLI) and the `@prisma/adapter-pg` adapter (runtime).

**Neon** (`ep-empty-fire-aeiut8pg`): open the project → *Connection Details*
→ copy the string once with **Pooled connection ON** (host contains
`-pooler…`) and once with it **OFF**:

```
DATABASE_URL="postgresql://USER:PASSWORD@ep-empty-fire-aeiut8pg-pooler.REGION.aws.neon.tech/neondb?sslmode=require&connection_limit=10"
DIRECT_URL="postgresql://USER:PASSWORD@ep-empty-fire-aeiut8pg.REGION.aws.neon.tech/neondb?sslmode=require"
```

Why both:

- **Runtime must go through the pooler.** PgBouncer multiplexes thousands of
  API clients over a handful of real Postgres connections. That is what lets
  one or two Railway instances absorb **1,000–2,000 concurrent users** without
  hitting the connection cap; direct connections crash under that load.
- **Migrations must bypass the pooler.** `prisma migrate` relies on session
  state and advisory locks that PgBouncer's transaction mode breaks, so every
  CLI command reads `DIRECT_URL` first (`prisma.config.ts` falls back to
  `DATABASE_URL` when `DIRECT_URL` is unset).

Guidance:

- **`connection_limit`** sizes the API's per-process pool (default 10 against
  a pooled endpoint). Keep `instances × connection_limit` under your plan's
  cap; on the Neon *pooler* the ceiling is 10,000, so 2 instances × 10 is
  trivially safe while PgBouncer does the multiplexing.
- **`sslmode=require`** on every managed provider except a same-VPC RDS you
  control (the runtime adapter enforces TLS for any non-localhost host).
- Poolers: use the **session** mode if your provider offers a choice
  (PgBouncer `transaction` mode is fine too — the API only uses transactions
  that stay on one connection).
- The API **refuses to boot** in production when `DATABASE_URL` points at
  `localhost`/`127.0.0.1` — that misconfiguration is the source of the
  infamous `P1001: Can't reach database server at 127.0.0.1:5432`.

Apply the schema with the migration files in `backend/prisma/migrations`:

```bash
cd backend
npm ci
npm run db:generate          # writes the client to backend/generated/
npm run db:migrate           # = prisma migrate deploy (idempotent, forward-only; uses DIRECT_URL)
npm run db:seed:admin        # upserts the permanent super-admin (safe in production)
```

`db:migrate` never edits or resets data. **Never** run `npm run db:seed` in
production — it refuses (`NODE_ENV=production`) and it truncates tables.

### Permanent super-admin

`backend/prisma/admin-seed.ts` (`npm run db:seed:admin`) is idempotent and
production-safe: it upserts the platform owner's account by email, forces
`SUPER_ADMIN` / `ACTIVE`, and **re-bakes the bcrypt hash from
`SEED_ADMIN_PASSWORD` on every run** — so an `.env` change can never leave a
stale hash behind (the classic "login fails after .env update"). Railway runs
it on every boot (see the `api` start command in `railway.yaml`).

| | |
|---|---|
| Email | value of `SEED_ADMIN_EMAIL` (default `sardarghaseeb777@gmail.com`) |
| Username | value of `SEED_ADMIN_USERNAME` (default `sardarghaseeb`) |
| Password | value of `SEED_ADMIN_PASSWORD` (default `sardar9003202@`) |

Keep these three variables identical across environments (they are the
permanent credentials and are also the defaults in `backend/.env.example`).

---

## 3. Backend environment

Copy `backend/.env.example` to `.env` (or set the same keys in your platform's
environment UI — they are read once at boot by `src/lib/env.ts`).

| Variable | Required | Example | Notes |
|---|---|---|---|
| `NODE_ENV` | ✅ | `production` | Turns on HSTS and the startup guards below |
| `PORT` | ✅ | `4000` | The API binds `0.0.0.0:$PORT` |
| `DATABASE_URL` | ✅ | `postgresql://…-pooler…` | Pooled endpoint. Must be a `postgres(ql)://` URL in production; a localhost host is refused (P1001 guard) |
| `DIRECT_URL` | on Neon | `postgresql://…` (no `-pooler`) | Direct endpoint, read by the Prisma CLI for migrations; falls back to `DATABASE_URL` |
| `JWT_ACCESS_SECRET` | ✅ | `openssl rand -hex 64` | ≥32 chars, high entropy |
| `JWT_REFRESH_SECRET` | ✅ | `openssl rand -hex 64` | **Different** from the access secret |
| `JWT_ACCESS_TTL` | | `15m` | Access-token lifetime |
| `JWT_REFRESH_TTL_DAYS` | | `7` | Rotating refresh-cookie lifetime |
| `SEED_ADMIN_EMAIL` | | `sardarghaseeb777@gmail.com` | Permanent super-admin (upserted by `db:seed:admin` on every boot) |
| `SEED_ADMIN_PASSWORD` | | `sardar9003202@` | Permanent password — the stored hash is re-baked from this on every boot |
| `SEED_ADMIN_USERNAME` | | `sardarghaseeb` | Permanent username |
| `CLIENT_ORIGIN` | ✅ | `https://clutchnex.gg` | CORS is pinned to exactly this origin |
| `PUBLIC_URL` | ✅ | `https://clutchnex.gg` | Canonical URLs, sitemap, email links |
| `MAX_UPLOAD_MB` | | `5` | Payment-proof size cap |
| `UPLOAD_DIR` | | `uploads` | **Must be on persistent storage** |
| `RATE_LIMIT_PER_WINDOW` | | `600` | Global per-IP requests per 15 min |
| `EMAIL_PROVIDER` | ✅ | `resend` | `log` \| `smtp` \| `resend` \| `postmark` — **`log` is refused in production** |
| `EMAIL_FROM` | ✅ | `CLUTCHNEX <no-reply@clutchnex.gg>` | Must be a domain you can send from (SPF/DKIM) |
| `EMAIL_REPLY_TO` | | `support@clutchnex.gg` | Where player replies land |
| `EMAIL_TIMEOUT_MS` | | `10000` | Per-attempt budget |
| `EMAIL_ATTEMPTS` | | `3` | Total attempts (transient faults only) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | with `smtp` | `email-smtp.…`, `587`, `false`, … | `SMTP_SECURE=true` means implicit TLS (465); `false` means STARTTLS (587) |
| `RESEND_API_KEY` | with `resend` | `re_…` | |
| `POSTMARK_SERVER_TOKEN` | with `postmark` | | |

Generate the secrets:

```bash
openssl rand -hex 64   # JWT_ACCESS_SECRET
openssl rand -hex 64   # JWT_REFRESH_SECRET
```

### Startup guards (fail fast, on purpose)

In `NODE_ENV=production` the API **refuses to boot** if:

- a JWT secret is empty, a shipped placeholder (`change-me-…`, `dev-only-…`),
  shorter than 32 characters, or low-entropy;
- the two JWT secrets are identical;
- `DATABASE_URL` is not a PostgreSQL URL, or points at `localhost`/`127.0.0.1`
  (nothing listens there inside the container — that guard turns the confusing
  `P1001: Can't reach database server at 127.0.0.1:5432` into a named fix);
- `PUBLIC_URL` or `CLIENT_ORIGIN` is not `https://`;
- `EMAIL_PROVIDER` is still `log` (verification and reset mail would go nowhere);
- `EMAIL_FROM` does not contain a real address.

A server that starts with a placeholder secret is worse than one that does not
start — every access token becomes forgeable. The error message says exactly
which variable failed and how to fix it.

---

## 4. Build & run the API

```bash
cd backend
npm ci
npm run build          # generates the Prisma client, then tsc → dist/index.js
npm run db:migrate
npm run db:seed:admin  # upserts the permanent super-admin (idempotent)
npm start              # node dist/index.js
```

On Windows PowerShell do **not** chain commands with `&&` (it is not a valid
statement separator there — `The token '&&' is not a valid statement
separator`). Run them one at a time (`npm ci`, then `npm run build`, …) or
use the npm scripts, which never need separators.

`npm run build` **always generates the Prisma client first**
(`npm run db:generate && tsc -p tsconfig.build.json`). The client lives in
`backend/generated/` and is git-ignored, so a fresh checkout (CI, Railway,
Render…) has no client until this runs — skipping it is the classic cause of
a wall of `TS2307: Cannot find module '../../generated/prisma'` build errors.
You can still run `npm run db:generate` by hand; the build just no longer
depends on you remembering to.

`npm start` is self-healing: a `prestart` hook (`scripts/ensure-build.mjs`)
detects a missing `dist/index.js` — the result of running `npm start` before
`npm run build` (`Error: Cannot find module '.../dist/index.js'`) — and runs
the build automatically instead of crashing.

`npm run db:migrate` is resilient: it runs `prisma migrate deploy` and, if
the engine download is blocked by the network, transparently applies the same
migration files through the offline SQL applier. Either way it is idempotent
and forward-only — safe to run on every boot (that's what `railway.yaml`
does). It reads `DIRECT_URL` (falling back to `DATABASE_URL`) so migrations
bypass PgBouncer.

Sanity check:

```bash
curl -s http://127.0.0.1:4000/api/health
# {"success":true,"data":{"status":"ok","service":"clutchnex-api",…}}
```

`npm run build` compiles **only** `src/` (`tsconfig.build.json`), so `dist/`
contains the server and nothing else. `npm run typecheck` still covers the
tests and scripts.

---

## 5. Build & run the website

```bash
cd frontend
npm ci
npm run build          # next build
npm start              # next start (bind with -H 0.0.0.0 -p 3000 behind a proxy)
```

| Variable | Required | Example | Notes |
|---|---|---|---|
| `BACKEND_URL` | ✅ | `https://api.clutchnex.gg` | **Server-side only.** Where the Next server (and its `/api/backend/*` proxy) reaches the API. Never exposed to the browser |
| `PUBLIC_URL` | ✅ | `https://clutchnex.gg` | `metadataBase`, canonical URLs, sitemap, JSON-LD |
| `NODE_ENV` | | `production` | The service worker only registers in production |

The browser **never** talks to `BACKEND_URL` directly: client components call
the relative `/api/backend/...` route, which proxies to the API and forwards
authorization, cookies, `Sec-Fetch-Site`, the first-party CSRF marker and the
real client IP. That is what keeps cookies SameSite-safe and lets the API see
the true source address.

`PUBLIC_URL` must match the deployed origin, or every canonical URL, Open Graph
tag and sitemap entry will point somewhere else.

### Deploying on Vercel

The **website** (`frontend/`) is a standard Next.js 16 app and deploys to
Vercel. When you import the repo, set **Root Directory = `frontend`** —
deploying the repository root fails because the framework (and
`package.json`) lives in the subdirectory. `frontend/vercel.json` installs
with `npm ci` (lockfile-faithful — `npm install` is the usual source of
`ERESOLVE`/`E404` "multiple errors" on Vercel when the lockfile drifts) and
builds with `next build`.

Set exactly two environment variables on Vercel:

| Variable | Value |
|---|---|
| `BACKEND_URL` | the API's public HTTPS URL (never `localhost`) |
| `PUBLIC_URL` | the Vercel origin of the site |

Both are read **at request time**, not baked in: the browser only ever calls
the relative `/api/backend/*` proxy, and `/uploads/*` is proxied by the
`src/app/uploads/[...path]/route.ts` route handler (deliberately NOT a
`next.config.ts` rewrite — rewrite destinations are frozen at build time, so
a missing or changed `BACKEND_URL` would silently keep pointing at
localhost). Changing `BACKEND_URL` on Vercel takes effect on the next deploy
without re-baking anything.

**The API does NOT belong on Vercel serverless functions.** The Express API
stores payment proofs, ticket attachments and result screenshots on a local
writable `UPLOAD_DIR` volume and serves `/uploads/*` from that same disk.
Vercel functions use an **ephemeral** filesystem — files written by one request
are gone by the next, so deposit/result proofs would break and the in-memory
login lockout state would reset constantly. Run the API on a long-lived host
with a persistent volume instead (Render, Railway, Fly.io, a VPS/Caddy setup,
or EC2), exactly as §1–§4 describe.

Recommended split:

| Piece | Where | Env |
|---|---|---|
| Website (`frontend/`, `next build`) | **Vercel** | `BACKEND_URL=https://api.…`, `PUBLIC_URL=https://clutchnex.gg` |
| API (`backend/`, `npm start`) | Render / Railway / Fly / VPS | everything in §3 + a persistent `UPLOAD_DIR` |
| Database | Neon / Supabase / RDS | `DATABASE_URL` |

### Deploying on Railway

The repo root ships a [`railway.yaml`](railway.yaml) — deploy the repo and
Railway creates both services (`api` from `backend/`, `web` from `frontend/`)
with the correct commands:

- **`api`** — build `npm ci && npm run build` (the build generates the Prisma
  client automatically — see §4); start `npm run db:migrate && npm run
  db:seed:admin && npm start` (migrations run on every boot — idempotent and
  forward-only — and the permanent super-admin is upserted with its hash
  re-synced to `SEED_ADMIN_PASSWORD`).
- **`web`** — build `npm ci && npm run build`; start `npm start`
  (`next start` binds `0.0.0.0:$PORT`).

Environment variables per service:

| Service | Variables |
|---|---|
| `api` | everything in §3 — `NODE_ENV=production`, `PORT=4000`, `DATABASE_URL` (**pooled**), `DIRECT_URL` (**direct**), `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_ORIGIN`, `PUBLIC_URL`, `EMAIL_PROVIDER` ≠ `log`, `EMAIL_FROM`, `SEED_ADMIN_EMAIL/PASSWORD/USERNAME`, … |
| `web` | `BACKEND_URL` (public HTTPS URL of the `api` service), `PUBLIC_URL` (its own origin) |

- **Postgres:** for the 1,000–2,000 concurrent-user target use **Neon with
  the split of §2**: `DATABASE_URL` = pooled (`-pooler`) host,
  `DIRECT_URL` = direct host, both with `sslmode=require`. The Railway
  PostgreSQL plugin also works — `DATABASE_URL` is filled for you (add
  `DIRECT_URL` = the same string unless the plugin exposes a pooler host).
- **Uploads:** Railway's disk is ephemeral. Attach a Volume to the `api`
  service (mounted at `/data`) and set `UPLOAD_DIR=/data/uploads`, or payment
  proofs and result screenshots will vanish on every redeploy (§7).
- **Boot failures are informative, not random:** with `NODE_ENV=production`
  the API refuses to start on placeholder/missing secrets and tells you
  exactly which variable to fix (§3). Read the first line of the deploy log.

---

## 6. TLS & reverse proxy

Terminate TLS in front of both apps (Caddy, nginx, or your PaaS). The API sets
`trust proxy = 1`, i.e. **exactly one** proxy hop:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 8m;      # >= MAX_UPLOAD_MB + multipart overhead
}
```

If you add a second hop (CDN → LB → app), change `trust proxy` to the number of
hops, or rate limits and audit IPs will record the wrong address.

Security headers come from the API itself (helmet): `default-src 'none'` +
`frame-ancestors 'none'` CSP, HSTS in production, COOP/CORP, `no-referrer`,
`nosniff`. You do not need to duplicate them at the proxy — but do **not**
strip them.

---

## 7. Uploads

Payment proofs, ticket attachments and result screenshots are written under
`UPLOAD_DIR` (`deposits/`, `tickets/`, `results/`). They are **private**: the
static `/uploads` mount refuses those folders, and they are served only through
owner-or-staff routes.

- Mount a **persistent volume** at `UPLOAD_DIR` — on ephemeral filesystems the
  proofs vanish on redeploy while the deposit rows still reference them.
- Back it up alongside the database; a proof without its deposit row (or the
  reverse) makes a payment dispute unresolvable.
- Keep it off the public web root. There is no reason for a web server to serve
  that directory directly.

---

## 8. Health, logs, operations

- **Health check:** `GET /api/health` → `200` with a JSON body. Use it for load
  balancer and orchestrator probes.
- **Logs:** both apps log to stdout/stderr. Notable prefixes: `[fraud]` (a
  detector raised an alert), `[audit]` (an audit row failed to write — alert on
  this), `[email:dev]` (development-only mail sink).
- **Email:** configured through `EMAIL_PROVIDER` — see §3. Delivery is retried
  with exponential backoff on transient faults (network errors and 5xx) and
  never retried on a 4xx, because a rejected address or bad API key will not fix
  itself. A failed send is logged as `[email] delivery failed …` and **does not
  fail the request**: the token stays valid server-side and the player can ask
  for a resend. Alert on that log line — it is the only signal that
  verification and password reset have quietly stopped working.
- **Alerts worth paging on:** `INTERNAL_ERROR` spikes, `[audit] failed to write`,
  and a growing `fraud_alerts` queue with `severity = CRITICAL`.
- **Admin review:** open `/admin/fraud` daily early on — detectors flag, humans
  decide. Nothing in the fraud engine blocks a player automatically.

---

## 9. Release checklist

```bash
# API
cd backend && npm ci && npm run db:generate && npm run build
npm run typecheck && npm test                 # 127 tests, boots its own DB
npm run db:migrate
npm run db:seed:admin

# Website
cd ../frontend && npm ci && npm run build

# Smoke
curl -sf $API/api/health
curl -s  $API/api/auth/login -H 'content-type: application/json' \
  -d '{"identifier":"sardarghaseeb777@gmail.com","password":"sardar9003202@"}' | grep -q accessToken
curl -sf https://your-origin/            | grep -q CLUTCHNEX
curl -s  https://your-origin/robots.txt  | grep -q Sitemap
```

Then verify by hand: register → verify email → deposit → **admin approves** →
join a tournament → withdrawal chain. That single pass exercises auth, the
ledger, uploads, RBAC and the admin panel.

---

## 10. Local development (no Docker, no Postgres install)

```bash
cd backend
cp .env.example .env
npm install
npm run db:dev          # embedded PostgreSQL (PGlite) on :5432, data in ../pgdata
npm run db:generate
node scripts/apply-migrations-offline.mjs   # or: npm run db:migrate:dev
npm run db:seed         # demo data (DEV ONLY)
npm run dev             # API on :4000

cd ../frontend && npm install && npm run dev  # http://localhost:3000
```

In restricted networks (no `binaries.prisma.sh`), `npm install` auto-applies
`scripts/offline-prisma-patch.mjs` and `npm run db:generate` uses the CLI's
bundled WASM engines, so client generation works fully offline.

`npm test` needs no setup at all: it boots its own PGlite instance on `:55432`
with a throwaway data directory, applies the migrations, and tears it down.
