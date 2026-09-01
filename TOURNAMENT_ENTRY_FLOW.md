# CLUTCHNEX — Tournament Entry Structure (Free Fire)

This document describes exactly how a player takes entry in every Free Fire mode on
the platform, what the system enforces server-side, and what is needed to support
modes that are not modelled yet (Lone Wolf, Clash Squad 1v1).

> Status summary
> - **Works today:** Solo, Duo, Squad, Clash Squad (4v4), **Lone Wolf**, **Clash Squad 1v1**.
> - **Supported as free-agent/admin-paired:** Duo, Squad, Clash Squad.
> - **Lone Wolf / Clash Squad 1v1 are solo-entry modes** (1 player per seat,
>   no team/captain) and are fully implemented in backend, admin builder,
>   public mode landing pages and SEO routes.
> - **Planned / needs more work:** Big Head, Ranked/points rooms.

---

## 1. Common prerequisites (every mode)

A user can only take an entry when ALL of these are true. The backend re-checks every
one inside the join transaction, so the UI can never let someone pay for a seat the
server then refuses.

| Requirement | Where it is checked | Error the user sees |
| --- | --- | --- |
| Signed in with an ACTIVE account | `joinTournament()` → user.status | `Account is not active.` |
| Email verified | `joinTournament()` → user.isVerified | `Verify your email before joining tournaments.` |
| Tournament not DRAFT / deleted | `joinTournament()` | `Tournament not found` |
| Tournament in `REGISTRATION_OPEN` | `joinTournament()` | `Registration is not open for this tournament.` |
| Now before `registrationDeadline` | `joinTournament()` | `Registration deadline has passed.` |
| Now before `startTime` | `joinTournament()` | `This tournament has already started.` |
| Seat available | atomic `UPDATE ... registeredSlots < maxSlots` | `This tournament is full.` |
| Free Fire UID (5–15 digits) | `validateFFIdentity()` | `A valid Free Fire UID (5-15 digits) is required to join.` |
| Free Fire IGN (2–24 chars) | `validateFFIdentity()` | `Your Free Fire nickname (2-24 characters) is required to join.` |
| Enough PKR cash balance | wallet ledger | `Not enough PKR balance…` |

---

## 2. Mode-by-mode entry flow

### 2.1 SOLO (works today)

- **Team size:** `1`
- **Who joins:** any verified player.
- **How:** the user clicks **Join Tournament** → confirms UID + IGN (prefilled from
  profile) → pays `entryFeePerPlayer` from cash balance → receives seat #N.
- **No team, no captain, no invite required.**
- Seat/slot = 1 player.

```
Player → /tournaments/join { sportSlug, UID, IGN } → wallet debit → registration row → seat #N
```

### 2.2 DUO (works today)

- **Team size:** `2`
- **Two entry options:**

#### Option A — Full team (captain)
1. Captain creates a `DUO` team in **Teams** and invites one partner.
2. Partner accepts the invite.
3. Captain opens the tournament and selects **Register my duo**.
4. The server requires: captain is logged in, team type = `DUO`, team has exactly 2
   members, every member is ACTIVE + verified, every member has saved UID + IGN.
