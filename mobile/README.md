# ClutchNex Mobile

Native Android and iOS client for the ClutchNex esports platform. This is a React Native + Expo application, not a WebView. It uses the existing Express API and never connects directly to PostgreSQL.

## Audit summary

- **Web:** Next.js 16 App Router in `frontend/`, with the existing tournament website preserved.
- **API:** Express 5 in `backend/`, mounted under `/api`; Prisma 7 + PostgreSQL.
- **Auth:** `/api/auth/login`, `/register`, `/me`, `/refresh`, `/logout`; bearer access tokens are accepted by protected routes. The mobile client stores the access token in Expo SecureStore.
- **Public data:** `/api/public/tournaments`, `/api/public/tournaments/:slug`, `/api/public/leaderboard`, `/api/public/stats/home`.
- **Tournament:** `/api/tournaments/join`, `/my`, `/:slug/cancel`, `/:slug/room`, and check-in. Join remains server-authoritative and race-safe.
- **Matches:** `/api/matches/my`; room credentials are only returned by the protected player route.
- **Notifications:** `/api/notifications`, `/unread-count`, `/read`; push subscription endpoints exist at `/api/push` for web push. Native Expo push-token registration is a follow-up backend addition because the current schema expects browser Web Push endpoint/key triples, not Expo tokens.
- **Payments:** wallet/deposit/withdrawal routes remain backend-controlled; the app does not carry payment secrets or mark payments successful locally.

## What is reusable / what is added

The mobile app reuses the existing API contracts, authentication, tournament join transaction, match visibility rules, database, and brand. It adds native navigation, secure token storage, mobile query caching, native layouts, and EAS build configuration. Native push delivery requires an Expo token endpoint and a token model/provider integration before production push can be enabled; this is deliberately not faked in the client.

## Run locally

```bash
cd mobile
npm install
cp .env.example .env
npm run start
# then press a for Android or i for iOS
```

Set `EXPO_PUBLIC_API_URL` to the API origin including `/api`, for example `https://www.clutchnex.com/api`. For a local Android emulator use `http://10.0.2.2:4000/api`; for an iOS simulator use `http://localhost:4000/api`.

## Checks and builds

```bash
npm run typecheck
npm run android
npm run ios
npm run build:preview       # EAS internal APK
npm run build:production    # EAS Android AAB / iOS archive
```

Preview produces an installable Android APK. Production uses an Android App Bundle and iOS archive profiles. EAS requires an Expo account/project ID and Android keystore. iOS additionally requires an Apple Developer team, bundle identifier registration, certificates and provisioning; no IPA is claimed or included without those credentials.

## Configuration

- API URL: `EXPO_PUBLIC_API_URL`
- Deep-link scheme: `clutchnex://`
- Android package: `com.clutchnex.app`
- iOS bundle identifier: `com.clutchnex.app`
- Theme tokens: `theme.ts`

## Current native scope

Implemented screens: sign-in, registration, home, tournament list/search, tournament detail and server-authoritative join, my matches, leaderboard, profile/sign-out, secure API client, cached queries, loading/error/empty states, tab and stack navigation, deep-link scheme, and EAS profiles. Forgot/reset password, profile editing, native push-token registration, universal-link association files, and payment UI should be added only against their exact API contracts; they are not represented as fake production features.
