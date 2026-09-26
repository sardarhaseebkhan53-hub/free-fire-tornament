import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

class MatchesScreen extends ConsumerWidget {
  const MatchesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final matches = ref.watch(matchesProvider);
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: AppColors.accentSoft,
        onRefresh: () async { await ref.refresh(matchesProvider.future); },
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 15),
              sliver: SliverToBoxAdapter(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('My matches', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 5),
                Text('Check in and enter your room when credentials unlock.', style: Theme.of(context).textTheme.bodySmall),
              ])),
            ),
            matches.when(
              loading: () => const SliverFillRemaining(child: LoadingPanel(label: 'Loading your schedule…')),
              error: (error, stack) => SliverPadding(
                padding: const EdgeInsets.all(20),
                sliver: SliverToBoxAdapter(child: ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(matchesProvider))),
              ),
              data: (items) => items.isEmpty
                  ? SliverFillRemaining(
                      hasScrollBody: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 30, 20, 30),
                        child: EmptyPanel(
                          title: 'No matches booked yet',
                          message: 'Join a tournament and your confirmed seat, check-in window and room details will show here.',
                          actionLabel: 'Explore tournaments',
                          onAction: () => context.go('/tournaments'),
                          icon: Icons.sports_mma_outlined,
                        ),
                      ),
                    )
                  : SliverPadding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
                      sliver: SliverList.list(
                        children: [
                          for (var index = 0; index < items.length; index++) ...[
                            _RegistrationCard(registration: items[index]),
                            if (index != items.length - 1) const SizedBox(height: 14),
                          ],
                        ],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RegistrationCard extends ConsumerWidget {
  const _RegistrationCard({required this.registration});

  final JsonMap registration;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tournament = asJson(registration['tournament']);
    final checkIn = asJson(registration['checkIn']);
    final team = asJson(registration['team']);
    final slug = stringValue(tournament['slug']);
    final checkInState = stringValue(checkIn['state'], fallback: 'NOT_OPEN');
    final checkedIn = checkIn['checkedInAt'] != null;
    final canCheckIn = checkInState == 'OPEN' && !checkedIn;
    final seat = intValue(registration['slotNumber']);
    final scheduledMatches = jsonList(registration['matches']);

    return AppPanel(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        InkWell(
          onTap: () => context.push('/tournament/${Uri.encodeComponent(slug)}'),
          borderRadius: BorderRadius.circular(12),
          child: Row(children: [
            Container(width: 43, height: 43, decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(13)), child: const Icon(Icons.sports_mma_rounded, color: AppColors.accentSoft)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(stringValue(tournament['title'], fallback: 'Tournament'), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text('${typeLabel(stringValue(tournament['type']))} · ${stringValue(tournament['map'], fallback: 'Map TBA')}', style: Theme.of(context).textTheme.bodySmall),
            ])),
            const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
          ]),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(color: AppColors.elevated, borderRadius: BorderRadius.circular(14)),
          child: Row(children: [
            Expanded(child: _SmallInfo(label: 'YOUR SEAT', value: seat > 0 ? '#$seat' : 'Confirmed')),
            Expanded(child: _SmallInfo(label: 'STARTS', value: dateLabel(tournament['startTime'], pattern: 'd MMM · h:mm a'))),
            Expanded(child: _SmallInfo(label: 'ENTRY', value: money(tournament['entryFeePerPlayer']))),
          ]),
        ),
        if (team.isNotEmpty) ...[
          const SizedBox(height: 11),
          Row(children: [const Icon(Icons.groups_rounded, size: 16, color: AppColors.accentSoft), const SizedBox(width: 7), Text('${stringValue(team['name'])} [${stringValue(team['tag'])}]', style: Theme.of(context).textTheme.bodySmall)]),
        ],
        const SizedBox(height: 14),
        Row(children: [
          const Icon(Icons.fact_check_outlined, size: 17, color: AppColors.accentSoft),
          const SizedBox(width: 8),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Tournament check-in', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700, fontSize: 13)),
            const SizedBox(height: 3),
            Text(_checkInCopy(checkIn, checkInState, checkedIn), style: Theme.of(context).textTheme.bodySmall),
          ])),
          if (checkedIn) const StatusPill('Checked in', color: AppColors.success),
          if (canCheckIn)
            SizedBox(
              height: 38,
              child: ElevatedButton(
                onPressed: () => _checkIn(context, ref, slug),
                style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 12)),
                child: const Text('CHECK IN', style: TextStyle(fontSize: 10)),
              ),
            ),
        ]),
        if (scheduledMatches.isNotEmpty) ...[
          const SizedBox(height: 17),
          const Divider(height: 1, color: AppColors.line),
          const SizedBox(height: 13),
          Row(children: [const Icon(Icons.event_note_rounded, color: AppColors.muted, size: 16), const SizedBox(width: 7), Text('${scheduledMatches.length} scheduled ${scheduledMatches.length == 1 ? 'match' : 'matches'}', style: Theme.of(context).textTheme.bodySmall)]),
          const SizedBox(height: 10),
          ...scheduledMatches.map((match) => _MatchDetail(match: match)),
        ] else ...[
          const SizedBox(height: 12),
          const _RoomInfoLocked(message: 'Match schedule will appear here when the organizer publishes it.'),
        ],
        if (numberValue(registration['myEarnings']) > 0) ...[
          const SizedBox(height: 12),
          Text('Credited winnings · ${money(registration['myEarnings'])}', style: const TextStyle(color: AppColors.reward, fontWeight: FontWeight.w800, fontSize: 12)),
        ],
      ]),
    );
  }

  String _checkInCopy(JsonMap state, String status, bool checkedIn) {
    if (checkedIn) return 'Your confirmed seat is held for you.';
    return switch (status) {
      'OPEN' => 'Check in is open now. Confirm you are ready to play.',
      'NOT_OPEN' => 'Opens ${dateLabel(state['opensAt'])}.',
      'CLOSED' => 'The check-in window has closed.',
      'MISCONFIGURED' => 'Check-in is unavailable. Contact the organizer.',
      _ => 'Check-in details are being prepared.',
    };
  }

  Future<void> _checkIn(BuildContext context, WidgetRef ref, String slug) async {
    try {
      await ref.read(apiClientProvider).checkIn(slug);
      ref.invalidate(matchesProvider);
      if (context.mounted) showAppMessage(context, 'You are checked in. Good luck in the arena!');
    } catch (error) {
      if (context.mounted) showAppMessage(context, errorMessage(error));
    }
  }
}

