import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'models.dart';
import 'providers.dart';
import 'features/auth/auth_screens.dart';
import 'features/home/home_screen.dart';
import 'features/leaderboard/leaderboard_screen.dart';
import 'features/matches/matches_screen.dart';
import 'features/nexa/nexa_screen.dart';
import 'features/notifications/notifications_screen.dart';
import 'features/profile/profile_screens.dart';
import 'features/support/support_screens.dart';
import 'features/teams/teams_screens.dart';
import 'features/tournaments/tournament_screens.dart';
import 'features/wallet/wallet_screens.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();
final _shellNavigatorKey = GlobalKey<NavigatorState>();

class _RouterRefresh extends ChangeNotifier {
  void refresh() => notifyListeners();
}

final appRouterProvider = Provider<GoRouter>((ref) {
  final refresh = _RouterRefresh();
  ref.listen<AsyncValue<Player?>>(authControllerProvider, (_, __) => refresh.refresh());

  final router = GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/home',
    refreshListenable: refresh,
    redirect: (context, state) {
      final path = state.uri.path;
      if (path == '/') return '/home';

      final auth = ref.read(authControllerProvider);
      if (auth.isLoading) return null;
      final signedIn = auth.valueOrNull != null;
      final requiresAuth = path == '/matches' ||
          path == '/wallet' ||
          path.startsWith('/wallet/') ||
          path == '/teams' ||
          path.startsWith('/team/') ||
          path == '/profile/edit' ||
          path == '/password/change' ||
          path == '/notifications' ||
          path == '/support' ||
          path.startsWith('/support/');

      if (!signedIn && requiresAuth) {
        return '/sign-in?from=${Uri.encodeComponent(state.uri.toString())}';
      }
      if (signedIn && (path == '/sign-in' || path == '/register')) {
        return state.uri.queryParameters['from'] ?? '/home';
      }
      return null;
    },
    routes: [
      StatefulShellRoute.indexedStack(
        navigatorKey: _shellNavigatorKey,
        builder: (context, state, navigationShell) => AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/home', builder: (context, state) => const HomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/tournaments', builder: (context, state) => const TournamentListScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/matches', builder: (context, state) => const MatchesScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/leaderboard', builder: (context, state) => const LeaderboardScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen()),
          ]),
        ],
      ),
      GoRoute(path: '/sign-in', builder: (context, state) => SignInScreen(from: state.uri.queryParameters['from'])),
      GoRoute(path: '/register', builder: (context, state) => const RegisterScreen()),
      GoRoute(path: '/forgot-password', builder: (context, state) => const ForgotPasswordScreen()),
      GoRoute(
        path: '/reset-password',
        builder: (context, state) => ResetPasswordScreen(token: state.uri.queryParameters['token'] ?? ''),
      ),
      GoRoute(
        path: '/tournament/:slug',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => TournamentDetailScreen(slug: state.pathParameters['slug']!),
      ),
      GoRoute(path: '/wallet', builder: (context, state) => const WalletScreen()),
      GoRoute(path: '/wallet/deposit', builder: (context, state) => const DepositScreen()),
      GoRoute(path: '/wallet/withdraw', builder: (context, state) => const WithdrawalScreen()),
      GoRoute(path: '/wallet/transfer', builder: (context, state) => const TransferScreen()),
      GoRoute(path: '/teams', builder: (context, state) => const TeamsScreen()),
      GoRoute(
        path: '/team/:id',
        builder: (context, state) => TeamDetailScreen(teamId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/profile/edit', builder: (context, state) => const ProfileEditScreen()),
      GoRoute(path: '/password/change', builder: (context, state) => const ChangePasswordScreen()),
      GoRoute(path: '/notifications', builder: (context, state) => const NotificationsScreen()),
      GoRoute(path: '/support', builder: (context, state) => const SupportScreen()),
      GoRoute(
        path: '/support/:id',
        builder: (context, state) => SupportTicketScreen(ticketId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/nexa', builder: (context, state) => const NexaScreen()),
    ],
  );

  ref.onDispose(() {
    router.dispose();
    refresh.dispose();
  });
  return router;
});

class AppShell extends StatelessWidget {
  const AppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (index) => navigationShell.goBranch(
          index,
          initialLocation: index == navigationShell.currentIndex,
        ),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.emoji_events_outlined), selectedIcon: Icon(Icons.emoji_events_rounded), label: 'Events'),
          NavigationDestination(icon: Icon(Icons.sports_mma_outlined), selectedIcon: Icon(Icons.sports_mma_rounded), label: 'Matches'),
          NavigationDestination(icon: Icon(Icons.leaderboard_outlined), selectedIcon: Icon(Icons.leaderboard_rounded), label: 'Ranks'),
          NavigationDestination(icon: Icon(Icons.person_outline_rounded), selectedIcon: Icon(Icons.person_rounded), label: 'Profile'),
        ],
      ),
    );
  }
}
