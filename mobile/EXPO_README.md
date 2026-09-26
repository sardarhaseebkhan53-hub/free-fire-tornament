# Legacy ClutchNex Expo client

This is the original React Native + Expo application. The recommended native client is now [`flutter/`](./flutter/); this client is preserved as an alternative and is not a WebView.

## Current Expo scope

Implemented screens: sign-in, registration, home, tournament list/search, tournament detail and server-authoritative join, My Matches, leaderboard, profile/sign-out, secure token storage, cached queries, loading/error/empty states, tab and stack navigation, deep-link scheme, and EAS profiles. Forgot/reset password, profile editing, native push-token registration, universal-link association files, and payment UI were not represented as fake production features in this Expo client.

## Run locally

```bash
cd mobile
npm install
cp .env.example .env
npm run start
# then press a for Android or i for iOS
```

Set `EXPO_PUBLIC_API_URL` to the API origin including `/api`, for example `https://www.clutchnex.com/api`. For a local Android emulator use `http://10.0.2.2:4000/api`; for an iOS simulator use `http://localhost:4000/api`.

## Architecture

The client reuses the existing API contracts, authentication, race-safe tournament join transaction, match visibility rules, database, and brand. It adds native navigation, Expo SecureStore token storage, React Query caching and EAS configuration. It never connects directly to PostgreSQL.
