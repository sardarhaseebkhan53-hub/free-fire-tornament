# Verification — Fixed Functions & New Modes

Date: 2026-09-01
Branch: `arena/01a05bac-free-fire-tornament`

## What was tested

| Area | Result |
| --- | --- |
| Backend typecheck (`npm run typecheck`) | ✅ passed |
| Frontend typecheck/lint (`next build`, `eslint`) | ✅ passed |
| Frontend production build (`npm run build`) | ✅ passed |
| Backend test suite (`npm test`) | ✅ 31 files / 400/400 passed |
| New mode tests (`lone-wolf-and-1v1.test.ts`) | ✅ 3/3 passed |
| Independent squad regression (`independent-squad.test.ts`) | ✅ 2/2 passed |
| Economics mode table (`economics.test.ts`) | ✅ 11/11 passed |
| Runtime API smoke: `GET /api/public/tournaments?type=LONE_WOLF` | ✅ returns published event |
| Runtime API smoke: `GET /api/public/tournaments?type=CLASH_SQUAD_1V1` | ✅ returns published event |
| Admin API create LONE_WOLF / CLASH_SQUAD_1V1 | ✅ both published |

## Fixed functions

1. **Payment method removal now syncs to the user panel**
   - Add Money loads active accounts from `GET /api/wallet/payment-accounts`.
   - Deleting / hiding a method in Admin immediately removes it here.

2. **Tournament registration for team modes + new modes**
   - Duo/Squad/Clash Squad: non-captain players can register as free agents and be
     admin-paired (independent entry is default-on).
   - Solo, Lone Wolf, Clash Squad 1v1: direct solo entry with no team/captain.

3. **Admin UI overlay / overlap**
   - Entrance animations no longer leave a `transform` on ancestors after finishing,
     so admin dialogs, match-result editors and payment-account forms no longer clip
     or overlap.

4. **Lone Wolf mode added**
   - Schema enum, join engine, economics, admin builder, public filter, mode landing,
     SEO route, sitemap.

5. **Clash Squad 1v1 mode added**
   - Schema enum, join engine, economics, admin builder, public filter, mode landing,
     SEO route, sitemap.

## New modes entry structure

- **Lone Wolf:** 1 player per seat. Direct entry, confirm FF UID + IGN, pay entry.
- **Clash Squad 1v1:** 1 player per seat. Direct entry, confirm FF UID + IGN, pay entry.
- Both are teamless by design — no invite, no captain, no pairing step.

## Verification previews

These are labeled UI previews generated in this sandbox because installing a real
headless browser (Chromium download) was blocked by the sandbox network. The behavior
is covered by the passing API/build/test suite above.

| File | Function |
| --- | --- |
| `add-money-payment-methods-fixed.png` | Add Money shows only active admin-configured methods |
| `payment-accounts-admin-sync-fixed.png` | Admin Payment Accounts → user panel sync |
| `lone-wolf-entry-fixed.png` | Lone Wolf direct solo entry |
| `clash-squad-1v1-entry-fixed.png` | Clash Squad 1v1 direct solo entry |
| `admin-new-tournament-modes-fixed.png` | Admin builder offers Lone Wolf / Clash Squad 1v1 |
| `admin-result-editor-no-overlay-fixed.png` | Match result editor without overlay/clipping |
