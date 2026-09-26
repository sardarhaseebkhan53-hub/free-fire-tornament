import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

const _ticketCategories = <(String, String)>[
  ('PAYMENT', 'Payment'),
  ('TOURNAMENT', 'Tournament'),
  ('WITHDRAWAL', 'Withdrawal'),
  ('ACCOUNT', 'Account'),
  ('TEAM', 'Team'),
  ('TECHNICAL', 'Technical issue'),
  ('REPORT_PLAYER', 'Report a player'),
  ('OTHER', 'Other'),
];

class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(supportTicketsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Support center')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openCreate(context, ref),
        backgroundColor: AppColors.accentStrong,
        icon: const Icon(Icons.add_rounded),
        label: const Text('NEW TICKET'),
      ),
      body: RefreshIndicator(
        color: AppColors.accentSoft,
        onRefresh: () async { await ref.refresh(supportTicketsProvider.future); },
        child: tickets.when(
          loading: () => const LoadingPanel(label: 'Loading support tickets…'),
          error: (error, stack) => ListView(padding: const EdgeInsets.all(20), children: [ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(supportTicketsProvider))]),
          data: (items) => ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 5, 20, 95),
            children: [
              AppPanel(
                padding: const EdgeInsets.all(15),
                child: Row(children: [
                  const Icon(Icons.support_agent_rounded, color: AppColors.accentSoft, size: 23),
                  const SizedBox(width: 11),
                  Expanded(child: Text('Our support team can help with payments, tournament entries, teams and account access.', style: Theme.of(context).textTheme.bodySmall)),
                ]),
              ),
              const SizedBox(height: 21),
              SectionHeading('Your tickets', action: '${items.length} total'),
              const SizedBox(height: 10),
              if (items.isEmpty)
                EmptyPanel(title: 'No support tickets', message: 'Open a ticket and follow staff replies in one thread.', icon: Icons.support_agent_outlined, actionLabel: 'Open a ticket', onAction: () => _openCreate(context, ref))
              else
                ...items.map((ticket) => _TicketListCard(ticket: ticket)),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openCreate(BuildContext context, WidgetRef ref) async {
    final result = await showModalBottomSheet<JsonMap>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.surface,
      builder: (_) => const _CreateTicketSheet(),
    );
    if (result == null || !context.mounted) return;
    try {
      final ticket = await ref.read(apiClientProvider).createSupportTicket(
            category: stringValue(result['category']),
            subject: stringValue(result['subject']),
            priority: stringValue(result['priority']),
            message: stringValue(result['message']),
          );
      ref.invalidate(supportTicketsProvider);
      if (context.mounted) showAppMessage(context, 'Ticket ${stringValue(ticket['ref'])} opened.');
    } catch (error) {
      if (context.mounted) showAppMessage(context, errorMessage(error));
    }
  }
}

class _CreateTicketSheet extends StatefulWidget {
  const _CreateTicketSheet();
  @override
  State<_CreateTicketSheet> createState() => _CreateTicketSheetState();
}

class _CreateTicketSheetState extends State<_CreateTicketSheet> {
  final _formKey = GlobalKey<FormState>();
  final _subject = TextEditingController();
  final _message = TextEditingController();
  String _category = 'TOURNAMENT';
  String _priority = 'MEDIUM';

  @override
  void dispose() {
    _subject.dispose();
    _message.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(child: Container(width: 42, height: 4, decoration: BoxDecoration(color: AppColors.muted, borderRadius: BorderRadius.circular(5)))),
        const SizedBox(height: 18),
        Text('Open a support ticket', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 6),
        Text('Add enough detail so our staff can get you back into the game.', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 16),
        Form(key: _formKey, child: Column(children: [
          DropdownButtonFormField<String>(
            value: _category,
            decoration: const InputDecoration(labelText: 'Category'),
            items: _ticketCategories.map((entry) => DropdownMenuItem(value: entry.$1, child: Text(entry.$2))).toList(),
            onChanged: (value) => setState(() => _category = value ?? _category),
          ),
          const SizedBox(height: 10),
          TextFormField(controller: _subject, maxLength: 120, decoration: const InputDecoration(labelText: 'Subject'), validator: (value) => value == null || value.trim().length < 5 ? 'Use at least 5 characters.' : null),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: _priority,
            decoration: const InputDecoration(labelText: 'Priority'),
            items: const [DropdownMenuItem(value: 'LOW', child: Text('Low')), DropdownMenuItem(value: 'MEDIUM', child: Text('Medium')), DropdownMenuItem(value: 'HIGH', child: Text('High')), DropdownMenuItem(value: 'URGENT', child: Text('Urgent'))],
            onChanged: (value) => setState(() => _priority = value ?? _priority),
          ),
          const SizedBox(height: 10),
          TextFormField(controller: _message, maxLines: 5, maxLength: 4000, decoration: const InputDecoration(labelText: 'Describe your issue', alignLabelWithHint: true), validator: (value) => value == null || value.trim().length < 10 ? 'Please describe the issue in at least 10 characters.' : null),
        ])),
        const SizedBox(height: 14),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: () {
          if (!_formKey.currentState!.validate()) return;
          Navigator.pop(context, {'category': _category, 'subject': _subject.text.trim(), 'priority': _priority, 'message': _message.text.trim()});
        }, child: const Text('SEND TO SUPPORT'))),
      ])),
    );
  }
}

class _TicketListCard extends StatelessWidget {
  const _TicketListCard({required this.ticket});
  final JsonMap ticket;

