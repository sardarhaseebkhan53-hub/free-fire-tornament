import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifications = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: () async {
              try {
                await ref.read(apiClientProvider).markNotificationRead(all: true);
                ref.invalidate(notificationsProvider);
                if (context.mounted) showAppMessage(context, 'All notifications marked as read.');
              } catch (error) {
                if (context.mounted) showAppMessage(context, errorMessage(error));
              }
            },
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.accentSoft,
        onRefresh: () async { await ref.refresh(notificationsProvider.future); },
        child: notifications.when(
          loading: () => const LoadingPanel(label: 'Loading updates…'),
          error: (error, stack) => ListView(padding: const EdgeInsets.all(20), children: [ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(notificationsProvider))]),
          data: (items) => items.isEmpty
              ? ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(20), children: const [EmptyPanel(title: 'All quiet for now', message: 'Tournament updates, check-ins and payment reviews will appear here.', icon: Icons.notifications_none_rounded)])
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(20, 5, 20, 30),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 9),
                  itemBuilder: (context, index) => _NotificationCard(item: items[index]),
                ),
        ),
      ),
    );
  }
}

class _NotificationCard extends ConsumerWidget {
  const _NotificationCard({required this.item});
  final JsonMap item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = item['readAt'] == null;
    final data = asJson(item['data']);
    return InkWell(
      onTap: () async {
        if (unread) {
          try {
            await ref.read(apiClientProvider).markNotificationRead(id: stringValue(item['id']));
            ref.invalidate(notificationsProvider);
          } catch (error) {
            if (context.mounted) showAppMessage(context, errorMessage(error));
          }
        }
        final slug = stringValue(data['slug']);
        if (slug.isNotEmpty && context.mounted) {
          await context.push('/tournament/${Uri.encodeComponent(slug)}');
        }
      },
      borderRadius: BorderRadius.circular(16),
      child: AppPanel(
        padding: const EdgeInsets.all(14),
        borderRadius: 16,
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 39,
            height: 39,
            decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(12)),
            child: Icon(_notificationIcon(stringValue(item['type'])), color: AppColors.accentSoft, size: 19),
          ),
          const SizedBox(width: 11),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(stringValue(item['title'], fallback: 'CLUTCHNEX update'), style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800, fontSize: 13))),
              if (unread) Container(width: 7, height: 7, decoration: const BoxDecoration(color: AppColors.accent, shape: BoxShape.circle)),
            ]),
            const SizedBox(height: 5),
            Text(stringValue(item['body']), style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 7),
            Text(dateLabel(item['createdAt']), style: const TextStyle(color: AppColors.muted, fontSize: 10)),
          ])),
        ]),
      ),
    );
  }

  IconData _notificationIcon(String type) => switch (type) {
        'ROOM_CREDENTIALS' => Icons.lock_open_rounded,
        'TEAM_INVITE' => Icons.groups_rounded,
        'DEPOSIT_APPROVED' || 'WINNING_CREDITED' => Icons.account_balance_wallet_rounded,
        'WITHDRAWAL_UPDATE' => Icons.outbox_rounded,
        'MATCH_STARTING' => Icons.sports_mma_rounded,
        'SUPPORT_REPLY' => Icons.support_agent_rounded,
        _ => Icons.notifications_active_outlined,
      };
}
