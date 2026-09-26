# CLUTCHNEX mobile clients

The full native **Flutter** app is now the primary Android/iOS client in [`flutter/`](./flutter/). It integrates with the existing Express API and includes auth, tournaments, live check-in/matches, wallet, teams, notifications, support and NEXA. See [`flutter/README.md`](./flutter/README.md) for setup, build and API configuration.

```bash
cd mobile/flutter
flutter create --org com.clutchnex --platforms=android,ios .   # one-time native runner bootstrap
flutter pub get
flutter run --dart-define=API_URL=https://www.clutchnex.com/api
```

The Flutter app deliberately uses the backend as the only source of truth for entry fees, wallet balances, payment status, tournament eligibility and timed room credentials. It stores access/refresh session data using platform secure storage. Native APNs/FCM delivery is not enabled because the current backend push contract is Web Push; the in-app notification inbox is available.

## Existing Expo client

The original Expo / React Native client is preserved at the root of this folder (`app/`, `lib/`, `package.json`) for continuity. It is an alternative prototype and is not required to run the Flutter app. Its setup notes remain in [`EXPO_README.md`](./EXPO_README.md).
