# CLUTCHNEX — Implementation Report (2026-08-29)

Branch: `arena/01a04cca-free-fire-tornament` (from `f057caf`).

Scope: the **confirmed real gaps** in §E of the master prompt, in the §H order.
All claims below were verified by actually running the code (typecheck, build,
test, or a live request against the dev database) — not by reading docs.

---

## 1. What was fixed / added

### E.1 — Ads (backend bug + missing consumer) — FIXED + live-verified

**Root cause (confirmed):** `activeAds()` in `public.service.ts` combined
`OR: [{startsAt:null},{startsAt:{lte:now}}]` with
`AND: [{endsAt:null},{endsAt:{gte:now}}]`. The `AND` required `endsAt` to be
null **and** in the future on the same row at once, which is impossible, so the
endpoint always returned zero ads.

- `backend/src/services/public.service.ts`
  - `activeAds()` now nests each date window as its own `OR` group under one
    `AND` (started **and** not-ended).
  - Added `recordAdImpression(id)` / `recordAdClick(id)` — `updateMany`
    increments that are a safe no-op for unknown ids (a deleted-ad beacon can
    never 500 the page).
- `backend/src/routes/public.routes.ts`
  - Added `POST /public/ads/:id/impression` and `POST /public/ads/:id/click`.
- `frontend/src/components/ad-slot.tsx` (new, server) — fetches
  `/public/ads/:placement`, maps to `AdCard`, renders nothing when empty.
- `frontend/src/components/ad-card.tsx` (new, client) — fires an impression
  beacon on mount (deduped per page view, StrictMode-safe) and a click beacon
  via `navigator.sendBeacon` (survives navigation); renders image+link or
  admin-provided embed HTML.
- Wiring:
  - `(public)/layout.tsx` → `HEADER`, `MOBILE` (mobile-only), `FOOTER`.
  - `tournaments/[slug]/page.tsx` → `TOURNAMENT_PAGE`, `SIDEBAR`.
  - `blog/[slug]/page.tsx` → `BLOG`.
- **INTERSTITIAL deliberately NOT built** — no page renders it and a blocking
  interstitial contradicts "never destroy UX". Leave unbuilt until a product
  decision is made.

**Live verification (dev DB on :5432, API on :4000):**
- Inserted two ad rows (one with the previously-impossible `startsAt=null,
  endsAt=null` window, one with a past-start/future-end window).
- `GET /public/ads/HEADER` → returned **both** ads (non-empty) ✓
- `GET /public/ads/SIDEBAR` → `[]` (no sidebar ads configured) ✓
- `POST /public/ads/:id/impression` ×2, `POST /public/ads/:id/click` ×1 →
  DB counters read back `impressions=2, clicks=1` ✓
- Unknown-id beacon → HTTP 200 no-op ✓
- Added regression coverage: `backend/tests/integration/public-ads.test.ts`
  (6 tests) covering the date-window matrix + counters.

### E.2 — Duo independent registration (frontend) + admin pairing — BUILT

Backend already supported the join branch (`isIndependentDuo`), gated by the
platform setting `tournament.allowIndependentDuo` — but the setting was never
surfaced to the UI and there was **no admin pairing capability at all**.

- `backend/src/services/public.service.ts` — `getTournamentBySlug` now returns
  `allowIndependentDuo` (reads `tournament.allowIndependentDuo`).
- `frontend/src/lib/types.ts` — `TournamentDetails.allowIndependentDuo`.
- `frontend/src/components/join-tournament.tsx` — DUO tournaments with the flag
  enabled now show a "Register my duo / Register solo · paired by admin"
  toggle. The solo path collects Free Fire UID/IGN (prefilled from `/auth/me`,
  server-validated, falls back to saved profile) plus the coupon field, and
  sends `freeFireUID`/`freeFireIGN` with `teamId` omitted.
- `tournaments/[slug]/page.tsx` — passes `allowIndependentDuo` through.
- **Admin pairing (second gap, built alongside):**
  - `backend/src/services/slot.service.ts` — `pairIndependentDuo()`: validates
    DUO tournament + two confirmed, unteamed registrations, enforces the
    one-DUO-team invariant, creates a DUO team (captain = first pick, unique
    tag with collision retry), re-points both registrations, notifies both
    players, writes an `DUO_PAIRED` audit row. Race-safe via the tournament row
    lock + `Team.tag` unique constraint.
  - `backend/src/routes/admin.routes.ts` — `POST /admin/tournaments/:id/pair`
    (adminWriteLimiter, ADMIN+).
  - `backend/src/validation/admin.schema.ts` — `duoPairSchema`.
  - `(admin)/admin/slots/page.tsx` — "Pair solo players (n)" button (DUO only,
    ≥2 unpaired) opens a modal with two selects; pairs and refreshes the board.

### E.3 — Admin match table mobile cards — BUILT

`components/admin/match-table.tsx`:
- Desktop table is now `hidden md:block`; a `md:hidden` card list renders the
  same fields (slot, player/team, FF name, UID, reg id, payment, ready, score,
  prize, status) with no horizontal scroll.