class _MatchDetail extends StatelessWidget {
  const _MatchDetail({required this.match});
  final JsonMap match;

  @override
  Widget build(BuildContext context) {
    final roomId = stringValue(match['roomId']);
    final roomPassword = stringValue(match['roomPassword']);
    final unlocked = match['unlocked'] == true && roomId.isNotEmpty && roomPassword.isNotEmpty;
    final lockedUntil = dateValue(match['credentialsReleaseAt']);
    final result = asJson(match['result']);

    return Container(
      margin: const EdgeInsets.only(bottom: 9),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppColors.base.withValues(alpha: 0.72), borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(width: 31, height: 31, alignment: Alignment.center, decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(9)), child: Text('${intValue(match['matchNumber'], fallback: 1)}', style: const TextStyle(color: AppColors.accentSoft, fontSize: 12, fontWeight: FontWeight.w900))),
          const SizedBox(width: 9),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Match ${intValue(match['matchNumber'], fallback: 1)} · ${stringValue(match['map'], fallback: 'Map TBA')}', style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800, fontSize: 12)),
            const SizedBox(height: 3),
            Text(dateLabel(match['scheduledAt']), style: Theme.of(context).textTheme.bodySmall),
          ])),
          StatusPill(statusLabel(stringValue(match['status'], fallback: 'scheduled'))),
        ]),
        if (unlocked) ...[
          const SizedBox(height: 13),
          const Divider(height: 1, color: AppColors.line),
          const SizedBox(height: 11),
          _CredentialLine(label: 'ROOM ID', value: roomId),
          const SizedBox(height: 7),
          _CredentialLine(label: 'PASSWORD', value: roomPassword),
        ] else ...[
          const SizedBox(height: 9),
          Row(children: [
            const Icon(Icons.lock_outline_rounded, color: AppColors.muted, size: 14),
            const SizedBox(width: 6),
            Expanded(child: Text(lockedUntil == null ? 'Room credentials unlock before match time.' : 'Room details unlock ${dateLabel(lockedUntil)}.', style: Theme.of(context).textTheme.bodySmall)),
          ]),
        ],
        if (result.isNotEmpty) ...[
          const SizedBox(height: 9),
          Text('Result · ${intValue(result['kills'])} kills · ${numberValue(result['points']).toStringAsFixed(0)} pts', style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.w700, fontSize: 12)),
        ],
      ]),
    );
  }
}

class _CredentialLine extends StatelessWidget {
  const _CredentialLine({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      SizedBox(width: 84, child: Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.muted, fontSize: 8))),
      Expanded(child: SelectableText(value, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w900, letterSpacing: 1))),
      IconButton(
        visualDensity: VisualDensity.compact,
        tooltip: 'Copy $label',
        onPressed: () async {
          await Clipboard.setData(ClipboardData(text: value));
          if (context.mounted) showAppMessage(context, '$label copied.');
        },
        icon: const Icon(Icons.copy_rounded, size: 16, color: AppColors.accentSoft),
      ),
    ]);
  }
}

class _RoomInfoLocked extends StatelessWidget {
  const _RoomInfoLocked({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Row(children: [const Icon(Icons.lock_clock_rounded, color: AppColors.muted, size: 15), const SizedBox(width: 7), Expanded(child: Text(message, style: Theme.of(context).textTheme.bodySmall))]);
  }
}

class _SmallInfo extends StatelessWidget {
  const _SmallInfo({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 8, fontWeight: FontWeight.w900, letterSpacing: 0.7)),
      const SizedBox(height: 5),
      Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.foreground, fontSize: 11, fontWeight: FontWeight.w800)),
    ]);
  }
}
