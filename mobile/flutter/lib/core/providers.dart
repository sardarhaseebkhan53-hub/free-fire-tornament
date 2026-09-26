import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'models.dart';
import 'network/api_client.dart';
import 'storage/session_store.dart';

final sessionStoreProvider = Provider<SessionStore>((ref) {
  final store = SessionStore();
  ref.onDispose(() => store.dispose());
  return store;
});

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.read(sessionStoreProvider));
});

final authControllerProvider = AsyncNotifierProvider<AuthController, Player?>(AuthController.new);

final homeStatsProvider = FutureProvider.autoDispose<JsonMap>((ref) =>
    ref.read(apiClientProvider).homeStats());

final featuredTournamentsProvider = FutureProvider.autoDispose<List<Tournament>>((ref) async {
  final items = await ref.read(apiClientProvider).tournaments(status: 'REGISTRATION_OPEN', limit: 50);
  return items.where((tournament) => tournament.registrationOpen).take(6).toList(growable: false);
});

final tournamentListProvider = FutureProvider.autoDispose
    .family<List<Tournament>, TournamentQuery>((ref, query) =>
        ref.read(apiClientProvider).tournaments(
              search: query.search,
              type: query.type,
              limit: 40,
            ));

final tournamentDetailProvider = FutureProvider.autoDispose
    .family<JsonMap, String>((ref, slug) => ref.read(apiClientProvider).tournament(slug));

final leaderboardProvider = FutureProvider.autoDispose
    .family<JsonMap, String>((ref, period) => ref.read(apiClientProvider).leaderboard(period: period));

final matchesProvider = FutureProvider.autoDispose<List<JsonMap>>((ref) =>
    ref.read(apiClientProvider).myMatches());

final walletProvider = FutureProvider.autoDispose<WalletSummary>((ref) =>
    ref.read(apiClientProvider).walletOverview());

final teamsProvider = FutureProvider.autoDispose<List<JsonMap>>((ref) =>
    ref.read(apiClientProvider).myTeams());

final teamInvitesProvider = FutureProvider.autoDispose<List<JsonMap>>((ref) =>
    ref.read(apiClientProvider).myTeamInvites());

final teamDetailProvider = FutureProvider.autoDispose
    .family<JsonMap, String>((ref, id) => ref.read(apiClientProvider).teamDetails(id));

final notificationsProvider = FutureProvider.autoDispose<List<JsonMap>>((ref) =>
    ref.read(apiClientProvider).notifications());

final supportTicketsProvider = FutureProvider.autoDispose<List<JsonMap>>((ref) =>
    ref.read(apiClientProvider).supportTickets());

final supportThreadProvider = FutureProvider.autoDispose
    .family<JsonMap, String>((ref, id) => ref.read(apiClientProvider).supportThread(id));

class AuthController extends AsyncNotifier<Player?> {
  @override
  Future<Player?> build() async {
    final store = ref.read(sessionStoreProvider);
    final expirySubscription = store.sessionExpired.listen((_) {
      state = const AsyncData(null);
    });
    ref.onDispose(() => expirySubscription.cancel());

    final accessToken = await store.readAccessToken();
    if (accessToken == null || accessToken.isEmpty) return null;

    try {
      final player = await ref.read(apiClientProvider).me();
      await store.cacheUser(player.toJson());
      return player;
    } catch (_) {
      final cached = await store.readCachedUser();
      if (cached != null) return Player.fromJson(cached);
      return null;
    }
  }

  Future<void> signIn(String identifier, String password) async {
    state = const AsyncLoading();
    try {
      final result = await ref.read(apiClientProvider).login(identifier, password);
      final store = ref.read(sessionStoreProvider);
      await store.writeAccessToken(result.accessToken);
      var player = result.player;
      try {
        player = await ref.read(apiClientProvider).me();
      } catch (_) {
        // A successful login still works from the compact response; hydrate the full profile on refresh.
      }
      await store.cacheUser(player.toJson());
      state = AsyncData(player);
    } catch (error, stackTrace) {
      state = const AsyncData(null);
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<void> registerAndSignIn(JsonMap input) async {
    state = const AsyncLoading();
    try {
      final api = ref.read(apiClientProvider);
      await api.register(input);
      final result = await api.login(
        stringValue(input['email']),
        stringValue(input['password']),
      );
      final store = ref.read(sessionStoreProvider);
      await store.writeAccessToken(result.accessToken);
      var player = result.player;
      try {
        player = await ref.read(apiClientProvider).me();
      } catch (_) {
        // A successful login still works from the compact response; hydrate the full profile on refresh.
      }
      await store.cacheUser(player.toJson());
      state = AsyncData(player);
    } catch (error, stackTrace) {
      state = const AsyncData(null);
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<void> refreshProfile() async {
    final player = await ref.read(apiClientProvider).me();
    await ref.read(sessionStoreProvider).cacheUser(player.toJson());
    state = AsyncData(player);
  }

  Future<void> updateProfile(JsonMap input) async {
    final player = await ref.read(apiClientProvider).updateProfile(input);
    await ref.read(sessionStoreProvider).cacheUser(player.toJson());
    state = AsyncData(player);
  }

  Future<void> signOut() async {
    try {
      await ref.read(apiClientProvider).logout();
    } catch (_) {
      // Local credentials must be cleared even when the API cannot be reached.
    }
    await ref.read(sessionStoreProvider).clearSession();
    state = const AsyncData(null);
  }
}
