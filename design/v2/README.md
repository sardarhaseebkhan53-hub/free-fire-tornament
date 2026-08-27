# CLUTCHNEX — UI design set v2 (approved & locked)

**Status: APPROVED & LOCKED — 27 Aug 2026.** 22 concept screens covering all 30
requested surfaces. This set supersedes the v1 concepts in `../` wherever they
conflict; v1 remains for history only.

Open `index.html` for the review gallery.

## Non-negotiable rules baked into every screen

| Rule | Meaning |
|---|---|
| **Web / PWA only** | No Google Play or App Store badges, no APK buttons. Install CTAs read *INSTALL CLUTCHNEX*, *Install Web App*, *Add to Home Screen*, *Open CLUTCHNEX*. The footer states CLUTCHNEX is currently a web application / PWA. |
| **Currency** | PKR everywhere. All pricing is an admin-configurable default, never hard-coded. |
| **Financial honesty** | `Total Collection − Player Rewards = Platform Gross`, then payment costs, refunds, bonuses, referral costs, operating costs and taxes → **Estimated Net Profit**. Gross is never called net profit. |
| **No earnings promises** | Wallet, referral and tournament UI never imply guaranteed income. |
| **Manual money is manual** | Deposits and withdrawals always show a pending state until admin review; nothing is credited before approval. |
| **NEXA is informational** | The assistant cannot approve payments, change balances or results, approve withdrawals, reach admin data, or reveal unreleased room credentials. Always offers *Talk to Human Support*. |
| **One product** | Mobile is the responsive form of the same site — same colours, typography, cards, icon language and hierarchy. |

## Screens

| # | File | Covers |
|---|---|---|
| 01 | `01-desktop-home.png` | Desktop home, full nav, hero, install CTA, live tournament cards |
| 02 | `02-mobile-home.png` | Mobile home, header, drawer, bottom nav, PWA install sheet |
| 03 | `03-tournament-listing.png` | Tournament listing + Solo/Duo/Squad/Clash Squad filters |
| 04 | `04-tournament-details.png` | Tournament detail, prize distribution, rules, join panel |
| 05 | `05-login-register.png` | Login + registration |
| 06 | `06-player-dashboard.png` | Player dashboard and sidebar |
| 07 | `07-wallet-withdraw.png` | Wallet + withdraw |
| 08 | `08-manual-payment.png` | Manual payment (JazzCash / EasyPaisa / bank) |
| 09 | `09-teams.png` | Team management + team detail |
| 10 | `10-matches-results.png` | Matches (room credential release) + results |
| 11 | `11-leaderboard.png` | Leaderboard with podium and tabs |
| 12 | `12-winners.png` | Winners / champions |
| 13 | `13-referral-support.png` | Refer & Earn + support centre |
| 14 | `14-nexa-pwa.png` | NEXA assistant + PWA install section |
| 15 | `15-admin-dashboard.png` | Admin dashboard + KPIs and charts |
| 16 | `16-admin-tournament-builder.png` | Tournament builder wizard + profit calculator |
| 17 | `17-admin-financial.png` | Financial dashboard, gross → estimated net |
| 18 | `18-admin-deposits-withdrawals.png` | Deposit + withdrawal review queues |
| 19 | `19-admin-results-users.png` | Result verification + user management |
| 20 | `20-blog-seo.png` | Blog + SEO landing pages |
| 21 | `21-settings.png` | Player settings |
| 22 | `22-mobile-responsive-set.png` | Mobile dashboard, wallet, leaderboard, tournament detail |

## Implementation

The Next.js app implements this set. Any change to the locked design needs
explicit approval before code changes.
