# CLUTCHNEX UI Concepts

**Status:** approval artifact only — no runtime/UI implementation is included.  
**Visual direction:** premium obsidian esports control center, not a framework rewrite.

These concepts preserve the existing Next.js App Router, React, Tailwind v4, Framer Motion and Lucide stack. They are intentionally designed as a coherent system for 320–1920px rather than separate desktop and mobile products.

## 1. Design north star

CLUTCHNEX should feel like a trusted competitive arena with a clear path from discovery to paid entry to verified payout:

1. **See the next opportunity** — mode, entry, prize, start time and seats are immediately scannable.
2. **Know what is verified** — status, result and payment states are explicit; no ambiguous success.
3. **Act in one confident step** — join, add money, upload proof, submit result and contact support have one primary action.
4. **Keep the money legible** — players see one PKR wallet; internal accounting buckets remain behind the scenes.
5. **Make every state humane** — loading, empty, error, offline, locked, pending and completed states are designed rather than left blank.

### Locked visual tokens

| Token | Direction |
|---|---|
| Base | `#070A14` obsidian |
| Surface | `#0D1220` deep navy |
| Elevated | `#131A2E` |
| Accent | `#8B5CF6` electric violet |
| Strong accent | `#7C3AED` |
| Success | `#10B981` |
| Reward | `#F5B942` |
| Danger | `#EF4444` |
| Text | `#F4F6FB`, secondary `#98A2B8`, muted `#5D6B85` |
| Display | Space Grotesk for headings, Inter for UI/body |
| Shape | 16px cards, 10px fields, pill statuses |
| Motion | 150–400ms ease-out; no bounce; reduced-motion fallback |

The existing glass treatment remains restrained: translucent panel, one-pixel highlight, subtle violet edge on hover, and no excessive neon glow. Reward gold is reserved for wins and confirmed value, not general decoration.

## 2. Information architecture

### Public navigation

`CLUTCHNEX` · Tournaments · Leaderboard · Winners · Blog · Support · Login / Register

- Desktop: compact top nav with one prominent **Find a tournament** action.
- Mobile/PWA: brand, search/tournaments icon and account/support icon in the top bar; avoid a crowded desktop nav.
- Every public page keeps the configured WhatsApp support action available without covering content or the bottom navigation.

### Player navigation

Dashboard · My Matches · Wallet · Teams · Tournaments · Profile · Support

- Mobile: the five most-used destinations are a bottom nav: Home, Matches, Tournaments, Wallet, Profile. Teams and Support stay in the drawer.
- Never label a real destination “Soon”; either ship the route or omit it until it exists.
- The balance chip shows **PKR available balance only**. Add money is a separate plus action.

### Admin navigation

Dashboard · Users · Tournaments · Matches · Results · Slots · Deposits · Withdrawals · Payment Accounts · Transfers · Financials · Revenue · Winners · Teams · Support · Fraud & Abuse · Blog · Ads · SEO · Settings · Audit Logs · Reports

- Desktop: fixed 256px rail with grouped sections and a visible `ADMIN` badge.
- Mobile: searchable drawer with section headers and a persistent page title/action row.
- Destructive/irreversible actions are visually separated, require a reason, and explain the immutable-history policy.

## 3. Core responsive patterns

- **320–479px:** single column, 16px page padding, horizontally scrollable chip rows, no data table without a card/list fallback.
- **480–1023px:** two-column cards where useful, drawer navigation, sticky primary action only when it does not cover the bottom nav.
- **1024–1439px:** sidebar + content, tables can show their full operational columns.
- **1440–1920px:** content max-width 1440px, KPI and operational panels breathe; do not stretch text lines across the whole monitor.
- All cards have an explicit minimum height only when it prevents layout shift. Skeletons mirror the real component.
- All controls have visible keyboard focus, 44px mobile touch targets, accessible names, and status text that is not color-only.

## 4. Concept A — public discovery and tournament detail

