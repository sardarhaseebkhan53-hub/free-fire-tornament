import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

class TeamsScreen extends ConsumerWidget {
  const TeamsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teams = ref.watch(teamsProvider);
    final invites = ref.watch(teamInvitesProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Teams'),
        actions: [
          IconButton(tooltip: 'Join with a code', onPressed: () => _joinByCode(context, ref), icon: const Icon(Icons.key_rounded)),
          IconButton(tooltip: 'Create a team', onPressed: () => _createTeam(context, ref), icon: const Icon(Icons.add_circle_outline_rounded)),
          const SizedBox(width: 4),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.accentSoft,
        onRefresh: () async {
          await Future.wait([ref.refresh(teamsProvider.future), ref.refresh(teamInvitesProvider.future)]);
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 30),
          children: [
            AppPanel(
              padding: const EdgeInsets.all(16),
              child: Row(children: [
                const Icon(Icons.groups_2_rounded, color: AppColors.accentSoft, size: 23),
                const SizedBox(width: 11),
                Expanded(child: Text('Build a DUO or SQUAD, share a join code, and register your roster for team events.', style: Theme.of(context).textTheme.bodySmall)),
              ]),
            ),
            const SizedBox(height: 22),
            const SectionHeading('Your teams'),
            const SizedBox(height: 10),
            teams.when(
              loading: () => const LinearProgressIndicator(minHeight: 2),
              error: (error, stack) => ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(teamsProvider)),
              data: (rows) {
                if (rows.isEmpty) {
                  return EmptyPanel(
                    title: 'No team yet',
                    message: 'Create a duo or squad, or use an invite code from your captain.',
                    icon: Icons.groups_outlined,
                    actionLabel: 'Create a team',
                    onAction: () => _createTeam(context, ref),
                  );
                }
                return Column(children: rows.map((row) => _TeamListCard(row: row)).toList());
              },
            ),
            const SizedBox(height: 24),
            SectionHeading('Invitations', action: invites.valueOrNull?.length.toString()),
            const SizedBox(height: 10),
            invites.when(
              loading: () => const LinearProgressIndicator(minHeight: 2),
              error: (error, stack) => ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(teamInvitesProvider)),
              data: (items) => items.isEmpty
                  ? Text('No team invites right now.', style: Theme.of(context).textTheme.bodySmall)
                  : Column(children: items.map((invite) => _InviteCard(invite: invite)).toList()),
            ),
            const SizedBox(height: 20),
            Row(children: [
              Expanded(child: OutlinedButton.icon(onPressed: () => _joinByCode(context, ref), icon: const Icon(Icons.key_rounded, size: 18), label: const Text('JOIN WITH CODE'))),
              const SizedBox(width: 10),
              Expanded(child: ElevatedButton.icon(onPressed: () => _createTeam(context, ref), icon: const Icon(Icons.add_rounded, size: 18), label: const Text('CREATE TEAM'))),
            ]),
          ],
        ),
      ),
    );
  }

  Future<void> _createTeam(BuildContext context, WidgetRef ref) async {
    final result = await showDialog<JsonMap>(context: context, builder: (_) => const _CreateTeamDialog());
    if (result == null || !context.mounted) return;
    try {
      final created = await ref.read(apiClientProvider).createTeam(name: stringValue(result['name']), tag: stringValue(result['tag']), type: stringValue(result['type']));
      ref.invalidate(teamsProvider);
      if (context.mounted) showAppMessage(context, 'Team ${stringValue(created['name'])} created. Your join code is ready.');
    } catch (error) {
      if (context.mounted) showAppMessage(context, errorMessage(error));
    }
  }

  Future<void> _joinByCode(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Join a team'),
        content: TextField(controller: controller, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Invite code', hintText: 'CNX-ABCDE')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(dialogContext, controller.text.trim()), child: const Text('JOIN')),
        ],
      ),
    );
    controller.dispose();
    if (code == null || code.isEmpty || !context.mounted) return;
    try {
      final team = await ref.read(apiClientProvider).joinTeamByCode(code);
      ref.invalidate(teamsProvider);
      if (context.mounted) showAppMessage(context, 'Joined ${stringValue(team['name'])} [${stringValue(team['tag'])}].');
    } catch (error) {
      if (context.mounted) showAppMessage(context, errorMessage(error));
    }
  }
}

class _CreateTeamDialog extends StatefulWidget {
  const _CreateTeamDialog();

  @override
  State<_CreateTeamDialog> createState() => _CreateTeamDialogState();
}

