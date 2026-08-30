# Phase 20 — Tournament Room management (Room ID / password, released on a clock)

Admin Panel feature: an organiser can add, update, hide and cancel the **event's own**
custom room, and players holding a confirmed seat see the Room ID and password only inside a
configurable window before the match. Continues the credential machinery of `PHASE19_NOTES.md`
(per-*match* rooms), reusing its decisions rather than inventing a second security model.

---

## 1. The rule, in one paragraph

A room row holds `roomId`, `roomPassword`, an optional pinned `releaseAt`, an optional
per-event `releaseMinutes`, and the timestamps the four statuses are derived from
(`releasedAt`, `hiddenAt`, `cancelledAt`). **No read path trusts the cached `status` column**:
it resolves the state from the event's `startTime` and the release lead every time
(`resolveRoomState`), so moving a tournament's start time moves its room window with it — a
stored `AVAILABLE` could not survive that honestly. The scheduler tick only *proactively*
announces (in-app notification + push) and stamps `releasedAt`; correctness never depends on
it firing.

Release lead precedence, first match wins:

| # | Source | Where it is set |
|---|---|---|
| 1 | `room.releaseAt` — a pinned instant | admin room panel, "Or pin an exact time" |
| 2 | `room.releaseMinutes` — this event's lead | admin room panel, builder's "Minutes before start" |
| 3 | Setting `tournament.roomReleaseMinutes` | admin Settings page (runtime-editable, 30 s cache) |
| 4 | `ROOM_RELEASE_MINUTES` env | deployment, default **5** |

All four clamp to 0–1440 minutes. A lead is measured **backwards from the start instant**, so
a longer number unlocks earlier and `0` means "at the start", not "immediately" — pin an
instant if a room must go out sooner than its own window.

## 2. Statuses

`RoomStatus` = `NOT_ADDED` · `SCHEDULED` · `AVAILABLE` · `CANCELLED`, labelled verbatim as the
spec asks (`Room Not Added`, `Room Scheduled`, `Room Available`, `Room Cancelled`) by
`ROOM_LABEL`, which every read path uses so the admin panel, the player card and the audit log
cannot name the same state three different ways.

"Hiding" is **not** a fifth status: it is `hiddenAt`, and a hidden room reports `SCHEDULED`
with `hidden: true`. Cancel is not a deletion either — credentials stay on the row (never
served) so re-activating does not require retyping them under time pressure.

## 3. Where the security actually lives

| Requirement | Mechanism |
|---|---|
| Never exposed via API before release | `ROOM_FLAG_SELECT` (state columns + `roomId`, **no password**) on every list/detail payload; player values come only from `playerRoomView`, which includes them `if (state.unlocked)` and nothing else |
| No frontend-only hiding | `roomPublicView` has no credential field on its type; the payload a locked player receives cannot contain a value to hide |
| Release time + eligibility enforced on the backend | `isRoomEligible` (own CONFIRMED seat, or a CONFIRMED team the player belongs to; REFUNDED/CANCELLED/DISQUALIFIED never qualify) checked **before** any room metadata is read; a non-seat player gets a flat 403 |
| Only authorized admins mutate | `requireAuth` + `requireRole('ADMIN','SUPER_ADMIN')` + `adminWriteLimiter`, `no-store` on all three admin routes and the player room route |
| Cancel is recorded | `auditIn` rows `ROOM_UPDATED` / `ROOM_HIDDEN` / `ROOM_VISIBLE` / `ROOM_CANCELLED` / `ROOM_REACTIVATED`, always inside the mutating transaction |
| Password never in a log | audit metadata records `roomId` and `passwordChanged: boolean` — never the value |

Two defects the tests caught, and the fixes they forced (both are load-bearing, not style):

1. **Spread-leaks.** `Tournament` originally carried the room columns, so three paths that
   `...spread` the row they were handed (`public.service.getTournamentBySlug`,
   `admin.service.listTournamentsAdmin`, `tournament.service.myRegistrations`) shipped
   `roomPassword` in the response. The room now lives in its own table (`tournament_rooms`,
   `tournamentId @unique`), those paths destructure `room` out of the row before spreading, and
   the *player* credential read is a separate endpoint. `myRegistrations` fetches room state via
   its own keyed `findMany` — there is no raw room row anywhere in that object graph.
2. **Rotated passwords never announced.** The release sweep filtered on
   `status: { in: ['NOT_ADDED','SCHEDULED'] }`, but an in-window save caches `AVAILABLE` with
   `releasedAt: null`, so a new password was never notified. The sweep filters on
   `releasedAt: null` alone: *announce each set of credentials exactly once*.

