import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  Future<void> _refresh(WidgetRef ref) async {
    await Future.wait([
      ref.refresh(homeStatsProvider.future),
      ref.refresh(featuredTournamentsProvider.future),
    ]).catchError((_) => <Object?>[]);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final player = ref.watch(authControllerProvider).valueOrNull;
    final stats = ref.watch(homeStatsProvider);
    final featured = ref.watch(featuredTournamentsProvider);

    return RefreshIndicator(
      color: AppColors.accentSoft,
      backgroundColor: AppColors.surface,
      onRefresh: () => _refresh(ref),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 10),
            sliver: SliverToBoxAdapter(
              child: Row(
                children: [
                  const BrandWordmark(compact: true),
                  const Spacer(),
                  IconButton(
                    tooltip: player == null ? 'Sign in' : 'Notifications',
                    onPressed: () => context.push(player == null ? '/sign-in' : '/notifications'),
                    style: IconButton.styleFrom(backgroundColor: AppColors.elevated, foregroundColor: AppColors.foreground),
                    icon: Icon(player == null ? Icons.login_rounded : Icons.notifications_none_rounded, size: 20),
                  ),
                ],
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 14),
            sliver: SliverToBoxAdapter(child: _ArenaHero(player: player)),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 22),
            sliver: SliverToBoxAdapter(child: _StatsStrip(stats: stats)),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            sliver: SliverToBoxAdapter(
              child: SectionHeading('Registration open', action: 'View all', onAction: () => context.go('/tournaments')),
            ),
          ),
          SliverToBoxAdapter(
            child: featured.when(
              loading: () => const SizedBox(height: 220, child: LoadingPanel(label: 'Finding your next event…')),
              error: (error, stack) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(featuredTournamentsProvider)),
              ),
              data: (items) => items.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 20),
                      child: EmptyPanel(title: 'No open events yet', message: 'Registration-open tournaments will show here when the arena opens.'),
                    )
                  : SizedBox(
                      height: 354,
                      child: ListView.separated(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        scrollDirection: Axis.horizontal,
                        itemCount: items.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 12),
                        itemBuilder: (context, index) => SizedBox(width: 276, child: TournamentCard(tournament: items[index], horizontal: true)),
                      ),
                    ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
            sliver: SliverToBoxAdapter(child: SectionHeading('Built for the clutch')),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
            sliver: SliverToBoxAdapter(
              child: Row(
                children: const [
                  Expanded(child: _FeatureTile(icon: Icons.shield_outlined, title: 'Fair play', detail: 'Verified results')),
                  SizedBox(width: 10),
                  Expanded(child: _FeatureTile(icon: Icons.lock_clock_outlined, title: 'Room access', detail: 'Timed & private')),
                  SizedBox(width: 10),
                  Expanded(child: _FeatureTile(icon: Icons.account_balance_wallet_outlined, title: 'Real wallet', detail: 'Server secured')),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ArenaHero extends StatelessWidget {
  const _ArenaHero({required this.player});

  final Player? player;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 22, 20, 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.accent.withValues(alpha: 0.25)),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF28204B), Color(0xFF151A2C), Color(0xFF101522)],
        ),
        boxShadow: const [BoxShadow(color: Color(0x338B5CF6), blurRadius: 34, offset: Offset(0, 12))],
      ),
      child: Stack(
        children: [
          const Positioned(
            right: -7,
            top: 0,
            child: Icon(Icons.bolt_rounded, size: 94, color: Color(0x268B5CF6)),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(30)),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.circle, size: 7, color: AppColors.success),
                    SizedBox(width: 7),
                    Text('PAKISTAN ESPORTS ARENA', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, letterSpacing: 1.1, color: AppColors.secondary)),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Text(
                player == null ? 'The arena\nis calling.' : 'Ready to\nclutch, ${player!.username}?',
                style: Theme.of(context).textTheme.headlineLarge?.copyWith(fontSize: 34, color: Colors.white),
              ),
              const SizedBox(height: 11),
              Text(
                'Compete in Free Fire tournaments. Build your squad. Make every match count.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: const Color(0xFFC8C2DB)),
              ),
              const SizedBox(height: 21),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => context.go('/tournaments'),
                      icon: const Icon(Icons.flash_on_rounded, size: 18),
                      label: const Text('EXPLORE EVENTS'),
                    ),
                  ),
                  if (player == null) ...[
                    const SizedBox(width: 9),
                    IconButton.filledTonal(
                      onPressed: () => context.push('/sign-in'),
                      tooltip: 'Sign in',
                      icon: const Icon(Icons.person_outline_rounded),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatsStrip extends StatelessWidget {
  const _StatsStrip({required this.stats});

  final AsyncValue<JsonMap> stats;

  @override
  Widget build(BuildContext context) {
    return stats.when(
      loading: () => const SizedBox(height: 84, child: LinearProgressIndicator(minHeight: 2)),
      error: (_, __) => const SizedBox.shrink(),
      data: (data) => Row(
        children: [
          Expanded(child: _StatTile(label: 'PLAYERS', value: _compact(data['totalPlayers']))),
          const SizedBox(width: 9),
          Expanded(child: _StatTile(label: 'TOURNAMENTS', value: _compact(data['totalTournaments']))),
          const SizedBox(width: 9),
          Expanded(child: _StatTile(label: 'PAID OUT', value: money(data['totalPrizeDistributed']))),
        ],
      ),
    );
  }

  String _compact(Object? value) {
    final count = intValue(value);
    if (count >= 1000000) return '${(count / 1000000).toStringAsFixed(1)}m';
    if (count >= 1000) return '${(count / 1000).toStringAsFixed(1)}k';
    return '$count';
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 13),
      borderRadius: 15,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.muted, fontSize: 8, fontWeight: FontWeight.w900, letterSpacing: 0.8)),
          const SizedBox(height: 7),
          FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: const TextStyle(color: AppColors.foreground, fontSize: 15, fontWeight: FontWeight.w900))),
        ],
      ),
    );
  }
}

class _FeatureTile extends StatelessWidget {
  const _FeatureTile({required this.icon, required this.title, required this.detail});

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      padding: const EdgeInsets.fromLTRB(10, 13, 9, 12),
      borderRadius: 16,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.accentSoft, size: 20),
          const SizedBox(height: 10),
          Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.foreground)),
          const SizedBox(height: 3),
          Text(detail, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 9, color: AppColors.muted)),
        ],
      ),
    );
  }
}
