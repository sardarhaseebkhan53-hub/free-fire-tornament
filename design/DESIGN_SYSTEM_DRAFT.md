# CLUTCHNEX Design System — v1.0 LOCKED (user-approved 2026-08-26)

> Approved concept set: `design/01–42`. All implemented UI must conform to this system.

## Color palette
| Token | Value | Usage |
|---|---|---|
| `bg-base` | `#070A14` (obsidian) | App background |
| `bg-surface` | `#0D1220` (deep navy) | Cards / sections |
| `bg-elevated` | `#131A2E` (dark graphite) | Elevated panels, tables |
| `border-subtle` | `rgba(255,255,255,0.08)` | 1px glass borders |
| `accent-primary` | `#8B5CF6` electric violet | Primary buttons, links, active states |
| `accent-primary-glow` | `rgba(139,92,246,0.35)` | Soft glows, focus rings |
| `success` | `#10B981` emerald | Success, credited, verified |
| `reward` | `#F5B942` gold | Prizes, winnings, 1st place |
| `danger` | `#EF4444` red | Errors, ban, live dot |
| `info` | `#3B82F6` blue | Informational |
| `warning` | `#F59E0B` amber | Pending states |
| `text-primary` | `#F4F6FB` | Headings |
| `text-secondary` | `#98A2B8` | Body / secondary |
| `text-muted` | `#5D6B85` | Captions |

## Typography
- Display/headings: **Space Grotesk** (700/600)
- Body/UI: **Inter** (400/500/600)
- Scale: 12, 14 (body), 16, 18, 20, 24, 30, 36, 48, 64 px
- Numeric (stats/countdowns): tabular-nums

## Shape & elevation
- Radius: cards `16px`, inputs/buttons `10px`, pills `999px`, modals `20px`
- Shadows: soft, low-opacity black; violet glow only on primary CTAs
- Glassmorphism: `bg-white/[3%]` + `backdrop-blur` + 1px `border-subtle`

## Components (shared, no per-page styles)
Button (primary/outline/ghost/danger, loading state) · Input/Select/Textarea (labels, icons, error text) · Card · Modal · Drawer · Toast · Badge (LIVE / VERIFIED / status pills) · Avatar · TournamentCard · TeamCard · WalletCard · TransactionRow · Countdown · LeaderboardRow · DataTable (card mode on mobile) · Pagination · FileUpload dropzone · EmptyState · ErrorState · LoadingSkeleton · ConfirmDialog · NEXA chat widget · WhatsApp FAB

## Navigation
- **Public desktop:** sticky glass navbar — logo, Home, Tournaments, Leaderboard, Teams, Results, Blog, Support + Login/Register (logged-in: wallet chip, bell, profile menu)
- **User app:** slim left sidebar (Dashboard, My Matches, Wallet, Teams, Referrals, Notifications, Support, Settings) collapsing to icon rail then bottom nav
- **Admin:** protected dark sidebar (Dashboard, Users, Tournaments, Matches, Results, Deposits, Withdrawals, Revenue, Support, Blog, Ads, SEO, Settings, Audit Logs)
- **Mobile/PWA:** bottom nav — Home, Tournaments, Matches, Wallet, Profile

## Motion
Framer Motion, sparingly: page fade/slide, card entrance stagger, hover lift, button press scale, toast slide-in, animated counters, countdown ticks, skeleton shimmer. All gated behind `prefers-reduced-motion`.

## States
- Loading: skeleton cards/tables, button spinners
- Empty: icon + line of context + primary action
- Error: friendly message + retry; error codes like `INSUFFICIENT_BALANCE` mapped to human text

## Responsive breakpoints
`320 / 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920 px` — mobile is intentionally designed (bottom nav, stacked cards, card-mode tables), never compressed desktop.
