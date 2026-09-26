import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(authControllerProvider);
    return SafeArea(
      bottom: false,
      child: session.when(
        loading: () => const LoadingPanel(label: 'Loading your player profile…'),
        error: (_, __) => const _GuestProfile(),
        data: (player) => player == null ? const _GuestProfile() : _SignedInProfile(player: player),
      ),
    );
  }
}

class _GuestProfile extends StatelessWidget {
  const _GuestProfile();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 30),
      children: [
        Text('Player profile', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 18),
        AppPanel(
          padding: const EdgeInsets.all(22),
          gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF28204B), AppColors.panel]),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const BrandWordmark(),
            const SizedBox(height: 24),
            Text('Your next win starts here.', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text('Sign in to manage matches, teams, wallet activity and your Free Fire identity.', style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 18),
            SizedBox(width: double.infinity, child: ElevatedButton(onPressed: () => context.push('/sign-in'), child: const Text('SIGN IN'))),
            const SizedBox(height: 7),
            SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => context.push('/register'), child: const Text('CREATE ACCOUNT'))),
          ]),
        ),
        const SizedBox(height: 18),
        _ProfileLink(icon: Icons.help_outline_rounded, title: 'NEXA help', subtitle: 'Ask about tournaments and the platform', onTap: () => context.push('/nexa')),
      ],
    );
  }
}

class _SignedInProfile extends ConsumerWidget {
  const _SignedInProfile({required this.player});
  final Player player;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rank = player.rankInfo;
    final missingLabels = (player.raw['missingProfileFields'] is List)
        ? (player.raw['missingProfileFields'] as List).map((value) => value.toString()).toList()
        : <String>[];

    return RefreshIndicator(
      onRefresh: () async { await ref.read(authControllerProvider.notifier).refreshProfile(); },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 30),
        children: [
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Player profile', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text('Your CLUTCHNEX identity and settings.', style: Theme.of(context).textTheme.bodySmall),
            ])),
            IconButton(onPressed: () => context.push('/notifications'), tooltip: 'Notifications', style: IconButton.styleFrom(backgroundColor: AppColors.elevated), icon: const Icon(Icons.notifications_none_rounded)),
          ]),
          const SizedBox(height: 18),
          AppPanel(
            padding: const EdgeInsets.all(19),
            gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF242042), AppColors.panel]),
            child: Row(children: [
              CircleAvatar(
                radius: 29,
                backgroundColor: AppColors.accent.withValues(alpha: 0.19),
                child: Text(player.username.isNotEmpty ? player.username[0].toUpperCase() : 'P', style: const TextStyle(color: AppColors.accentSoft, fontSize: 22, fontWeight: FontWeight.w900)),
              ),
              const SizedBox(width: 14),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(player.fullName, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 4),
                Text('@${player.username}', style: Theme.of(context).textTheme.bodySmall),
                if (player.email.isNotEmpty) ...[const SizedBox(height: 3), Text(player.email, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall)],
              ])),
              IconButton(onPressed: () => context.push('/profile/edit'), tooltip: 'Edit profile', icon: const Icon(Icons.edit_outlined, color: AppColors.accentSoft)),
            ]),
          ),
          if (rank.isNotEmpty) ...[
            const SizedBox(height: 12),
            AppPanel(
              padding: const EdgeInsets.all(15),
              child: Row(children: [
                const Icon(Icons.shield_rounded, color: AppColors.reward, size: 23),
                const SizedBox(width: 10),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${stringValue(rank['label'], fallback: 'Bronze')} rank', style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text('${intValue(player.stats['totalPoints'])} career points · ${intValue(player.stats['matchesPlayed'])} matches played', style: Theme.of(context).textTheme.bodySmall),
                ])),
                if (rank['progress'] != null) Text('${intValue(rank['progress'])}%', style: const TextStyle(color: AppColors.accentSoft, fontWeight: FontWeight.w900)),
              ]),
            ),
          ],
          if (!player.profileComplete) ...[
            const SizedBox(height: 12),
            InkWell(
              onTap: () => context.push('/profile/edit'),
              borderRadius: BorderRadius.circular(16),
              child: AppPanel(
                padding: const EdgeInsets.all(15),
                child: Row(children: [
                  const Icon(Icons.info_outline_rounded, color: AppColors.reward),
                  const SizedBox(width: 11),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('Complete your player profile', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 3),
                    Text(missingLabels.isEmpty ? 'Add a valid Free Fire UID, in-game name and phone to enter tournaments.' : 'Missing: ${missingLabels.join(', ')}', style: Theme.of(context).textTheme.bodySmall),
                  ])),
                  const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
                ]),
              ),
            ),
          ],
          const SizedBox(height: 24),
          const SectionHeading('Player hub'),
          const SizedBox(height: 9),
          _ProfileLink(icon: Icons.account_balance_wallet_outlined, title: 'Wallet', subtitle: 'Balance, deposits and withdrawals', onTap: () => context.push('/wallet')),
          _ProfileLink(icon: Icons.groups_2_outlined, title: 'Teams', subtitle: 'Squads, join codes and invitations', onTap: () => context.push('/teams')),
          _ProfileLink(icon: Icons.notifications_none_rounded, title: 'Notifications', subtitle: 'Tournament and account updates', onTap: () => context.push('/notifications')),
          _ProfileLink(icon: Icons.support_agent_rounded, title: 'Support center', subtitle: 'Open a ticket or follow a reply', onTap: () => context.push('/support')),
          _ProfileLink(icon: Icons.auto_awesome_outlined, title: 'NEXA assistant', subtitle: 'Quick help for the arena', onTap: () => context.push('/nexa')),
          const SizedBox(height: 18),
          const SectionHeading('Account security'),
          const SizedBox(height: 9),
          _ProfileLink(icon: Icons.lock_reset_rounded, title: 'Change password', subtitle: 'Update your account password', onTap: () => context.push('/password/change')),
          _ProfileLink(icon: Icons.edit_outlined, title: 'Edit player profile', subtitle: 'Name, phone, Free Fire UID and IGN', onTap: () => context.push('/profile/edit')),
          const SizedBox(height: 17),
          OutlinedButton.icon(
            onPressed: () async {
              final shouldSignOut = await showDialog<bool>(
                context: context,
                builder: (dialogContext) => AlertDialog(
                  title: const Text('Sign out?'),
                  content: const Text('You can sign back in at any time.'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
                    ElevatedButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Sign out')),
                  ],
                ),
              );
              if (shouldSignOut == true) await ref.read(authControllerProvider.notifier).signOut();
            },
            icon: const Icon(Icons.logout_rounded, size: 18),
            label: const Text('SIGN OUT'),
          ),
          const SizedBox(height: 8),
          Text('CLUTCHNEX · Pakistan esports', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _ProfileLink extends StatelessWidget {
  const _ProfileLink({required this.icon, required this.title, required this.subtitle, required this.onTap});

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: AppPanel(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          borderRadius: 15,
          child: Row(children: [
            Container(width: 38, height: 38, decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)), child: Icon(icon, color: AppColors.accentSoft, size: 19)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800, fontSize: 13)),
              const SizedBox(height: 3),
              Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
            ])),
            const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
          ]),
        ),
      ),
    );
  }
}