## 4. API

| Method & path | Auth | Returns |
|---|---|---|
| `GET /api/admin/tournaments/:id/room` | ADMIN | `adminRoomView` — state + both values + effective config + per-match rooms |
| `PUT /api/admin/tournaments/:id/room` | ADMIN | upsert. Missing key = leave alone, `''`/`null` = clear; 409 once cancelled; 400 if both halves are emptied; rotating a credential resets `releasedAt` |
| `POST /api/admin/tournaments/:id/room/status` | ADMIN | `{action: HIDE\|SHOW\|CANCEL\|REACTIVATE, reason?}` — compare-and-set, idempotent, audited, fans out `ROOM_CREDENTIALS`/`TOURNAMENT_UPDATE` |
| `GET /api/tournaments/:slug/room` | player | `playerRoomView` — the **only** credential-bearing read; also claims the release once |
| `PUT /api/admin/settings` `tournament.roomReleaseMinutes` | ADMIN | the platform-wide lead |

`GET /api/tournaments/:slug` and `/api/tournaments/my` carry a credential-free `room` view so
the player UI shows *state and timing* without a second request.

## 5. UI

- `/admin/tournaments` — a **Room** column (pill, plus "in 4:12" while scheduled) and a
  **Room** button per row opening `TournamentRoomPanel`: values, lead, pin, note, Hide/Show,
  Cancel-with-reason/Re-activate, and the per-match rooms listed underneath so an admin can
  tell which room a player is looking at.
- `/admin/tournaments/new` — optional "Custom room" block in the Schedule step; nothing is
  sent unless something was typed.
- `/tournaments/[slug]` — `TournamentRoomCard`: `Hidden` rows, a live countdown to the release,
  real values + copy/reveal when unlocked, the cancel reason when cancelled. It arms one timer
  for `releaseInMs` so the page unlocks without a reload, and offers "Check again" for tabs that
  slept through the moment.
- `/dashboard` — the next-event card's room line reads the server's state instead of a
  hardcoded "30 minutes before start".
- `/admin/audit-logs` — a `ROOM` filter chip; `ROOM_CANCELLED` reads danger, `ROOM_VISIBLE`
  success, `ROOM_HIDDEN` warning.
- The save diff is `src/lib/room-form.ts` (pure, 13 tests) because "blank box" versus "untouched
  box" is exactly the distinction that decides whether a live password survives a save.

## 6. Verification

| Gate | Result |
|---|---|
| `backend` `npx tsc --noEmit` | ✅ 0 errors |
| `backend` `npx vitest run` | ✅ **384 / 384** (27 files) — 51 of them room tests |
| `tests/unit/room.test.ts` | ✅ 20: resolver precedence, lead direction, hidden/cancelled/event-cancelled branches, `roomPublicView` shape, `roomCreateColumns`, `effectiveReleaseMinutes` clamping |
| `tests/integration/tournament-room.test.ts` | ✅ 31, over real HTTP + the dev seed's 19 migrations: §A authorization (401 / player-and-moderator 403 / no mutation), §B add-update-hide-clear-conflict, §C release timing incl. the boundary observed with a real 1.2 s wait against a pinned instant, §D audience (unregistered 403, cancelled 403, refunded 403), §E cancel semantics + audit, §F notification once-per-credential-version, §G per-event isolation of overrides, §H the scheduler sweep, §I the error contract |
| `frontend` `tsc --noEmit` / `eslint` / `npx next build` | ✅ 0 errors (only the 3 pre-existing `sw.js` warnings) / build green |
| `frontend` `npx vitest run` | ✅ 31 / 31 (13 new) |

**Requirement 8 mapped:** before release (§C), exactly at release (§C boundary test), after
release (§C + §H), unregistered user (§D), registered user (§D), cancelled room (§D + §E),
updated credentials (§B + §F), admin authorization (§A).

## 7. Deliberate limits

- The room is per **event**, not per match or per round. Multi-round events keep using
  `Match.roomId` + `credentialsReleaseAt` (Phase 19); the admin panel lists both so nobody
  confuses them, and the event room is what a single-lobby event needs.
- `roomId` is present on admin list payloads and on the state-only views. It is *not* sent to
  players before release: `roomPublicView` carries no credential field, and the only path that
  could print it (`playerRoomView`) prints it inside the window.
- Hiding and cancelling never erase data. Erasing is what `''` in the save endpoint does, and
  it refuses to empty both halves.
- No new dependency, no new stack: existing Prisma/Postgres, `requireAuth`/`requireRole`,
  `Settings`, `Notification`/push, `auditIn`, and the Express module conventions throughout.
