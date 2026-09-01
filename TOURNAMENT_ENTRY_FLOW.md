# CLUTCHNEX — Full Tournament Structure & Entry Flow

This is the complete, authoritative structure for how a tournament works and how a
player takes entry. It covers the whole lifecycle from creation to payout, every
playable Free Fire mode, the team/free-agent paths, seat allocation, rooms,
check-in, results and refunds.

> Supported modes (all fully working):
> - Solo
> - Duo
> - Squad
> - Clash Squad (4v4)
> - **Lone Wolf** (1 player per seat, direct solo entry)
> - **Clash Squad 1v1** (1 player per seat, direct solo entry)

---

## 1. High-level lifecycle

```
Admin creates tournament
        │
        ▼
[DRAFT]  ──publish──▶ [REGISTRATION_OPEN] ──▶ [LIVE] ──▶ [COMPLETED]
        │                     │                   │
        │                     └──▶ [CANCELLED]    └──▶ [CANCELLED]
        │
        ▼
Players join → seats assigned → wallet debited
        │
        ▼
Matches scheduled → rooms created → credentials released
        │
        ▼
Check-in → game played → results entered → publish results
        │
        ▼
Prizes credited to Winning balance → users withdraw
```

---

## 2. Tournament creation (admin)

Only an admin/super-admin can create a tournament. The form collects:

| Field | Purpose |
|---|---|
| Title + slug | Public name and URL |
| **Type** | `SOLO`, `DUO`, `SQUAD`, `CLASH_SQUAD`, `LONE_WOLF`, `CLASH_SQUAD_1V1` |
| Description, map, banner, rules | Public display |
| Entry fee per player | Cost per player (always server-authoritative) |
| Max slots | Total seats (players in 1p modes; teams in team modes) |
| Min slots to start | Minimum to be able to run |
| Prize pool + placement/kill/MVP prizes | Published payout plan |
| Points per kill, placement points, bonus/penalty | Scoring rules |
| Start time, registration deadline, end time | Timing |
| Room ID / password / release window | Match-room or event-room credentials |
| Publish | Yes → `REGISTRATION_OPEN`, No → `DRAFT` |

The backend **computes economics server-side** (`computeEconomics`). If the setup is
loss-making, the admin must explicitly confirm before publishing.

---

## 3. Tournament statuses

| Status | Meaning | Can players join? |
|---|---|---|
| `DRAFT` | Saved, not public | No |
| `REGISTRATION_OPEN` | Open until deadline / full | Yes |
| `LIVE` | Started | No (only cancellations handled by support) |
| `COMPLETED` | Finished, results published | No |
| `CANCELLED` | Cancelled | No, refunds issued |

A tournament is also considered **closed** once:
- `registrationDeadline` passes, OR
- `startTime` is reached, OR
- all `maxSlots` are filled, OR
- status is not `REGISTRATION_OPEN`.

---

## 4. Entry prerequisites (checked on EVERY join)

The backend re-validates all of these inside the join transaction. The UI can never
show a paid successful entry that the server later refuses.

| Requirement | Failure |
|---|---|
| Signed in | `Account is not active.` |
| Account status = ACTIVE | `Account is not active.` (email confirmation is optional and never blocks a join) |
| Tournament exists, not draft | `Tournament not found` |
| Status = `REGISTRATION_OPEN` | `Registration is not open for this tournament.` |
| Before registration deadline | `Registration deadline has passed.` |
| Before start time | `This tournament has already started.` |
| Seat available | `This tournament is full.` |
| Valid Free Fire UID (5–15 digits) | `A valid Free Fire UID (5-15 digits) is required to join.` |
| Valid IGN (2–24 chars) | `Your Free Fire nickname (2-24 characters) is required to join.` |
| Wallet cash balance ≥ entry share | `Not enough PKR balance…` |

---

## 5. Mode-by-mode entry structure

### 5.1 Solo
- **Seat = 1 player**
- Direct solo entry, no team/captain.
- Player confirms UID + IGN, pays `entryFeePerPlayer`, gets one seat.

```
Player → POST /tournaments/join {slug, UID, IGN}
       → wallet DEBIT(entry)
       → TournamentRegistration(status=CONFIRMED, seat=#N, teamId=NULL)
```

### 5.2 Lone Wolf
- **Seat = 1 player** (same as Solo, separate mode + SEO page).
- Direct solo entry, no team/captain.
- No pairing, no invite.

