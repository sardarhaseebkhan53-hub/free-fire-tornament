# CLUTCHNEX — Tournament Entry Structure (Free Fire)

This document describes exactly how a player takes entry in every Free Fire mode on
the platform, what the system enforces server-side, and what is needed to support
modes that are not modelled yet (Lone Wolf, Clash Squad 1v1).

> Status summary
> - **Works today:** Solo, Duo, Squad, Clash Squad (4v4).
> - **Supported as free-agent/admin-paired:** Duo, Squad, Clash Squad.
> - **Planned / needs code + schema work:** Lone Wolf, Clash Squad 1v1,
>   Big Head, Ranked/points rooms — see “Adding a new mode”.

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

## 6. Adding “Lone Wolf” and “Clash Squad 1v1”

The current schema only models `SOLO`, `DUO`, `SQUAD`, `CLASH_SQUAD`. To add new
Free Fire modes you must add them in **all** of these places (an incomplete change is
the usual cause of “the option is missing” or “registration blocked”).

### 6.1 Backend / Prisma

1. `backend/prisma/schema.prisma`
   - Add `LONE_WOLF`, `ONE_V_ONE` (or `CLASH_SQUAD_1V1`) to `enum TournamentType`.
   - If a new mode needs its own team model (1v1 has no team), decide whether to reuse
     the independent/free-agent path or add a `Roster`-style model.
   - Create a migration, e.g. `20260901000000_lone_wolf_and_1v1/migration.sql` with:
     ```sql
     ALTER TYPE "TournamentType" ADD VALUE IF NOT EXISTS 'LONE_WOLF';
     ALTER TYPE "TournamentType" ADD VALUE IF NOT EXISTS 'CLASH_SQUAD_1V1';
     ```
2. `backend/src/services/tournament.service.ts`
   - Extend `const TEAM_SIZE` (`LONE_WOLF: 1`, `CLASH_SQUAD_1V1: 1`).
   - Extend the `isIndependent…` guards if the mode allows no-team entry.
3. `backend/src/services/tournament-economics.service.ts`
   - Extend the same `TEAM_SIZE` and `type` union used for prize/economics math.
4. `backend/src/services/public.service.ts`
   - Extend `teamSize` and `entryFeePerTeam` calculations.
5. `backend/src/validation/admin.schema.ts`
   - Extend `createTournamentSchema.type` (`z.enum([...])`).
   - If pairing applies, extend `teamPairSchema` constraints.
6. `backend/src/validation/public.schema.ts` / `routes/public.routes.ts`
   - Extend the mode filter whitelist (`['SOLO','DUO','SQUAD','CLASH_SQUAD',…]`).
7. `backend/src/services/slot.service.ts`
   - Extend `pairIndependentTeam` allowed modes if 1v1/free-agent pairing is needed.
8. `backend/src/services/nexa.service.ts` — update the “four modes” answers if mode
   names change.

### 6.2 Frontend

1. `frontend/src/lib/format.ts` — extend `MODE_LABEL`.
2. `frontend/src/lib/types.ts` — extend the mode union if it is typed.
3. `frontend/src/app/(public)/free-fire-tournaments/page.tsx`,
   `frontend/src/app/(public)/tournaments/page.tsx`, `frontend/src/app/(public)/page.tsx`
   — add mode card/filter entries.
4. `frontend/src/app/(admin)/admin/tournaments/new/page.tsx` — add the mode option.
5. `frontend/src/components/join-tournament.tsx` — set the mode label / team size /
   independent flags for the new modes.
6. SEO pages: `/tournaments/lone-wolf/page.tsx`, `/tournaments/clash-squad-1v1/page.tsx`
   (mirror `solo/page.tsx`).

### 6.3 Recommended entry design for the new modes

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