class _CreateTeamDialogState extends State<_CreateTeamDialog> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _tag = TextEditingController();
  String _type = 'DUO';

  @override
  void dispose() {
    _name.dispose();
    _tag.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create a team'),
      content: Form(
        key: _formKey,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextFormField(controller: _name, decoration: const InputDecoration(labelText: 'Team name'), validator: (value) => value == null || value.trim().length < 3 ? 'Use at least 3 characters.' : null),
          const SizedBox(height: 11),
          TextFormField(controller: _tag, maxLength: 5, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Team tag', hintText: '2–5 letters or numbers'), validator: (value) => value == null || !RegExp(r'^[a-zA-Z0-9]{2,5}$').hasMatch(value.trim()) ? 'Use 2–5 letters or numbers.' : null),
          const SizedBox(height: 7),
          DropdownButtonFormField<String>(
            value: _type,
            decoration: const InputDecoration(labelText: 'Team format'),
            items: const [DropdownMenuItem(value: 'DUO', child: Text('DUO · 2 players')), DropdownMenuItem(value: 'SQUAD', child: Text('SQUAD · 4 players'))],
            onChanged: (value) => setState(() => _type = value ?? _type),
          ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        ElevatedButton(onPressed: () {
          if (!_formKey.currentState!.validate()) return;
          Navigator.pop(context, {'name': _name.text.trim(), 'tag': _tag.text.trim().toUpperCase(), 'type': _type});
        }, child: const Text('CREATE')),
      ],
    );
  }
}

class _TeamListCard extends ConsumerWidget {
  const _TeamListCard({required this.row});
  final JsonMap row;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final team = asJson(row['team']);
    final members = jsonList(team['members']);
    final id = stringValue(team['id']);
    final role = stringValue(row['role'], fallback: 'MEMBER');
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: InkWell(
        onTap: () => context.push('/team/${Uri.encodeComponent(id)}'),
        borderRadius: BorderRadius.circular(17),
        child: AppPanel(
          padding: const EdgeInsets.all(15),
          borderRadius: 17,
          child: Row(children: [
            Container(width: 45, height: 45, decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(14)), child: Icon(stringValue(team['type']) == 'DUO' ? Icons.people_alt_rounded : Icons.groups_rounded, color: AppColors.accentSoft)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${stringValue(team['name'])} [${stringValue(team['tag'])}]', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text('${typeLabel(stringValue(team['type']))} · ${members.length} member${members.length == 1 ? '' : 's'}', style: Theme.of(context).textTheme.bodySmall),
            ])),
            StatusPill(role == 'CAPTAIN' ? 'Captain' : 'Member', color: role == 'CAPTAIN' ? AppColors.reward : AppColors.accentSoft),
          ]),
        ),
      ),
    );
  }
}

class _InviteCard extends ConsumerWidget {
  const _InviteCard({required this.invite});
  final JsonMap invite;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final team = asJson(invite['team']);
    final inviter = asJson(invite['invitedBy']);
    final id = stringValue(invite['id']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: AppPanel(
        padding: const EdgeInsets.all(13),
        borderRadius: 15,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${stringValue(team['name'])} [${stringValue(team['tag'])}]', style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('${typeLabel(stringValue(team['type']))} · invited by @${stringValue(inviter['username'], fallback: 'captain')}', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 11),
          Row(children: [
            Expanded(child: OutlinedButton(onPressed: () => _respond(context, ref, id, false), child: const Text('DECLINE'))),
            const SizedBox(width: 9),
            Expanded(child: ElevatedButton(onPressed: () => _respond(context, ref, id, true), child: const Text('ACCEPT'))),
          ]),
        ]),
      ),
    );
  }

  Future<void> _respond(BuildContext context, WidgetRef ref, String id, bool accept) async {
    try {
      await ref.read(apiClientProvider).respondToTeamInvite(id, accept: accept);
      ref.invalidate(teamsProvider);
      ref.invalidate(teamInvitesProvider);
      if (context.mounted) showAppMessage(context, accept ? 'Invite accepted.' : 'Invite declined.');
    } catch (error) {
      if (context.mounted) showAppMessage(context, errorMessage(error));
    }
  }
}

class TeamDetailScreen extends ConsumerWidget {
  const TeamDetailScreen({required this.teamId, super.key});
  final String teamId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(teamDetailProvider(teamId));
    return Scaffold(
      appBar: AppBar(title: const Text('Team details')),
      body: detail.when(
        loading: () => const LoadingPanel(label: 'Loading team…'),
        error: (error, stack) => Padding(padding: const EdgeInsets.all(20), child: ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(teamDetailProvider(teamId)))),
        data: (team) => _TeamDetailBody(team: team),
      ),
    );
  }
}