### Desktop home (1440px)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ CLUTCHNEX       Tournaments  Leaderboard  Winners  Blog  Support   Login  [Register] │
├──────────────────────────────────────────────────────────────────────────────┤
│ PLAY VERIFIED.  WIN WITH CONFIDENCE.                         [Find a tournament] │
│ Join skill-based Free Fire tournaments with verified rooms, fair results and PKR payouts. │
│                                                                              │
│  [LIVE NOW]  Bermuda Royale #22          [REGISTRATION OPEN]                 │
│  PKR 25 entry     PKR 5,000 prize       31/48 seats       Starts in 02:14:09 │
│  [View tournament]                                      [Enter the arena]   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Open arenas                 [Solo] [Duo] [Squad] [Clash Squad]               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ banner   │  │ banner   │  │ banner   │  │ banner   │                      │
│  │ title    │  │ title    │  │ title    │  │ title    │                      │
│  │ fee/prize│  │ fee/prize│  │ fee/prize│  │ fee/prize│                      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Verified results · Recent winners · How it works · FAQ                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Hero uses an existing tournament banner with a dark gradient; important facts remain HTML text and readable over the image.
- Cards show status, mode, entry fee per player, prize pool, seats, map and start time. Never imply an open join when the server says closed.
- Trust strip uses three compact facts: server-calculated scores, manual payment review, and published result gate.

### Mobile/PWA home (390px)

- 56px top bar with brand and tournament search.
- Hero collapses to title, prize, entry and one CTA; banner becomes a 180px crop.
- Horizontal “Open arenas” cards use snap scrolling and a persistent `View all` link.
- Bottom nav appears only for authenticated players; visitors keep the public footer.
- Install banner and WhatsApp/NEXA controls are offset above the safe-area bottom inset.

### Tournament detail page

Desktop is a two-column layout:

- **Hero / facts:** verified badge, mode, map, start/deadline countdown, registered/max seats, and a clear open/closed state.
- **Join card:** server-derived fee breakdown, coupon field, identity requirements, team selector only for team modes, and a confirmation summary before payment.
- **Tabs/sections:** Overview and rules, prize breakdown, scoring table, matches, participants/slots, and published results.
- **Results:** draft/under-review/confirmed states show “not published yet” rather than partial scores.
- **Private information boundary:** public participants can show approved public labels/avatar only; never payment data, email, phone, room password or unpublished evidence.

Mobile uses a sticky bottom **Join** bar while open, with the price and seats-left summary; the full breakdown opens as a sheet. After success, the receipt shows seat number, match, room unlock timing and a link to My Matches.

## 5. Concept B — 48-slot board

### Admin operations view