  @override
  Widget build(BuildContext context) {
    final status = stringValue(ticket['status'], fallback: 'OPEN');
    final lastMessage = asJson(ticket['lastMessage']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: InkWell(
        onTap: () => context.push('/support/${Uri.encodeComponent(stringValue(ticket['id']))}'),
        borderRadius: BorderRadius.circular(16),
        child: AppPanel(
          padding: const EdgeInsets.all(14),
          borderRadius: 16,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(stringValue(ticket['subject']), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800, fontSize: 13))),
              StatusPill(statusLabel(status)),
            ]),
            const SizedBox(height: 6),
            Text('${stringValue(ticket['ref'])} · ${statusLabel(stringValue(ticket['category']))} · ${intValue(ticket['replies'])} replies', style: Theme.of(context).textTheme.bodySmall),
            if (lastMessage.isNotEmpty) ...[
              const SizedBox(height: 9),
              Text(stringValue(lastMessage['preview']), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.secondary, fontSize: 12)),
            ],
            const SizedBox(height: 8),
            Text('Updated ${dateLabel(ticket['updatedAt'])}', style: const TextStyle(color: AppColors.muted, fontSize: 10)),
          ]),
        ),
      ),
    );
  }
}

class SupportTicketScreen extends ConsumerStatefulWidget {
  const SupportTicketScreen({required this.ticketId, super.key});
  final String ticketId;

  @override
  ConsumerState<SupportTicketScreen> createState() => _SupportTicketScreenState();
}

class _SupportTicketScreenState extends ConsumerState<SupportTicketScreen> {
  final _reply = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _closeTicket() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Close this ticket?'),
        content: const Text('You can open a new ticket if you need help again.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Keep open')),
          ElevatedButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('CLOSE TICKET')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref.read(apiClientProvider).closeSupportTicket(widget.ticketId);
      ref.invalidate(supportThreadProvider(widget.ticketId));
      ref.invalidate(supportTicketsProvider);
    } catch (error) {
      if (mounted) showAppMessage(context, errorMessage(error));
    }
  }

  Future<void> _sendReply() async {
    if (_reply.text.trim().isEmpty) return;
    setState(() => _sending = true);
    try {
      await ref.read(apiClientProvider).replyToSupportTicket(widget.ticketId, _reply.text.trim());
      _reply.clear();
      ref.invalidate(supportThreadProvider(widget.ticketId));
      ref.invalidate(supportTicketsProvider);
    } catch (error) {
      if (mounted) showAppMessage(context, errorMessage(error));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final thread = ref.watch(supportThreadProvider(widget.ticketId));
    return Scaffold(
      appBar: AppBar(title: const Text('Support thread')),
      body: thread.when(
        loading: () => const LoadingPanel(label: 'Loading conversation…'),
        error: (error, stack) => Padding(padding: const EdgeInsets.all(20), child: ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(supportThreadProvider(widget.ticketId)))),
        data: (data) {
          final status = stringValue(data['status'], fallback: 'OPEN');
          final messages = jsonList(data['messages']);
          final closed = status == 'CLOSED';
          return Column(children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 6, 20, 16),
                children: [
                  AppPanel(
                    padding: const EdgeInsets.all(15),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [Expanded(child: Text(stringValue(data['subject']), style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800))), StatusPill(statusLabel(status))]),
                      const SizedBox(height: 5),
                      Text('${stringValue(data['ref'])} · ${statusLabel(stringValue(data['category']))}', style: Theme.of(context).textTheme.bodySmall),
                    ]),
                  ),
                  const SizedBox(height: 16),
                  ...messages.map((message) => _MessageBubble(message: message)),
                ],
              ),
            ),
            if (!closed) ...[
              Align(alignment: Alignment.centerRight, child: TextButton(onPressed: _closeTicket, child: const Text('Close ticket'))),
              SafeArea(
                top: false,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
                  decoration: const BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.line))),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Expanded(child: TextField(controller: _reply, enabled: !_sending, minLines: 1, maxLines: 4, decoration: const InputDecoration(hintText: 'Reply to support…', contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)))),
                    const SizedBox(width: 8),
                    IconButton.filled(onPressed: _sending ? null : _sendReply, icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send_rounded, size: 18)),
                  ]),
                ),
              ),
            ] else
              const Padding(padding: EdgeInsets.all(16), child: Text('This ticket is closed. Open a new ticket if you need more help.', style: TextStyle(color: AppColors.muted, fontSize: 12))),
          ]);
        },
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});
  final JsonMap message;

  @override
  Widget build(BuildContext context) {
    final staff = message['isStaff'] == true;
    return Align(
      alignment: staff ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.82),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: staff ? AppColors.elevated : AppColors.accentStrong.withValues(alpha: 0.26),
          borderRadius: BorderRadius.only(topLeft: const Radius.circular(15), topRight: const Radius.circular(15), bottomLeft: Radius.circular(staff ? 4 : 15), bottomRight: Radius.circular(staff ? 15 : 4)),
          border: Border.all(color: staff ? AppColors.line : AppColors.accent.withValues(alpha: 0.24)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(stringValue(message['sender'], fallback: staff ? 'Support team' : 'You'), style: TextStyle(color: staff ? AppColors.accentSoft : AppColors.foreground, fontSize: 10, fontWeight: FontWeight.w900)),
          const SizedBox(height: 6),
          Text(stringValue(message['body']), style: const TextStyle(color: AppColors.foreground, fontSize: 13, height: 1.45)),
          const SizedBox(height: 6),
          Text(dateLabel(message['createdAt'], pattern: 'd MMM · h:mm a'), style: const TextStyle(color: AppColors.muted, fontSize: 9)),
        ]),
      ),
    );
  }
}
