# CLUTCHNEX — Authentication Session Fix (the "logged out after ~5 minutes" bug)

**Date:** 2026-08-29 · **Status:** FIXED + verified

---

## 1. Symptoms reported

- User is automatically logged out / session becomes invalid after roughly 5 minutes.
- Must sign in again even though `JWT_ACCESS_TTL=15m` and `JWT_REFRESH_TTL_DAYS=7`.

## 2. Root cause (found, reproduced, fixed)

**The refresh-token rotation race.**

The app uses rotating, single-use refresh tokens:

1. Access token expires (`JWT_ACCESS_TTL`, 15m — the "~5 minutes" is when a page fires a burst of parallel API calls after expiry; the mechanism, not the timer, is the bug).
2. Pages like Dashboard, Teams and Wallet load with `Promise.all([...])` — **several parallel authed requests at once**.
3. Every one of those requests gets a `401` and each triggers its **own** `POST /auth/refresh` — all carrying the **same single-use refresh cookie**.
4. The backend rotated the token on the first request (old token revoked, new one issued). The other racers presented the now-**revoked** token, which the code classified as **theft/replay** (`REFRESH_TOKEN_REUSED`) and answered with `revokeAllRefreshTokens(userId)` — **killing every live session for the account**.
5. Result: the user is silently signed out and forced to log in again.

This also explains the randomness: it only happened when several authed calls crossed the expiry boundary at the same moment — which is why it felt like "sometimes 5 minutes, sometimes longer."

A second, smaller race existed in the frontend: every concurrent 401 fired its own refresh (no single-flight), making the backend race far more likely.

## 3. Fixes

### Backend — `backend/src/services/auth.service.ts` (`refreshSession`)

- The whole refresh now runs in **one transaction that locks the presented token row** (`SELECT … FOR UPDATE`). Parallel refreshes with the same cookie **serialize** — each sees the previous rotation's committed state.
- **Grace-chaining for benign races:** a replayed token that was revoked **within the last 60 s** is treated as a rotation race (parallel calls / multiple tabs), not a theft. The code chains onto the *successor* token and issues a fresh pair — every racer succeeds exactly once.
- **Real replay protection preserved:** a token replayed **after the 60 s grace window** still triggers the full theft response — `REFRESH_TOKEN_REUSED` audit, fraud alert (`fireRefreshReuse`), and **all live refresh tokens revoked**. The revocations are committed *before* the error is thrown (previously a throw inside the transaction would have rolled them back).
- Security invariants unchanged: tokens stay single-use, stored only as SHA-256 hashes, rotated on every use, 7-day lifetime.

### Frontend — `frontend/src/lib/client-api.ts`

- **Single-flight refresh:** all concurrent 401s await **one shared refresh promise** instead of racing with the same cookie.
- **Proactive refresh:** if the stored access token has < 30 s left, it is refreshed *before* the request is sent, so a page never fires a burst of doomed requests.
- **Dev-only logging** (`console.info('[auth] …')`) — no tokens, cookies, passwords or secrets ever logged. `NODE_ENV=production` logs nothing.

### Frontend — `frontend/src/components/session-keeper.tsx` (new, mounted in root layout)

- On app boot / tab revisit: if the access token is expired or within 60 s of expiry, silently refresh via the HttpOnly cookie. The navbar and page-reloads no longer show "signed out" while the 7-day refresh session is alive.

## 4. Verification (all passing)

| Test | Result |
|---|---|
| Login → refresh → new access token works | ✅ |
| 8 parallel refreshes with the SAME single-use cookie (the reported bug) | ✅ **8/8 succeed**, session survives |
| Refresh with the final (rotated) cookie | ✅ |
| Stale cookie from the race heals via grace-chaining | ✅ |
| Full expiry simulation (backend with `JWT_ACCESS_TTL=1m`): login → wait 70 s → expired token 401 → refresh → **still authenticated** | ✅ |
| Manual logout with the current cookie | ✅ (refresh afterwards correctly → 401) |
| Cookie round-trip through the Next.js proxy (`path` rewrite `/api/auth` → `/api/backend/auth`) | ✅ |
| Old access JWT after rotation | ✅ still valid until its own 15 m expiry (expected JWT behavior — not revoked by refresh) |
| Backend test suite | ✅ **200/200** (16 auth tests incl. two new rotation-race tests) |
| Frontend tests + typecheck (front & back) | ✅ 18/18, `tsc` clean |
| No infinite refresh loop | ✅ single-flight + single retry per request; failure surfaces one 401 → sign-in screen |
| No sensitive data in logs | ✅ only status codes / messages |

Dev helpers (non-production): `npm run test:auth-race`, `npm run test:auth-expiry` in `backend/`.

## 5. What was NOT changed

- `JWT_ACCESS_TTL="15m"`, `JWT_REFRESH_TTL_DAYS="7"` — untouched.
- No permanent tokens, no disabled expiry, no insecure storage, no hidden timers.
- Login/logout endpoints, cookie flags (`HttpOnly`, `SameSite=Lax`, `Secure` in prod, `Path` rewritten by the proxy), CSRF guard, rate limits — all unchanged in behavior.
