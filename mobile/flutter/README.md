# CLUTCHNEX — Flutter mobile app

Cross-platform native Android/iOS player app for the existing CLUTCHNEX API. The Flutter client reuses the production Express contracts and server-side rules; it does not contain database access, payment credentials, tournament fee calculations, or room secrets.

## Features

- Public tournament discovery, home stats, event details, participant lists, prize breakdowns and public leaderboard.
- Email/username sign-in, registration, forgot/reset password, secure session storage, rotating refresh-cookie support, and profile completion/editing.
- Server-authoritative tournament entry, profile validation, team selection/free-agent support, My Matches, check-in and timed room credentials.
- PKR wallet overview, ledger preview, manual deposits with screenshot proof, withdrawals, and idempotent player transfers.
- DUO/SQUAD team creation, join codes, team invitations and team details.
- Notifications inbox, support tickets and the read-only NEXA help assistant.
- Dark obsidian/electric-violet Material 3 design, loading/error/empty states, pull-to-refresh and responsive layouts.

## Requirements

- Flutter stable with Dart 3.6 or newer.
- Android Studio / Android SDK for Android builds; Xcode on macOS for iOS builds.
- A running CLUTCHNEX API. The default API is `https://www.clutchnex.com/api`.

The checkout environment used to author this app does not have the Flutter SDK, so Android/iOS runner projects and a binary build have not been generated here. On a machine with Flutter installed, create the standard platform runners once from this folder:

```bash
cd mobile/flutter
flutter create --org com.clutchnex --platforms=android,ios .
flutter pub get
```

The Dart application source is already in `lib/`. The generated native runner is machine/toolchain output; keep signing keys and provisioning profiles out of Git. Set the Android `applicationId` and iOS bundle identifier to `com.clutchnex.app` before publishing. The deposit screenshot picker uses the photo library; add this entry to `ios/Runner/Info.plist` after bootstrapping:

```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>Choose a payment screenshot to submit for deposit review.</string>
```

## Run

```bash
cd mobile/flutter
flutter pub get
flutter run --dart-define=API_URL=https://www.clutchnex.com/api
```

For a local backend, use the host that the emulator can reach:

```bash
# Android emulator
flutter run --dart-define=API_URL=http://10.0.2.2:4000/api --dart-define=MEDIA_BASE_URL=http://10.0.2.2:3000

# iOS simulator
flutter run --dart-define=API_URL=http://localhost:4000/api --dart-define=MEDIA_BASE_URL=http://localhost:3000
```

`API_URL` is the API origin including `/api`; `MEDIA_BASE_URL` is optional and points to the web origin that serves `/art/*` banners. The default media origin is `https://www.clutchnex.com`. Never use `localhost` for an Android emulator or a real device. If your generated Android/iOS runner blocks local HTTP, allow cleartext only in the local debug runner (`android:usesCleartextTraffic="true"` for Android; a local-only ATS exception in `ios/Runner/Info.plist`). Do not ship those development exceptions in production.

## Build

```bash
flutter analyze
flutter test
flutter build apk --release --dart-define=API_URL=https://www.clutchnex.com/api
flutter build appbundle --release --dart-define=API_URL=https://www.clutchnex.com/api
flutter build ios --release --dart-define=API_URL=https://www.clutchnex.com/api
```

A signed APK/AAB or iOS archive requires the usual Android keystore / Apple signing setup. No signing credentials are included.

## API and security notes

- Access tokens and the refresh cookie are stored with platform secure storage. A `401` triggers one refresh attempt; replayed requests are retried once. Logout clears local credentials even if the API is unreachable.
- The app sends the backend's required `X-ClutchNex-Client: flutter` first-party marker on cookie-authenticated refresh/logout calls.
- Join, check-in, deposit, withdrawal and transfer requests are processed by the existing API. UI amounts are informational; the server remains authoritative. Deposits are pending until staff review.
- Match-room credentials are rendered only when the authenticated `/api/matches/my` response releases them. No public event endpoint is used to fetch room passwords.
- Native remote push is not claimed: the current backend stores Web Push subscriptions, not APNs/FCM tokens. The in-app notification inbox is live; a production native push provider needs a corresponding backend integration.
- OAuth provider sign-in and payment-provider SDKs are not embedded. Email/password and the existing manual JazzCash, EasyPaisa, bank, NayaPay and SadaPay review workflow are supported.
- Password reset uses the existing email/token API. Universal/app-link association is not configured, so if the reset email opens the website, copy its token into the app’s “I have a reset token” flow.
