# Admin payout desk + ranking by admin choice

Two operator problems, fixed end to end (API + admin panel):

1. **Withdrawals** — the admin panel only ever received the *masked* payout account
   (`0300••••201`), so the person sending the money could not read the number they
   had to pay. The payout desk now shows the **complete destination account**.
2. **Leaderboard / results** — confirming results demanded a placement *and* a kill
   count for **every** played participant
   (`Every played participant needs a placement and kill count before confirmation`).
   Ranking is now the admin's choice: only the players given a position are ranked.

---

## 1. Withdrawals — the complete account, plus everything needed to verify

`GET /api/admin/withdrawals` (ADMIN+ only) now returns, per request:

| Field | Why it is there |
| --- | --- |
| `accountNumber` | **the real number to pay** — never masked for admins |
| `accountName`, `accountDetails`, `methodLabel` | account title, bank/branch or linked phone |
| `user.{fullName, email, phone, freeFireUID, freeFireIGN, city, country, status, isVerified, joinedAt}` | identify the player before paying |
| `user.wallet.{cash, winning, bonus, locked}` | balances at review time |
| `history.{paidCount, paidTotal, pendingCount, openCount, rejectedCount}` | has this player been paid before? |
| `reviewedBy` | who already touched this request |

New/extended endpoints:

- `GET /api/admin/withdrawals?status&method&q&page&pageSize&format`
  `q` searches **username, email, phone, FF UID/IGN, account title, the full or
  partial account number and the payout reference** — paste the number you are
  about to pay and the request appears. `method` filters by wallet/bank.
- `GET /api/admin/withdrawals?format=csv` — payout sheet with complete account
  numbers (numbers are tab-prefixed so Excel/Sheets keep leading zeros).
- `GET /api/admin/withdrawals/:id` — full dossier: the payout card, player
  identity, wallet + payout history, **the immutable ledger entries behind this
  hold** (debit / reversal, with balances and references), the **audit trail**
  (who did what, when, from which IP) and the player's other withdrawals.

Player-facing responses are unchanged: `serializeWithdrawal()` only reveals the
raw number when called with `reveal = true`, which happens on the admin paths
alone (`/api/wallet/withdrawals` still returns `accountMasked` only).

Admin UI (`/admin/withdrawals`):

- the table shows the account title, the **full number** and bank/phone details,
  each with a one-tap **Copy** button, plus *Copy payout details* (a ready-to-paste
  block: player, amount, method, title, number);
- the Approve / Mark Processing / Mark Paid / Reject popup leads with a
  **"Send this payment"** card — amount, account title, full number, copy buttons —
  followed by the player's contact, wallet and payout history;
- **Full details** opens the dossier above;
- search + method filter + **Export CSV**, and a running "PKR x to pay on this page".

## 2. Results — a position is a choice, not a chore

Rules now enforced by the API (and explained on screen):

- A played participant **with** a position → ranked: placement points from the
  tournament's own table + kills × pointsPerKill + bonus − penalty, and eligible
  for prize money.
- A played participant **without** a position → **UNRANKED**: still listed
  everywhere (nothing hidden), `points = 0`, `finalScore = 0`, **no prize**.
- Kills, bonus and penalty are optional — a position alone is enough to rank.
- `Confirm results` and `Publish` require **at least one** ranked player, never all
  of them. The unranked list is written to the audit log
  (`MATCH_RESULTS_CONFIRMED → after.unranked`), so "who did the admin choose not to
  rank" is always answerable.
- Prize distribution follows the auto-calculated score **among ranked entries only**
  (placement, kill pool and MVP). A prize with no ranked recipient is simply not
  awarded — it is never re-routed to an unranked player.
- `matchStandings` / `tournamentStandings` return `ranked` and a `rank` that is
  `null` for unranked entries; the public results endpoint no longer invents a
  position for players who were never given one.

### Bug fixed on the way: a position could not be removed

`saveAdminResult` merged input with `input.position ?? participant.placement`, so
sending `position: null` silently restored the old value — "un-rank this player"
was impossible. `undefined` (field not touched → keep) and `null` (cleared → store
null) are now distinguished for placement/kills/bonus/penalty/prize, and clearing a
position resets points to 0 instead of leaving a stale score. The panel's `saveRow`
had the same collapse (`patch.placement ?? p.placement`) and now sends the patched
key verbatim.

Admin UI (`/admin/results` → *Publish & Prizes* → Enter Results, and `/admin/matches`):

- the Pos field is visibly optional (`—` placeholder, amber when empty, green when
  set) and the row is flagged **Unranked**;
- the workflow bar counts **n ranked / m unranked**, with *All · Ranked · Unranked*
  filters next to the search box;
- **UNRANK** removes a position in one click; Confirm/Publish lists the players
  without a position and asks once before settling them at 0 points;
- every row expands to **all details** — identity (username, FF name/UID, team),
  slot + lock, registration and entry fee, payment, ready/absent/DQ, position,
  kills/bonus/penalty, points, final score, prize, admin notes and evidence link
  (notes and evidence are editable there, and in the mobile sheet).

## Verification

- Backend: `npm test` → **423 passed** (33 files), including the new cases
  *positions are the admin's choice (partial ranking)* (confirm/publish with only
  some players ranked, pays only ranked players, refuses when nobody is ranked,
  clearing a position un-ranks) and *admin payout view* (full number + dossier for
  admins, masked for players, search by account number, CSV, payout history).
- Frontend: `tsc --noEmit` clean, `eslint` clean on the touched files, `vitest` 42 passed.
- Live API check through the Next proxy: `accountNumber: "03001112201"` on
  `/admin/withdrawals`, dossier + CSV + search by number, and a match confirmed and
  published with one unranked participant (`rank: null`, `points: 0`, `prize: null`).