```
Player → confirm UID + IGN → pay entry → seat #N
```

### 5.3 Clash Squad 1v1
- **Seat = 1 player**.
- Direct solo entry, no team/captain.
- Head-to-head format is set up by the admin in the match/bracket plan.

```
Player → confirm UID + IGN → pay entry → seat #N
```

### 5.4 Duo
- **Team size = 2**, seats counted per team.

**Option A — full duo (captain registers)**
1. Captain creates a `DUO` team in Teams and invites one partner.
2. Partner accepts invite.
3. Captain picks the duo, server verifies:
   - captain logged in
   - team type = `DUO`
   - team has exactly 2 members
   - all members ACTIVE + verified
   - all members have saved UID + IGN
4. Server locks the roster, debits **both** players, assigns one shared seat.

**Option B — free agent (register solo, admin pairs)**
- Enabled by `tournament.allowIndependentDuo` (default ON).
- A player with no full duo registers alone, pays only their share, gets `teamId=NULL`.
- Later an admin runs **Slots → Pair** to combine 2 independent registrations into a
  real `DUO` team; the first registration becomes captain; all players are notified.

### 5.5 Squad
- **Team size = 4**, seats counted per team.

**Option A — full squad (captain registers)**
- Same as Duo but with 4 members.

**Option B — free agent**
- Enabled by `tournament.allowIndependentSquad` (also covers Clash Squad).
- Register alone, get paired into a `SQUAD` team by admin (4 independent regs).

### 5.6 Clash Squad (4v4)
- **Team size = 4**, handled exactly like Squad.
- Supports both full-team captain registration and independent/free-agent entry +
  admin pairing.

---

## 6. What happens inside a join (single DB transaction)

```
1. Lock tournament row                    → prevents double seat/double charge
2. Re-read + lock team (if team mode)     → roster cannot change mid-join
3. Double-join guard (unique constraint)  → one entry per user per tournament
4. Atomic slot guard:
     UPDATE tournaments SET registeredSlots = registeredSlots + 1
     WHERE id = ? AND status='REGISTRATION_OPEN'
       AND registrationDeadline > now()
       AND registeredSlots < maxSlots
   → assigns the next free seat
5. Coupon validation (if used)
6. Wallet ledger debit for every paying member
     ENTRY_FEE  CASH → DEBIT
7. Create / revive TournamentRegistration rows
   - entryAmount, coupon, walletTxId, seatNumber
   - teamId (team modes) or NULL (solo-style / free agent)
   - rosterUserIds snapshot (team modes only) — frozen for prize payout
8. Notification + audit log
9. Commit
```

If ANY step fails, the transaction rolls back — no seat taken, no money charged.

---

## 7. Seat / slot rules

- Seats start at 1 and go to `maxSlots`.
- Solo-style modes (`SOLO`, `LONE_WOLF`, `CLASH_SQUAD_1V1`) = 1 player per seat.
- Team modes (`DUO`, `SQUAD`, `CLASH_SQUAD`) = 1 seat per team; all members share it.
- Seat numbers are server-assigned and never reused while the tournament is full.
- Admin can move/lock seats from the Slot Board. A locked seat is not auto-assigned.
- Independent/free agents get their own seats with `teamId=NULL` until an admin pairs them.

---

## 8. Wallet & payments

- Deposits are manual: player submits TID + screenshot, **admin approves**.
- On approval, funds credit the **CASH** bucket.
- Every join debits **CASH** with a `ENTRY_FEE` ledger entry (immutable ledger).
- Team modes debit **each member** their own share; all-or-nothing rollback.
- Refunds credit CASH via `ENTRY_REFUND`.
- Winnings credit **WINNING** bucket via `WINNING` ledger entry.
- Payout guard: each prize/wallet credit is one-time-guarded.

---

## 9. Match scheduling & rooms

1. Admin schedules matches for the tournament (match number, round, map, time).
2. Match participants are synced from confirmed registrations.
3. Room ID/password can be set per match or on the tournament (event room).
4. **Credentials are never public** — served only to confirmed seat holders.
5. Release timing:
   - default: 30 min before start (per-match rooms)
   - event room: `tournament.roomReleaseMinutes` (default 5 min)
   - admin can pin an exact release time or override per event
6. Room state is derived from timestamps on every read, so a missed scheduler tick is harmless.

---

## 10. Check-in

