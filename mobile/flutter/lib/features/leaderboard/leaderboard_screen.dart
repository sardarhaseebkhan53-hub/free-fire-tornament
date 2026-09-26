import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

class LeaderboardScreen extends ConsumerStatefulWidget {
  const LeaderboardScreen({super.key});

  @override
  ConsumerState<LeaderboardScreen> createState() => _LeaderboardScreenState();
}

class _LeaderboardScreenState extends ConsumerState<LeaderboardScreen> {
  String _period = 'all';

  @override
  Widget build(BuildContext context) {
    final board = ref.watch(leaderboardProvider(_period));
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: AppColors.accentSoft,
        onRefresh: () async { await ref.refresh(leaderboardProvider(_period).future); },
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 15),
              sliver: SliverToBoxAdapter(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Ranked players', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 5),
                Text('Published match results only. Every point is earned in the arena.', style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 17),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'all', label: Text('All time')),
                    ButtonSegment(value: 'weekly', label: Text('Weekly')),
                    ButtonSegment(value: 'monthly', label: Text('Monthly')),
                  ],
                  selected: {_period},
                  onSelectionChanged: (selection) => setState(() => _period = selection.first),
                  showSelectedIcon: false,
                  style: ButtonStyle(textStyle: WidgetStateProperty.all(const TextStyle(fontSize: 11, fontWeight: FontWeight.w700))),
                ),
              ])),
            ),
            board.when(
              loading: () => const SliverFillRemaining(child: LoadingPanel(label: 'Calculating the rankings…')),
              error: (error, stack) => SliverPadding(
                padding: const EdgeInsets.all(20),
                sliver: SliverToBoxAdapter(child: ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(leaderboardProvider(_period)))),
              ),
              data: (data) {
                final items = jsonList(data['items']);
                if (items.isEmpty) {
                  return const SliverFillRemaining(
                    hasScrollBody: false,
                    child: Padding(
                      padding: EdgeInsets.all(20),
                      child: EmptyPanel(title: 'Rankings are warming up', message: 'Players appear here after verified tournament results are published.', icon: Icons.military_tech_outlined),
                    ),
                  );
                }
                return SliverPadding(
                  padding: const EdgeInsets.fromLTRB(20, 2, 20, 30),
                  sliver: SliverList.list(
                    children: [
                      if (items.length >= 3) _Podium(items: items.take(3).toList()),
                      if (items.length >= 3) const SizedBox(height: 15),
                      for (var index = items.length >= 3 ? 3 : 0; index < items.length; index++) _RankRow(item: items[index]),
                    ],
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _Podium extends StatelessWidget {
  const _Podium({required this.items});
  final List<JsonMap> items;

  @override
  Widget build(BuildContext context) {
    final order = [items[1], items[0], items[2]];
    return AppPanel(
      padding: const EdgeInsets.fromLTRB(12, 20, 12, 15),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (var position = 0; position < order.length; position++) ...[
            if (position > 0) const SizedBox(width: 8),
            Expanded(child: _PodiumPlace(item: order[position], position: position == 1 ? 1 : position == 0 ? 2 : 3)),
          ],
        ],
      ),
    );
  }
}

class _PodiumPlace extends StatelessWidget {
  const _PodiumPlace({required this.item, required this.position});
  final JsonMap item;
  final int position;

  @override
  Widget build(BuildContext context) {
    final user = asJson(item['user']);
    final rank = asJson(item['rankInfo']);
    final name = stringValue(asJson(user['profile'])['freeFireIGN'], fallback: stringValue(user['username'], fallback: 'Player'));
    final primary = position == 1 ? AppColors.reward : position == 2 ? AppColors.accentSoft : const Color(0xFFCD8A62);
    return Column(
      children: [
        Container(
          width: position == 1 ? 61 : 53,
          height: position == 1 ? 61 : 53,
          decoration: BoxDecoration(shape: BoxShape.circle, color: primary.withValues(alpha: 0.14), border: Border.all(color: primary.withValues(alpha: 0.45), width: 2)),
          child: Icon(position == 1 ? Icons.workspace_premium_rounded : Icons.shield_rounded, color: primary, size: position == 1 ? 30 : 25),
        ),
        const SizedBox(height: 9),
        Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800, fontSize: 11)),
        const SizedBox(height: 4),
        Text(stringValue(rank['label'], fallback: 'Bronze'), style: TextStyle(color: _rankColor(rank['color']), fontSize: 9, fontWeight: FontWeight.w800)),
        const SizedBox(height: 5),
        Text('${intValue(item['totalPoints'])} pts', style: TextStyle(color: primary, fontSize: 11, fontWeight: FontWeight.w900)),
        const SizedBox(height: 11),
        Container(
          height: position == 1 ? 52 : 37,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: primary.withValues(alpha: 0.12), borderRadius: const BorderRadius.vertical(top: Radius.circular(12))),
          child: Text('#$position', style: TextStyle(color: primary, fontSize: 19, fontWeight: FontWeight.w900)),
        ),
      ],
    );
  }
}

class _RankRow extends StatelessWidget {
  const _RankRow({required this.item});
  final JsonMap item;

  @override
  Widget build(BuildContext context) {
    final user = asJson(item['user']);
    final rank = asJson(item['rankInfo']);
    final rankColor = _rankColor(rank['color']);
    final ign = stringValue(asJson(user['profile'])['freeFireIGN']);
    final username = stringValue(user['username'], fallback: 'Player');
    final name = ign.isEmpty ? username : ign;
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: AppPanel(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        borderRadius: 15,
        child: Row(children: [
          SizedBox(width: 33, child: Text('#${intValue(item['rank'])}', style: const TextStyle(color: AppColors.accentSoft, fontWeight: FontWeight.w900, fontSize: 14))),
          CircleAvatar(radius: 19, backgroundColor: rankColor.withValues(alpha: 0.13), child: Icon(Icons.shield_rounded, size: 19, color: rankColor)),
          const SizedBox(width: 11),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800, fontSize: 13)),
            const SizedBox(height: 4),
            Text('${stringValue(rank['label'], fallback: 'Bronze')} · ${intValue(item['matchesPlayed'])} matches · ${intValue(item['wins'])} wins', maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall),
          ])),
          const SizedBox(width: 8),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('${intValue(item['totalPoints'])}', style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w900, fontSize: 15)),
            Text('${intValue(item['kills'])} kills', style: Theme.of(context).textTheme.bodySmall),
          ]),
        ]),
      ),
    );
  }
}

Color _rankColor(Object? value) {
  final raw = stringValue(value).replaceFirst('#', '');
  if (raw.length != 6) return AppColors.accentSoft;
  final parsed = int.tryParse('FF$raw', radix: 16);
  return parsed == null ? AppColors.accentSoft : Color(parsed);
}