```text
┌─ Slots · Karachi Squad Cup ───────────────────────────────────────────────────┐
│ [All] [Available] [Locked] [Ready] [Absent]     Search player/team   [Refresh] │
│  Capacity 48     Filled 37     Locked 4     Unassigned 0     [Export]          │
├────────────────────────────────────────────────────────────────────────────────┤
│ 01  Ghost Duo [GHD]       CONFIRMED  ● ready       [Manage] [Lock]             │
│ 02  ───────────────────    AVAILABLE                [Assign]                   │
│ 03  Team Alpha             CONFIRMED  ◌ absent      [Manage] [Lock]             │
│ ...                                                                            │
│ 49+ never rendered for a 48-slot tournament                                    │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Use a 6×8 grid at desktop for the visual arena overview, with a synchronized detail table below/alongside for keyboard and screen-reader access.
- Slot card states: available, confirmed, locked, ready, absent, disputed, refunded. Each state has icon + text, not color alone.
- Lock/move/assign actions show the actor, previous occupant, new occupant and reason in a confirmation sheet. A seat number is never trusted from the browser.
- Team modes show team label and count the team as one seat; SOLO shows a player label. Independent DUO entries show `Awaiting pairing` and never pretend a team exists.
- Mobile switches to an ordered list with a compact occupancy rail and a bottom “Assign slot” action.
- Empty and race-conflict states explain that another admin changed the board and offer a refresh; never silently overwrite.

## 6. Concept C — player app

### Dashboard

Header: “Good evening, Haseeb” · verified badge · PKR balance chip · notifications.

Primary grid:

1. **Next match:** countdown, tournament, map, seat, credential unlock time, `Open My Match`.
2. **Continue your run:** current rank, points, wins, matches and progress to next tier.
3. **Open tournaments:** three cards with mode chips and fee/prize/slots.
4. **Wallet activity:** last three entries with pending/approved/credited states.
5. **Quick actions:** Add money, My Matches, Teams, Support.

On mobile, the next match is first, then `Join an arena`, then wallet and rank. No chart is shown when it adds no decision value.

### Wallet

One PKR hero card:

- Available balance = cash + winnings according to the approved product rule.
- Add money, Transfer, Withdraw actions.
- Supporting labels: pending deposits, withdrawable winnings and pending withdrawals, without presenting coins/bonus as PKR.
- Recent ledger list with date, type, signed amount, status and reference; filters on the transaction page.
- Add Money uses payment account cards, sender details, proof upload, and a review promise: “Balance changes after manual approval.”
- Withdrawal uses eligible balance, fee, net payout, masked destination and a clear pending/processing/paid/rejected timeline.
- Every financial error explains whether money moved; never show a generic “something went wrong” after a possible mutation.

### Profile

A real authenticated profile route with:

- avatar fallback, username/read-only account identifiers, full name, city and bio;
- Free Fire UID and IGN with uniqueness/validation feedback;
- public-profile toggle and preview of what other players can see;
- verified email state and resend action;
- password change and forgot-password entry point;
- session/security notice and support escalation.

Identity changes are saved before joining; the solo join sheet can link directly to the profile form and return to the tournament after success.

### Teams

- Team cards for one DUO and one SQUAD membership, captain/member role and capacity.
- Invite inbox, join-code copy/rotate, and explicit full-team readiness before registration.
- A paid/registered team shows membership lock or the supported replacement/refund path; it must not allow an untracked roster mutation.

## 7. Concept D — support and NEXA

### Support center

Three entry cards: FAQs, ticket, WhatsApp. Below, a ticket timeline with category, priority, last reply and current state. The composer supports a safe attachment with size/type guidance and a visible privacy note.

### NEXA sheet/widget

- Purple bot badge, “Assistant · always on,” quick replies and a concise message timeline.
- Persistent guardrail copy: “NEXA answers questions only — it cannot approve payments, change balances or share room IDs.”
- Quick replies: join a tournament, deposit status, withdrawal status, room unlocks.
- When uncertain, NEXA presents Support/WhatsApp escalation rather than inventing a financial or match outcome.
- Mobile is a near-full-height sheet; desktop is a 380px panel. It must not overlap the bottom nav, submit on Enter accidentally, or steal focus on page load.

## 8. Concept E — admin control center

### Shared admin shell

- Rail grouped as **Arena**, **Money**, **Players**, **Content**, **Trust**.
- Topbar: page title, global search, notification bell, admin identity and a compact environment/status indicator.
- Every table has loading skeleton, no-results state, server error retry, pagination and a mobile card view.
- KPI cards always include timeframe and source: Open tournaments, pending deposits, pending withdrawals, results to review, active players, net revenue.

### Admin dashboard

A dense but calm overview:

- KPI row: deposits awaiting review, withdrawals awaiting action, results awaiting review, live matches.
- Revenue/registrations chart with date range and plain-language empty state.
- “Needs attention” queue sorted by risk/age, not just newest.
- Activity stream with links to the entity and audit event.

### Users

Search/filter by username, role, status, verification and activity. Row actions: view profile, suspend/ban with reason and expiry, restore, audited wallet adjustment. Never offer physical delete. A user detail drawer shows public identity, team/tournament participation, balances as read-only summaries and linked financial/audit records.

### Tournaments

List cards/table with lifecycle, mode, start, seats, entry, prize, and results readiness. The create/edit builder is step-based:

1. identity and mode;
2. schedule/capacity;
3. economics preview and loss confirmation;
4. scoring snapshot;
5. prizes/matches/rooms;
6. review and publish.

Once registration or results begin, scoring/economics fields become visibly frozen or require a controlled versioned correction path.

### Matches and room management

Match list supports tournament/status/date filters. The manage drawer groups schedule, map, room credentials, credential-release time, notes, participants and evidence. Credential fields are masked by default and every reveal is explicit. Match status transitions show only legal next actions.

### Results review and publication

Split view: submissions queue on the left, evidence and server score preview in the center, publication workflow on the right:

`Draft → Under review → Confirmed → Published`

- Review actions require a reason for rejection/disqualification.
- The confirmation view shows scored rows, absent/disqualified rows, score formula snapshot and discrepancy warnings.
- Publish is disabled unless all required tournament matches satisfy the publication gate.
- Prize calculation shows total award, total wallet credit, rounding remainder and idempotency status before execution.

### Slots

The 48-slot concept above becomes the operational board. Admin assignment, move, lock, unlock, readiness and absence are explicit mutations with optimistic UI only after server confirmation.

### Deposits

Queue sorted by age/risk with filters for pending/approved/rejected, method and duplicate-proof signal. Review drawer shows proof image, amount, sender/TID, user history, duplicate hash warning and two distinct actions: Approve or Reject with note. Status and wallet ledger result appear in the same receipt.

### Withdrawals

Timeline columns: pending, approved, processing, paid, rejected. The drawer shows eligible balance at request time, masked destination, fraud signals and payout reference. State buttons are legal-transition-only; Reject explains the reversal entry.

### Payment accounts

Cards for active method destinations, account label, instructions, display order, limits and visibility. Edit history is auditable; no secret provider credential is rendered to the browser.

### Transfers, financials and revenue

- Transfers table links sender, recipient, request ID, amount, status and audit trail.
- Financials provides ledger reconciliation: deposits approved, entries, refunds, winnings credited, withdrawals paid, and unresolved variance.
- Revenue charts distinguish gross entries, prize liability, paid withdrawals and platform fee; date range/timezone is always shown.

### Winners, teams and leaderboard

- Winners table shows award kind, recipient, amount, status and credit ledger link; no manual overwrite of a credited award.
- Teams table shows type, captain, roster count, registration count, winnings and join-code rotation; private member fields are protected.
- Leaderboard page shows source and last recalculation; recalculation uses only the approved published/verified source set and reports stale rows removed.

### Support, fraud and audit

- Support: queue, SLA age, private conversation timeline, reply/resolve, attachment access.
- Fraud: risk score, duplicate payment proof, shared IP/device signal, repeated join failures and high-value transfer; each signal links to evidence without treating spoofable IP data as fact.
- Audit: immutable event search by actor/entity/action/date, before/after diff and request context. Financial and lifecycle mutations must not display a “success” state if the audit event is not durably recorded.

### Blog, ads, SEO and settings

- Blog editor has preview, markdown sanitization notice, draft/publish state and SEO fields.
- Ads manager uses image/provider presets rather than arbitrary executable HTML; preview is sandboxed or disabled.
- SEO manager previews title/description/canonical/OG fields and warns about noindex/private paths.
- Settings are grouped into Platform, Wallet, Tournament, Payments, Security and Support, with current value, allowed range, impact and audit history.

## 9. States and accessibility acceptance

Every concept must include:

- first-load skeleton that mirrors layout;
- empty state with a next action;
- recoverable network error with retry;
- permission-denied state without leaking record existence;
- stale-session state that sends the user to login after refresh fails;
- offline/PWA state with cached shell and no fake financial success;
- disabled/locked/pending state with an explanation;
- `aria-live` status for mutations, focus return for drawers/modals, Escape-to-close, and keyboard access to tables/actions;
- reduced-motion treatment and readable contrast for muted text, status pills and chart lines.

## 10. Approval choices

- **Approve all concepts:** implement the backend guardrails first, then this visual system screen by screen.
- **Approve with changes:** specify screens, labels, navigation or density changes.
- **Audit only:** keep this branch as the audit artifact and defer implementation.

Approval should also confirm whether the player-facing rule remains “one PKR wallet = cash + winnings” while bonus/coin buckets remain internal, and whether public participant labels/usernames are acceptable.