- Editing actions move behind a per-row **bottom sheet** (`ResultRowSheet`) with
  the full editor (position/kills/bonus/penalty/prize/status/ready/absent/live
  score preview). Shared `useResultDraft` hook keeps desktop row + mobile sheet
  in sync; `saveRow` now returns success so the sheet only closes on success.

### E.4 — Admin fetch duplication — CONSOLIDATED

- `useAdminList` in `kit.tsx` **already** delegated to `api()` (the §E.4 note
  about it duplicating refresh logic was stale). The real remaining copy was
  `AuthedImage`.
- `client-api.ts` — extracted `authedFetchResolved(url, init)` (the single
  refresh-once-on-401 implementation); `authedFetch(path)` now wraps it.
- `kit.tsx` — `AuthedImage` now calls `authedFetchResolved` instead of its own
  token-rotation copy.

### E.5 — Re-verified; only the squad join code needed work

| Item | Verdict | Action |
|---|---|---|
| Squad invite / join code | Backend existed (`GET /teams/:id/join-code`, `POST /teams/join`); **frontend missing** | Added captain join-code UI (copy + rotate) to `teams/[id]/page.tsx` and a "Join with a code" form to `teams/page.tsx` |
| Scoring formula config end-to-end | `result.service.ts` computes `finalScore` server-side (placement + kills×ppk + bonus − penalty) | None needed |
| Match statuses `UPCOMING`/`ROOM_CREATED`/`ROOM_OPEN` | Used (admin status machine + validation + admin match filters) | None needed |
| Room credential release timing UI | Present in My Matches (countdown + copy chips) | None needed |
| SEO structured data (FAQ/breadcrumb) | Present on tournament pages | None needed |

---

## 2. Migrations

**None.** No schema change was made — every feature reused existing models
(`Advertisement`, `Team`/`TeamMember`, `TournamentRegistration`, `UserProfile`,
`Notification`, `Setting`). `npx prisma format`/`validate`/`db:generate` and
additive migrations were therefore unnecessary.

## 3. Endpoints changed

| Endpoint | Change |
|---|---|
| `GET /public/ads/:placement` | Behavior fixed (was always empty) |
| `POST /public/ads/:id/impression` | **New** (counter existed, never incremented) |
| `POST /public/ads/:id/click` | **New** |
| `POST /admin/tournaments/:id/pair` | **New** (DUO independent pairing) |
| `GET /public/tournaments/:slug` | Now returns `allowIndependentDuo` |

## 4. Pages / components changed

- `frontend/src/components/ad-slot.tsx`, `ad-card.tsx` (new)
- `frontend/src/app/(public)/layout.tsx`, `blog/[slug]/page.tsx`,
  `tournaments/[slug]/page.tsx`
- `frontend/src/components/join-tournament.tsx`, `lib/types.ts`
- `frontend/src/app/(admin)/admin/slots/page.tsx`
- `frontend/src/components/admin/match-table.tsx`, `kit.tsx`
- `frontend/src/app/(app)/teams/page.tsx`, `teams/[id]/page.tsx`
- `frontend/src/lib/client-api.ts`
- Backend: `public.service.ts`, `public.routes.ts`, `slot.service.ts`,
  `admin.routes.ts`, `validation/admin.schema.ts`,
  `scripts/verify-join-engine.mts` (stale-harness fixture fix)

## 5. Tests run — actual results

| Command | Result |
|---|---|
| backend `npm run typecheck` | ✅ pass |
| backend `npm test` | ✅ **190 passed** (15 files), incl. new `public-ads.test.ts` (6) |
| backend `npm run build` | ✅ pass |
| frontend `npx tsc --noEmit` | ✅ pass |
| frontend `npm run build` | ✅ pass |
| frontend `npm test` | ✅ **18 passed** |
| `npm run verify:join` | ✅ pass (after fixing the stale harness's missing `user_profiles` fixture) |
| `npm run verify:wallet` | ❌ **pre-existing** harness drift — expects `admin@clutchnex.gg`, which the current seed no longer creates |
| `npm run verify:results` | ❌ **pre-existing** harness drift (crashes reading an absent fixture) |
| `npm run verify:finance` | ❌ **pre-existing** harness drift — signs JWTs for non-existent user ids, predating the re-read-account auth hardening (tokens are re-validated against the DB now) |
| `npm run verify:support` | ✅ pass |
| `npm run verify:security` | ✅ pass |
| `npm run verify:seo` / `verify:pwa` | Not run — require the frontend dev/prod server on :3000 |

## 6. Remaining known issues

1. **Mockups (§C)** not generated — approval-gated step (image generator), and
   the remaining screens' implementations already exist behind the scenes; to
   be done as the next phase per §H.5.
2. **`verify:wallet` / `verify:results` / `verify:finance` harnesses are stale**
   (seed/admin-email drift and pre-hardening token assumptions). They are dev
   verification scripts, not part of `npm test`; fixing them is independent of
   the §E feature work.
3. **`INTERSTITIAL` ad placement** intentionally has no renderer (would block
   UX). Decide whether it's wanted before building.
4. **Ad `embedHtml`** renders admin-provided markup on trust (same RBAC-gated
   trust boundary as other admin surfaces); consider sandboxing if third-party
   embeds become the norm.
