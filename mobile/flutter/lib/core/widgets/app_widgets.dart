import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../config.dart';
import '../models.dart';
import '../theme/app_theme.dart';

class AppPanel extends StatelessWidget {
  const AppPanel({
    required this.child,
    super.key,
    this.padding = const EdgeInsets.all(18),
    this.borderRadius = 20,
    this.gradient,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double borderRadius;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.panel,
        gradient: gradient,
        borderRadius: BorderRadius.circular(borderRadius),
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(color: Color(0x18000000), blurRadius: 22, offset: Offset(0, 10)),
        ],
      ),
      child: child,
    );
  }
}

class BrandWordmark extends StatelessWidget {
  const BrandWordmark({super.key, this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: compact ? 30 : 36,
          height: compact ? 30 : 36,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(compact ? 9 : 11),
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.accent, AppColors.accentStrong],
            ),
          ),
          child: Icon(Icons.sports_esports_rounded, size: compact ? 17 : 20, color: Colors.white),
        ),
        const SizedBox(width: 10),
        Text(
          'CLUTCHNEX',
          style: TextStyle(
            fontSize: compact ? 13 : 14,
            fontWeight: FontWeight.w900,
            letterSpacing: 1.5,
            color: AppColors.foreground,
          ),
        ),
      ],
    );
  }
}

class SectionHeading extends StatelessWidget {
  const SectionHeading(this.title, {super.key, this.action, this.onAction});

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
        if (action != null)
          TextButton(onPressed: onAction, child: Text(action!, style: const TextStyle(fontSize: 12))),
      ],
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.label, {super.key, this.color});

  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tint = color ?? _statusColor(label);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(30),
        border: Border.all(color: tint.withValues(alpha: 0.25)),
      ),
      child: Text(
        label.toUpperCase(),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: tint, fontSize: 9, fontWeight: FontWeight.w900, letterSpacing: 0.8),
      ),
    );
  }

  Color _statusColor(String value) {
    final status = value.toUpperCase();
    if (status.contains('LIVE') || status.contains('OPEN') || status.contains('CONFIRMED')) return AppColors.success;
    if (status.contains('COMPLETED') || status.contains('PUBLISHED') || status.contains('APPROVED')) return AppColors.info;
    if (status.contains('CANCEL') || status.contains('REJECT') || status.contains('CLOSED')) return AppColors.danger;
    if (status.contains('PENDING') || status.contains('UPCOMING') || status.contains('NOT_OPEN')) return AppColors.reward;
    return AppColors.accentSoft;
  }
}

class LoadingPanel extends StatelessWidget {
  const LoadingPanel({super.key, this.label = 'Loading the arena…'});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5)),
            const SizedBox(height: 16),
            Text(label, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

class ErrorPanel extends StatelessWidget {
  const ErrorPanel({required this.message, required this.onRetry, super.key});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      child: Column(
        children: [
          const Icon(Icons.wifi_off_rounded, color: AppColors.muted, size: 28),
          const SizedBox(height: 10),
          Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}

class EmptyPanel extends StatelessWidget {
  const EmptyPanel({
    required this.title,
    required this.message,
    super.key,
    this.icon = Icons.sports_esports_outlined,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 30),
      child: Column(
        children: [
          Icon(icon, size: 34, color: AppColors.accentSoft),
          const SizedBox(height: 14),
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 7),
          Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    );
  }
}

class TournamentCard extends StatelessWidget {
  const TournamentCard({required this.tournament, super.key, this.horizontal = false});

  final Tournament tournament;
  final bool horizontal;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => context.push('/tournament/${Uri.encodeComponent(tournament.slug)}'),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.panel,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _TournamentArtwork(tournament: tournament, height: horizontal ? 110 : 148),
            Padding(
              padding: const EdgeInsets.all(15),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: StatusPill(statusLabel(tournament.status))),
                      const SizedBox(width: 8),
                      Text(typeLabel(tournament.type), style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                  const SizedBox(height: 11),
                  Text(
                    tournament.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(color: AppColors.foreground),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(child: _MiniMetric(label: 'PRIZE POOL', value: money(tournament.prizePool), tint: AppColors.reward)),
                      const SizedBox(width: 10),
                      Expanded(child: _MiniMetric(label: 'ENTRY', value: tournament.entryFee == 0 ? 'Free' : money(tournament.entryFee))),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Icon(Icons.groups_2_outlined, size: 15, color: AppColors.muted),
                      const SizedBox(width: 5),
                      Expanded(
                        child: Text(
                          '${tournament.registeredSlots}/${tournament.maxSlots} ${tournament.capacityUnit}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                      const Icon(Icons.arrow_forward_rounded, size: 16, color: AppColors.accentSoft),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TournamentArtwork extends StatelessWidget {
  const _TournamentArtwork({required this.tournament, required this.height});

  final Tournament tournament;
  final double height;

  @override
  Widget build(BuildContext context) {
    final imageUrl = AppConfig.mediaUrl(tournament.banner);
    return SizedBox(
      height: height,
      width: double.infinity,
      child: Stack(
        fit: StackFit.expand,
        children: [
          DecoratedBox(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF252046), Color(0xFF121A2D), Color(0xFF0A0E19)],
              ),
            ),
            child: const Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: EdgeInsets.only(right: 24),
                child: Icon(Icons.bolt_rounded, size: 62, color: Color(0x508B5CF6)),
              ),
            ),
          ),
          if (imageUrl != null)
            CachedNetworkImage(
              imageUrl: imageUrl,
              fit: BoxFit.cover,
              errorWidget: (_, __, ___) => const SizedBox.shrink(),
              placeholder: (_, __) => const SizedBox.shrink(),
            ),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Colors.black.withValues(alpha: 0.02), Colors.black.withValues(alpha: 0.5)],
              ),
            ),
          ),
          Positioned(
            left: 14,
            bottom: 12,
            child: Row(
              children: [
                const Icon(Icons.location_on_outlined, color: Colors.white70, size: 14),
                const SizedBox(width: 3),
                Text(tournament.map, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
          if (tournament.raw['isVerified'] == true)
            const Positioned(
              top: 12,
              right: 12,
              child: Icon(Icons.verified_rounded, color: AppColors.accentSoft, size: 20),
            ),
        ],
      ),
    );
  }
}

class _MiniMetric extends StatelessWidget {
  const _MiniMetric({required this.label, required this.value, this.tint = AppColors.foreground});

  final String label;
  final String value;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.muted, fontSize: 8)),
        const SizedBox(height: 3),
        Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: tint, fontSize: 13, fontWeight: FontWeight.w800)),
      ],
    );
  }
}

void showAppMessage(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

String errorMessage(Object error) =>
    error is Exception ? error.toString().replaceFirst('Exception: ', '') : '$error';