5. Server locks the roster, debits both players’ wallets (each pays their own share),
   and creates one seat (#N) shared by both registrations.

```
captain → POST /tournaments/join { teamId } → validate team(2) → debit 2 wallets → seat #N
```

#### Option B — Free agent / solo registration (admin-paired)
Used when `tournament.allowIndependentDuo` is enabled (default ON in seed, and the
code fallback is now ON too).
1. A player with no full DUO team clicks **Register solo · paired by admin**.
2. They confirm UID + IGN and pay `entryFeePerPlayer`.
3. They get their own seat and a `teamId = NULL` registration.
4. An admin later runs **Slots → Pair** (or POST `/admin/tournaments/:id/pair`) with two
   independent registrations. The service creates a real `DUO` team, sets the first
   player as captain, updates both registrations, and notifies them.

### 2.3 SQUAD / CLASH SQUAD (4v4) (works today)

- **Team size:** `4`
- Exactly the same two paths as DUO, but with 4 members and `allowIndependentSquad`
  (which also covers `CLASH_SQUAD`).

### 2.4 LONE WOLF (works today)

- **Team size:** `1`
- **Who joins:** any verified player.
- **How:** direct solo entry like SOLO, but listed as its own mode with its own
  SEO landing page (`/tournaments/lone-wolf`). Confirm UID + IGN and pay the
  per-player entry fee; one seat per player.
- **No team, no captain, no admin pairing.**

### 2.5 CLASH SQUAD 1V1 (works today)

- **Team size:** `1`
- **Who joins:** any verified player.
- **How:** direct solo entry like SOLO/LONE WOLF with its own landing page
  (`/tournaments/clash-squad-1v1`). Confirm UID + IGN and pay the per-player
  entry fee; one seat per player.
- **No team, no captain, no admin pairing.** Head-to-head format is determined
  by the admin’s match/bracket setup.

| Path | Who is allowed | What the engine does |
| --- | --- | --- |
| Full squad | Captain of a complete 4-player `SQUAD` team | verify team, freeze roster, debit 4 wallets, shared seat |
| Free agent | Any verified player | validate UID/IGN, debit that player only, `teamId = NULL`, admin pairs 4 later |

---

## 3. Important entry rules (why “only captain can register”)

- **Team modes are always captain-led** when a team is used. That is intentional:
  the captain is the single person who can confirm the roster, and the charge is
  distributed across every member server-side.
- A **non-captain member** of a full team cannot register the team. If they want to
  enter a DUO/SQUAD event they must either (a) become captain of a full team, or
  (b) register alone as a free agent when the independent setting is enabled.
- The join form now **defaults to free-agent/solo automatically** when a player opens
  a DUO/SQUAD/Clash Squad tournament and has no eligible captain team, so they are not
  blocked behind a captain-only wall.

### Settings that control team entry

| Setting | Default | Meaning |
| --- | --- | --- |
| `tournament.allowIndependentDuo` | `true` (seed) / `true` (code fallback) | Enable solo/free-agent entry for DUO + admin pairing |
| `tournament.allowIndependentSquad` | `true` (seed) / `true` (code fallback) | Enable solo/free-agent entry for SQUAD/Clash Squad + admin pairing |

Where to change: **Admin → System Settings** (the row stores `true`/`false`).
When disabled, a non-captain WITHOUT a full team gets `A DUO/SQUAD team is required`.

---

## 4. Seats, payments and pairing

1. **Seat allocation** happens inside one DB transaction with a row lock on the
   tournament. A conditional `UPDATE ... WHERE registeredSlots < maxSlots` is the
   real capacity guard; the smallest free seat 1..maxSlots is assigned.
2. **Ledger** is immutable. Each registration stores its own `entryAmount`,
   `walletTxId`, coupon, and (for team entries) an immutable `rosterUserIds` snapshot
   at the moment of payment. Prize distribution pays the snapshot, never the team’s
   live membership.
3. **Admin pairing** (`pairIndependentTeam`) only accepts 2–4 independent
   registrations and only for DUO / SQUAD / CLASH_SQUAD. It creates a team, marks the
   first registration as captain, attaches all regs to the new team, sends
   notifications, and writes an audit log.
4. **Cancellation:** solo = player cancels; team = only captain cancels the whole
   team; all refunds honour `tournament.refundPercent`.

---

## 5. Fixes included in this pass

| Problem | Fix |
| --- | --- |
| Removing/hiding a payment method in Admin did not remove it from Add Money | Add Money now loads the live active accounts from `GET /wallet/payment-accounts`; removed/hidden methods disappear immediately. |
| Admin modals / result sheets / payment-account dialogs overlay or clip | Page-transition and modal animations no longer leave a persistent `transform` on ancestors. A retained `transform` (even `translateY(0)`) makes an ancestor the containing block for `position: fixed` children, which is what caused the overlay. |
| User could not register a DUO/SQUAD/Clash Squad event unless they were a captain | Backend defaults `allowIndependentDuo`/`allowIndependentSquad` to ON, and the join form auto-switches a player with no eligible captain team to the free-agent/solo path. |

---

## 6. “Lone Wolf” and “Clash Squad 1v1” — IMPLEMENTED

These two modes are now real playable modes (1 player per seat). The migration and
all code touchpoints below are already in place; keep this list as the checklist when
adding any further mode (Big Head, Ranked rooms, etc.).

### 6.1 Backend / Prisma

1. `backend/prisma/schema.prisma` — enum has `LONE_WOLF` + `CLASH_SQUAD_1V1`.
2. Migration `20260901090000_lone_wolf_and_clash_1v1` adds the two enum values.
3. `backend/src/services/tournament.service.ts` — `TEAM_SIZE` includes both as `1`;
   the join engine automatically treats them as solo-style (no team/captain).
4. `backend/src/services/tournament-economics.service.ts` — `TEAM_SIZE` + union.
5. `backend/src/services/admin.service.ts` — builder type union.
6. `backend/src/validation/admin.schema.ts` — admin create enum.
7. `backend/src/routes/public.routes.ts` — public type-filter whitelist.
8. `backend/src/services/public.service.ts` — shared `MODE_TEAM_SIZE` used for
   `teamSize`, `entryFeePerTeam` and economics on both list and detail.
9. `backend/src/services/nexa.service.ts` — mode answers updated to six modes.

### 6.2 Frontend

1. `frontend/src/lib/format.ts` — `MODE_LABEL` includes the two modes.
2. `frontend/src/lib/types.ts` — mode union includes the two modes.
3. `frontend/src/components/mode-landing.tsx` — two new mode configs + FAQ.
4. Public pages: `/tournaments/lone-wolf`, `/tournaments/clash-squad-1v1`,
   filters on `/tournaments`, cards on `/`, `/free-fire-tournaments`, `/sitemap.xml`.
5. `frontend/src/app/(admin)/admin/tournaments/new/page.tsx` — dropdown options.
6. `frontend/src/components/join-tournament.tsx` — mode labels for the new modes.
7. `frontend/src/lib/seo.tsx` — event structured-data names for the new modes.

### 6.3 Entry design for the new modes

| Mode | Recommended model | Entry |
| --- | --- | --- |
| **Lone Wolf** | 1 player per seat, like SOLO | Solitary entry, no team, UID + IGN required. Add `LONE_WOLF: 1` to `TEAM_SIZE`. |
| **Clash Squad 1v1** | 1 player per seat, head-to-head brackets | Treat as 1v1 bracket; simplest is the SOLO/free-agent path with a single player per “slot”. |
| **Big Head / other casual BR** | Reuse `SOLO` semantics | Same as SOLO; only the public label and SEO copy differ. |

---

## 7. Quick troubleshooting for “I cannot register”

1. Is the tournament `REGISTRATION_OPEN` and before `registrationDeadline`/`startTime`?
2. Are you signed in, ACTIVE and email-verified?
3. Is your Free Fire UID (5–15 digits) and IGN saved in your profile, or filled into
   the join form?
4. Do you have cash balance for your share? Team registrations charge **every member**.
5. For DUO/SQUAD:
   - Full team: are you the **captain** and is the team exactly 2/4 members?
   - Free agent: is `tournament.allowIndependentDuo/Squad` enabled in System Settings?
6. Check the actual server response — `VALIDATION_ERROR` carries the precise reason
   (e.g. “A duo team is required…”, “Every team member must set their Free Fire UID…”).