class _TeamDetailBody extends ConsumerWidget {
  const _TeamDetailBody({required this.team});
  final JsonMap team;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final player = ref.watch(authControllerProvider).valueOrNull;
    final members = jsonList(team['members']);
    final isCaptain = player?.id == stringValue(team['captainId']);
    final id = stringValue(team['id']);
    final maxMembers = stringValue(team['type']) == 'DUO' ? 2 : 4;

    return RefreshIndicator(
      onRefresh: () async { await ref.refresh(teamDetailProvider(id).future); },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 5, 20, 30),
        children: [
          AppPanel(
            padding: const EdgeInsets.all(19),
            gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF28204B), AppColors.panel]),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(width: 47, height: 47, decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(14)), child: const Icon(Icons.groups_rounded, color: AppColors.accentSoft)),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(stringValue(team['name']), style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 4),
                  Text('[${stringValue(team['tag'])}] · ${typeLabel(stringValue(team['type']))}', style: Theme.of(context).textTheme.bodySmall),
                ])),
                if (isCaptain) const StatusPill('Captain', color: AppColors.reward),
              ]),
              const SizedBox(height: 18),
              Row(children: [
                Expanded(child: Text('${members.length}/$maxMembers roster spaces filled', style: Theme.of(context).textTheme.bodySmall)),
                Text('Captain · @${stringValue(asJson(team['captain'])['username'])}', style: const TextStyle(color: AppColors.secondary, fontSize: 11, fontWeight: FontWeight.w700)),
              ]),
              const SizedBox(height: 8),
              ClipRRect(borderRadius: BorderRadius.circular(9), child: LinearProgressIndicator(value: (members.length / maxMembers).clamp(0.0, 1.0), minHeight: 6, backgroundColor: Colors.white.withValues(alpha: 0.08))),
            ]),
          ),
          const SizedBox(height: 21),
          SectionHeading('Roster', action: '${members.length} players'),
          const SizedBox(height: 9),
          ...members.map((member) => _TeamMemberRow(member: member, canManage: isCaptain, teamId: id)),
          const SizedBox(height: 18),
          if (isCaptain) ...[
            ElevatedButton.icon(onPressed: () => _showJoinCode(context, ref, id), icon: const Icon(Icons.key_rounded), label: const Text('SHOW / COPY JOIN CODE')),
            const SizedBox(height: 9),
            OutlinedButton.icon(onPressed: () => _invite(context, ref, id), icon: const Icon(Icons.person_add_alt_1_rounded), label: const Text('INVITE PLAYER BY USERNAME')),
            const SizedBox(height: 9),
            OutlinedButton.icon(onPressed: () => _edit(context, ref, team), icon: const Icon(Icons.edit_outlined), label: const Text('EDIT TEAM NAME / TAG')),
          ] else
            OutlinedButton.icon(onPressed: () => _leave(context, ref, id), icon: const Icon(Icons.logout_rounded), label: const Text('LEAVE TEAM')),
          const SizedBox(height: 22),
          if (jsonList(team['registrations']).isNotEmpty) ...[
            const SectionHeading('Active registrations'),
            const SizedBox(height: 8),
            ...jsonList(team['registrations']).take(5).map((registration) {
              final tournament = asJson(registration['tournament']);
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(stringValue(tournament['title']), style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700)),
                subtitle: Text('${typeLabel(stringValue(tournament['type']))} · ${statusLabel(stringValue(tournament['status']))}', style: Theme.of(context).textTheme.bodySmall),
                trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
                onTap: () => context.push('/tournament/${Uri.encodeComponent(stringValue(tournament['slug']))}'),
              );
            }),
          ],
        ],
      ),
    );
  }

  Future<void> _showJoinCode(BuildContext context, WidgetRef ref, String teamId) async {
    try {
      final result = await ref.read(apiClientProvider).teamJoinCode(teamId);
      final code = stringValue(result['code']);
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Team join code'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('Share this code with the player you want to invite.'),
            const SizedBox(height: 15),
            SelectableText(code, style: const TextStyle(color: AppColors.accentSoft, fontSize: 22, fontWeight: FontWeight.w900, letterSpacing: 1.4)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Close')),
            ElevatedButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: code));
                if (dialogContext.mounted) Navigator.pop(dialogContext);
                if (context.mounted) showAppMessage(context, 'Join code copied.');
              },
              icon: const Icon(Icons.copy_rounded, size: 17),
              label: const Text('COPY'),
            ),
          ],
        ),
      );
    } catch (error) {
      if (context.mounted) showAppMessage(context, errorMessage(error));
    }
  }

  Future<void> _invite(BuildContext context, WidgetRef ref, String teamId) async {
    final username = TextEditingController();
    final result = await showDialog<String>(context: context, builder: (dialogContext) => AlertDialog(
      title: const Text('Invite a player'),
      content: TextField(controller: username, autocorrect: false, decoration: const InputDecoration(labelText: 'Username', prefixIcon: Icon(Icons.alternate_email_rounded))),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')), ElevatedButton(onPressed: () => Navigator.pop(dialogContext, username.text.trim()), child: const Text('SEND INVITE'))],
    ));
    username.dispose();
    if (result == null || result.isEmpty || !context.mounted) return;
    try {
      await ref.read(apiClientProvider).inviteToTeam(teamId, result);
      if (context.mounted) showAppMessage(context, 'Invite sent to @$result.');
    } catch (error) {
      if (context.mounted) showAppMessage(context, errorMessage(error));
    }
  }

  Future<void> _edit(BuildContext context, WidgetRef ref, JsonMap team) async {
    final name = TextEditingController(text: stringValue(team['name']));
    final tag = TextEditingController(text: stringValue(team['tag']));
    final result = await showDialog<JsonMap>(context: context, builder: (dialogContext) => AlertDialog(
      title: const Text('Edit team'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: name, decoration: const InputDecoration(labelText: 'Team name')),
        const SizedBox(height: 10),
        TextField(controller: tag, maxLength: 5, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Tag')),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')), ElevatedButton(onPressed: () => Navigator.pop(dialogContext, {'name': name.text.trim(), 'tag': tag.text.trim()}), child: const Text('SAVE'))],
    ));
    name.dispose();
    tag.dispose();
    if (result == null || !context.mounted) return;
    try {
      await ref.read(apiClientProvider).updateTeam(stringValue(team['id']), result);
      ref.invalidate(teamDetailProvider(stringValue(team['id'])));
      ref.invalidate(teamsProvider);
      if (context.mounted) showAppMessage(context, 'Team updated.');
    } catch (error) {
      if (context.mounted) showAppMessage(context, errorMessage(error));
    }
  }

  Future<void> _leave(BuildContext context, WidgetRef ref, String teamId) async {
    final confirmed = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: const Text('Leave this team?'),
      content: const Text('You will need a new invite to rejoin.'),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')), ElevatedButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('LEAVE'))],
    ));
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(apiClientProvider).leaveTeam(teamId);
      ref.invalidate(teamsProvider);
      if (context.mounted) context.pop();
    } catch (error) {
      if (context.mounted) showAppMessage(context, errorMessage(error));
    }
  }
}