class ProfileEditScreen extends ConsumerStatefulWidget {
  const ProfileEditScreen({super.key});

  @override
  ConsumerState<ProfileEditScreen> createState() => _ProfileEditScreenState();
}

class _ProfileEditScreenState extends ConsumerState<ProfileEditScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _fullName;
  late final TextEditingController _phone;
  late final TextEditingController _uid;
  late final TextEditingController _ign;
  late final TextEditingController _city;
  late final TextEditingController _bio;
  bool _showPublic = true;
  bool _hydrated = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fullName = TextEditingController();
    _phone = TextEditingController();
    _uid = TextEditingController();
    _ign = TextEditingController();
    _city = TextEditingController();
    _bio = TextEditingController();
    final player = ref.read(authControllerProvider).valueOrNull;
    if (player != null) _hydrate(player);
  }

  void _hydrate(Player player) {
    _fullName.text = player.fullName;
    _phone.text = player.phone;
    _uid.text = player.freeFireUid;
    _ign.text = player.freeFireIgn;
    _city.text = stringValue(player.profile['city']);
    _bio.text = stringValue(player.profile['bio']);
    _showPublic = player.showPublicProfile;
    _hydrated = true;
  }

  @override
  void dispose() {
    _fullName.dispose();
    _phone.dispose();
    _uid.dispose();
    _ign.dispose();
    _city.dispose();
    _bio.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).updateProfile({
        'fullName': _fullName.text.trim(),
        'phone': _phone.text.trim().isEmpty ? null : _phone.text.trim(),
        'freeFireUID': _uid.text.trim().isEmpty ? null : _uid.text.trim(),
        'freeFireIGN': _ign.text.trim().isEmpty ? null : _ign.text.trim(),
        'city': _city.text.trim().isEmpty ? null : _city.text.trim(),
        'bio': _bio.text.trim().isEmpty ? null : _bio.text.trim(),
        'showPublicProfile': _showPublic,
      });
      if (mounted) {
        showAppMessage(context, 'Player profile saved.');
        context.pop();
      }
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(authControllerProvider);
    ref.listen<AsyncValue<Player?>>(authControllerProvider, (previous, next) {
      final player = next.valueOrNull;
      if (player != null && !_hydrated) _hydrate(player);
    });
    if (!_hydrated) {
      return Scaffold(
        appBar: AppBar(title: const Text('Edit profile')),
        body: session.isLoading
            ? const LoadingPanel(label: 'Loading your player profile…')
            : const EmptyPanel(title: 'Sign in required', message: 'Sign in to edit your player profile.', icon: Icons.person_outline_rounded),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Edit profile')),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 6, 20, 28), children: [
        AppPanel(
          padding: const EdgeInsets.all(15),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.verified_user_outlined, color: AppColors.accentSoft),
            const SizedBox(width: 11),
            Expanded(child: Text('A valid phone, Free Fire UID and in-game name are required before entering a tournament.', style: Theme.of(context).textTheme.bodySmall)),
          ]),
        ),
        const SizedBox(height: 16),
        Form(key: _formKey, child: Column(children: [
          TextFormField(controller: _fullName, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name'), validator: (value) => value == null || value.trim().length < 2 ? 'Enter your name.' : null),
          const SizedBox(height: 11),
          TextFormField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone number'), validator: (value) => value == null || value.trim().isEmpty || isValidPlayerPhone(value) ? null : 'Enter 7–15 digits, optionally starting with +.'),
          const SizedBox(height: 11),
          TextFormField(controller: _uid, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Free Fire UID'), validator: (value) => value == null || value.isEmpty || RegExp(r'^\d{5,15}$').hasMatch(value.trim()) ? null : 'UID must be 5–15 digits.'),
          const SizedBox(height: 11),
          TextFormField(controller: _ign, decoration: const InputDecoration(labelText: 'In-game name'), validator: (value) => value == null || value.isEmpty || (value.trim().length >= 2 && value.trim().length <= 24) ? null : 'Name must be 2–24 characters.'),
          const SizedBox(height: 11),
          TextFormField(controller: _city, decoration: const InputDecoration(labelText: 'City (optional)')),
          const SizedBox(height: 11),
          TextFormField(controller: _bio, maxLength: 240, maxLines: 3, decoration: const InputDecoration(labelText: 'Bio (optional)', alignLabelWithHint: true)),
        ])),
        SwitchListTile.adaptive(
          value: _showPublic,
          onChanged: (value) => setState(() => _showPublic = value),
          title: const Text('Show my profile publicly', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          subtitle: const Text('Turn this off to hide your name on participant lists.', style: TextStyle(color: AppColors.muted, fontSize: 12)),
          contentPadding: EdgeInsets.zero,
          activeTrackColor: AppColors.accent,
        ),
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))),
        const SizedBox(height: 8),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy ? null : _save, child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('SAVE PROFILE'))),
      ]),
    );
  }
}

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).changePassword(currentPassword: _current.text, password: _password.text, confirmPassword: _confirm.text);
      await ref.read(authControllerProvider.notifier).signOut();
      if (mounted) {
        showAppMessage(context, 'Password changed. Sign in again.');
        context.go('/sign-in');
      }
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Change password')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Form(key: _formKey, child: Column(children: [
          TextFormField(controller: _current, obscureText: true, decoration: const InputDecoration(labelText: 'Current password'), validator: (value) => value == null || value.isEmpty ? 'Enter your current password.' : null),
          const SizedBox(height: 12),
          TextFormField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'New password'), validator: _passwordError),
          const SizedBox(height: 12),
          TextFormField(controller: _confirm, obscureText: true, decoration: const InputDecoration(labelText: 'Confirm new password'), validator: (value) => value != _password.text ? 'Passwords do not match.' : null),
        ])),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 13), child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))),
        const SizedBox(height: 18),
        ElevatedButton(onPressed: _busy ? null : _save, child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('UPDATE PASSWORD')),
      ]),
    );
  }

  String? _passwordError(String? value) {
    if (value == null || value.length < 8) return 'Use at least 8 characters.';
    if (!RegExp(r'[a-zA-Z]').hasMatch(value) || !RegExp(r'\d').hasMatch(value)) return 'Include a letter and a number.';
    return null;
  }
}
