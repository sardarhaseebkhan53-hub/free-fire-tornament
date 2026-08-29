# CLUTCHNEX — Master UI/UX Upgrade Report

**Date:** 2026-08-29 · **Scope:** full frontend audit + targeted upgrade (no backend/API/DB changes, no broken flows)

---

## 1. What was audited

Full inventory of `frontend/src` — components (23), public pages (16), app pages (12), admin pages (24), layouts (3), global CSS, navigation (navbar + bottom nav), footer, tournament cards, leaderboard, wallet, auth, admin shell, modals/drawers, tables, forms, icons, fonts, animations, loading/error/empty states.

**Already strong (left intact):** glass design system, card-hover glow, skeleton shimmer, focus-visible rings, `overflow-guard`, `overflow-x: clip` safety net, bottom nav with safe-area, admin mobile drawer, table `overflow-x-auto` wrappers, reduced-motion global block, premium wallet balance hero.

## 2. UI Improvements

| Surface | Change |
|---|---|
| **Footer** | Real brand icons — WhatsApp, **Discord (new)**, Instagram, YouTube, Facebook, TikTok (official simple-icons glyphs, zero deps). 44px touch targets, hover glow, configurable links via `social.*` settings keys with safe fallbacks |
| **Home hero** | Free Fire arena artwork layer (`/art/hero-arena.jpg`, 16% opacity) + gradient scrim under the aurora atmosphere; shimmering gradient headline; floating live-match glass card (real tournament data, live countdown, animated seat bar); recent-wins ticker; trust strip |
| **Mode cards** (home + hub) | Per-mode Free Fire artwork backgrounds (`mode-solo/duo/squad/clash.jpg`) with hover zoom + violet glow icon chips |
| **Tournament cards** | Shimmering gold prize text (`gold-text`), animated seat bar (`bar-fill`, GPU scaleX), press feedback on CTAs |
| **Leaderboard** | **Top-3 podium** (🥇🥈🥉 order 2nd·1st·3rd, gold/silver/bronze rings, hover lift) above the existing compact rows (mobile already card-optimized) |
| **Winners** | Gold shimmer on prize amounts; per-row scroll reveal |
| **Auth pages** | Fixed `auth-bg.jpg` artwork + gradient scrim behind the glass cards (login & register) |
| **Mobile navbar** | **New hamburger menu** — animated slide-down glass panel with all nav links, active-state dot, Login/Register or Dashboard/Logout actions; closes on link tap and Escape |

## 3. Responsive Improvements

- **Zero unintended horizontal scroll** verified structurally: `img/svg/video { max-width:100% }` global safety net added; all tables confirmed inside `overflow-x-auto` wrappers (wallet transactions, admin kit, match-table); NEXA sheet is `inset-x-3` bounded; bottom nav uses safe-area inset.
- Mobile menu targets: 44px hamburger/search/bell (was 40px), 46px menu rows, 44px footer social circles.
- Fluid display scale utility (`clamp`) + `text-wrap: balance/pretty` for headings and body.
- Admin drawer already `max-w-[85vw]`; leaderboard podium uses 3-col grid that fits 320px (scales to 5-col rows on `sm+`).
- Podium `order-first/order-last` keeps 🥇 center on all widths; truncation everywhere (no text collision).

## 4. Animation Improvements (all fast, GPU-friendly, reduced-motion aware)

- **Global keyframes** added to the design system: aurora drift ×3, gradient-shift, gold-shimmer, ticker marquee, float-y, blink, live-ping, bar-grow, toast-in, menu/drawer reuse.
- **`Reveal` component** (IntersectionObserver, one-shot, stagger via `delay`) wired into: home sections (modes/steps/why/rankings/referral/FAQ), tournaments index (staggered cards), Free Fire hub (mode cards + featured), winners, leaderboard headings.
- **Micro-interactions:** `.press` (hover brighten + 0.96 press scale, 120ms) on CTAs, bottom nav, FAB, auth buttons, footer socials; live-dot pulse on LIVE badges; seat-bar fill animation; image zoom on card/mode hover (500ms, transform-only).
- Page renders `--animate-*` tokens; everything respects the existing `prefers-reduced-motion: reduce` global override (reveals become visible instantly).

## 5. Interaction Improvements

- **New Toast system** (`ToastProvider` + `useToast`, aria-live, auto-dismiss 4s, hover-pause, dismiss button, top-center mobile / bottom-right desktop, max 4 visible) — mounted app-wide in the root layout and wired into: team create (shows the join code), join-by-code, invite, transfer, remove, leave, join-code copy, code rotation.
- **All social/footer links are real links** (`wa.me`, Discord/Instagram/YouTube/Facebook/TikTok) with `aria-label`s; no dead buttons.
- Mobile menu is fully keyboard-accessible (Escape closes, `aria-expanded`/`aria-controls`, focus follows panel).

## 6. Performance Improvements

- All new animations are `transform`/`opacity`/`background-position` only — no layout thrash, no JS animation loops (CSS-driven), no particle systems.
- Reveal uses a single IntersectionObserver per element, unobserves after firing.
- Artwork: 6 locally-hosted images (69–240 KB each), lazy-loaded everywhere except hero art, no external hotlinks.
- Brand icons are inline SVGs — zero new npm dependencies, tree-shaken by nature.
- No new client-side data fetching; all public pages remain server-rendered.

## 7. Accessibility Improvements

- `aria-label`/`title` on all social links and icon buttons; `aria-expanded` + `aria-controls` on the mobile menu; `aria-live="polite"` toast viewport; `role="status"` toasts.
- Keyboard: visible focus rings retained, Escape closes menu; menu links are real `<Link>`s.
- Touch: 44px minimum targets on new controls; `touch-action: manipulation` on pressables.
- Reduced motion fully honored (global override + reveal instant-show).
- Zoom is not disabled (`viewport` allows scaling).

## 8. Real Device Testing

⚠️ **No physical device was available in this environment. The Tecno Spark 10C class (360×800, portrait/landscape) was tested via SIMULATED responsive engineering only:** all breakpoints 320/360/375/390/412/430/480/600/768/900/1024/1280/1366/1440/1920 reviewed against the code (fluid grids, clamp type, truncation, overflow wrappers, safe-area insets), and every page rendered successfully through the dev server. **Physical-device testing is NOT claimed.** Recommended: run the live preview on a real Tecno Spark 10C to confirm feel, touch latency, and network behavior.

## 9. Remaining Issues / Next Steps

- **Physical-device pass** on Tecno Spark 10C (portrait + landscape) — the single most valuable next step.
- Bracket view: no bracket component exists on any page yet; when brackets ship, they need the mobile treatment described in the brief (horizontal scroll / round collapser) — flagged, not faked.
- Wallet/admin deeper polish (ledger row animations, KPI entrance) — global utilities exist and can be applied incrementally.
- Social URLs currently fall back to generic profile pages when not configured in admin settings — add `social.*` settings entries to point them at the real accounts.
- Hero artwork is stylized "battle royale" key art, not official Free Fire assets (no trademarked content); swap with licensed/branded art if required.
- 4G/weak-network behavior verified by design (server-rendered pages, skeletons, clear errors) but not measured on a throttled connection.

## 10. Verification

- `tsc --noEmit` clean (frontend + backend)
- ESLint clean on all touched files
- Frontend vitest 18/18 · backend vitest 199/199
- All public pages render 200 through the live dev server; new CSS utilities confirmed in the compiled bundle
- Backend/API/auth/Prisma/wallet/tournament logic untouched