class _TeamMemberRow extends ConsumerWidget {
  const _TeamMemberRow({required this.member, required this.canManage, required this.teamId});
  final JsonMap member;
  final bool canManage;
  final String teamId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = asJson(member['user']);
    final profile = asJson(user['profile']);
    final username = stringValue(user['username'], fallback: 'Player');
    final role = stringValue(member['role'], fallback: 'MEMBER');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppPanel(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
        borderRadius: 14,
        child: Row(children: [
          CircleAvatar(radius: 18, backgroundColor: AppColors.accent.withValues(alpha: 0.13), child: Text(username.isNotEmpty ? username[0].toUpperCase() : 'P', style: const TextStyle(color: AppColors.accentSoft, fontWeight: FontWeight.w900))),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(stringValue(profile['freeFireIGN'], fallback: username), style: const TextStyle(color: AppColors.foreground, fontSize: 13, fontWeight: FontWeight.w800)),
            const SizedBox(height: 3),
            Text('@$username · ${role.toLowerCase()}', style: Theme.of(context).textTheme.bodySmall),
          ])),
          if (canManage && role != 'CAPTAIN')
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert_rounded, color: AppColors.muted),
              onSelected: (action) async {
                try {
                  final userId = stringValue(member['userId']);
                  if (action == 'remove') {
                    await ref.read(apiClientProvider).removeTeamMember(teamId, userId);
                    ref.invalidate(teamDetailProvider(teamId));
                    ref.invalidate(teamsProvider);
                  } else if (action == 'captain') {
                    await ref.read(apiClientProvider).transferCaptaincy(teamId, userId);
                    ref.invalidate(teamDetailProvider(teamId));
                    ref.invalidate(teamsProvider);
                  }
                } catch (error) {
                  if (context.mounted) showAppMessage(context, errorMessage(error));
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'captain', child: Text('Make captain')),
                PopupMenuItem(value: 'remove', child: Text('Remove player')),
              ],
            ),
        ]),
      ),
    );
  }
}