- The room/event can have a check-in window:
  - default opens at `registrationDeadline`, closes at `startTime`
  - or admin pins `checkInOpensAt` / `checkInClosesAt`
- Player checks in (or staff checks in at the desk) inside the window.
- If a seat holder does not check in before close, scheduler marks `noShowAt`.
- Only checked-in/confirmed seats play.

---

## 11. Results & payouts

1. Admin enters per-participant results:
   - placement, kills, bonus, penalty, prize, status (`REGISTERED/PLAYED/DISQUALIFIED`),
     ready, absent, evidence URL.
2. Workflow: `DRAFT → UNDER_REVIEW → CONFIRMED → PUBLISHED`.
3. Public results/winners are shown only after `PUBLISHED`.
4. Prize credit:
   - placement prizes, per-kill pool (capped), MVP, bonus
   - credited to **WINNING** balance
   - team-mode prizes are split per the frozen `rosterUserIds` snapshot
   - each credit is one-time-guarded

---

## 12. Cancellation & refunds

| Who | When | What happens |
|---|---|---|
| Player (solo-style) | Before deadline (or per policy) | Player refunded per `refundPercent` |
| Captain (team mode) | Before deadline (or per policy) | Whole team refunded, each member credited |
| Admin | Any time before/during | `CANCELLED`, everyone refunded per `refundPercent`, arena closed |

- `refundPercent` is per-tournament (default 100).
- If already started / results published, cancellation is handled by support.

---

## 13. Admin pairing (free agents)

```
POST /admin/tournaments/:id/pair { registrationIds: [...] }
```

- Only for `DUO`, `SQUAD`, `CLASH_SQUAD`.
- Requires exactly 2 (duo) or 4 (squad/clash) independent confirmed registrations.
- Creates a real team, first player becomes captain, attaches all regs,
  notifies every player, audits the change.
- Validates: same tournament, all confirmed, all ACTIVE, nobody already in a team.

---

## 14. Where each mode is defined

### Backend
| File | What it controls |
|---|---|
| `backend/prisma/schema.prisma` | `TournamentType` enum |
| `backend/prisma/migrations/20260901090000_lone_wolf_and_clash_1v1` | adds `LONE_WOLF`, `CLASH_SQUAD_1V1` |
| `backend/src/services/tournament.service.ts` | join engine, `TEAM_SIZE` |
| `backend/src/services/tournament-economics.service.ts` | pricing math, `TEAM_SIZE` |
| `backend/src/services/admin.service.ts` | tournament creation |
| `backend/src/services/public.service.ts` | public lists/detail, `teamSize` |
| `backend/src/services/slot.service.ts` | admin pairing, slot board |
| `backend/src/validation/admin.schema.ts` | admin create validation |
| `backend/src/routes/public.routes.ts` | mode filter whitelist |
| `backend/src/services/nexa.service.ts` | chatbot mode answers |

### Frontend
| File | What it controls |
|---|---|
| `frontend/src/lib/format.ts` | mode labels |
| `frontend/src/lib/types.ts` | mode type union |
| `frontend/src/components/join-tournament.tsx` | entry form + team/free-agent mode |
| `frontend/src/components/mode-landing.tsx` | mode landing configs |
| `frontend/src/app/(admin)/admin/tournaments/new/page.tsx` | mode dropdown |
| `frontend/src/app/(public)/tournaments/lone-wolf` | Lone Wolf landing |
| `frontend/src/app/(public)/tournaments/clash-squad-1v1` | CS 1v1 landing |
| `frontend/src/app/sitemap.ts` | SEO routes |

---

## 15. Common troubleshooting

**“I can’t register”**
1. Is status `REGISTRATION_OPEN`, before deadline, before start, seats left?
2. Are you signed in with an ACTIVE account? (email confirmation is optional)
3. Is your UID (5–15 digits) and IGN (2–24) present?
4. Do you have enough CASH balance (team modes charge every member)?
5. Duo/Squad/Clash: full team requires you to be **captain**; otherwise use the
   free-agent “register solo” path (if independent entry is enabled).
6. Read the actual server `VALIDATION_ERROR` — it names the exact problem.

**“Payment method disappeared / won’t appear”**
- Add Money reads only ACTIVE payment accounts.
- Manage them in **Admin → Payment Accounts**; editing/removing reflects immediately.

**“Admin dialogs / result editor overlap”**
- Entrance animations no longer keep a transform on ancestors after they finish,
  so `position: fixed` popups/modal sheets are no longer clipped or stacked.
