import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_widgets.dart';

class TournamentListScreen extends ConsumerStatefulWidget {
  const TournamentListScreen({super.key});

  @override
  ConsumerState<TournamentListScreen> createState() => _TournamentListScreenState();
}

class _TournamentListScreenState extends ConsumerState<TournamentListScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  String _searchText = '';
  String? _type;

  static const _filters = <(String, String?)>[
    ('All events', null),
    ('Solo', 'SOLO'),
    ('Duo', 'DUO'),
    ('Squad', 'SQUAD'),
    ('Clash Squad', 'CLASH_SQUAD'),
    ('Lone Wolf', 'LONE_WOLF'),
  ];

  TournamentQuery get _query => TournamentQuery(search: _searchText, type: _type);

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final events = ref.watch(tournamentListProvider(_query));
    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Find your next drop.', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 5),
                Text('Pick a mode. Lock in. Play for the prize.', style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 17),
                TextField(
                  controller: _search,
                  onChanged: (value) {
                    _debounce?.cancel();
                    _debounce = Timer(const Duration(milliseconds: 320), () {
                      if (mounted) setState(() => _searchText = value.trim());
                    });
                  },
                  decoration: InputDecoration(
                    hintText: 'Search tournaments',
                    prefixIcon: const Icon(Icons.search_rounded),
                    suffixIcon: _search.text.isEmpty
                        ? null
                        : IconButton(
                            onPressed: () {
                              _search.clear();
                              setState(() => _searchText = '');
                            },
                            icon: const Icon(Icons.close_rounded),
                          ),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(
            height: 42,
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              scrollDirection: Axis.horizontal,
              itemCount: _filters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final (label, type) = _filters[index];
                final selected = type == _type;
                return ChoiceChip(
                  label: Text(label),
                  selected: selected,
                  onSelected: (_) => setState(() => _type = type),
                  showCheckmark: false,
                  selectedColor: AppColors.accent.withValues(alpha: 0.22),
                  backgroundColor: AppColors.surface,
                  side: BorderSide(color: selected ? AppColors.accent.withValues(alpha: 0.5) : AppColors.line),
                  labelStyle: TextStyle(color: selected ? AppColors.accentSoft : AppColors.secondary, fontSize: 12, fontWeight: FontWeight.w700),
                );
              },
            ),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: RefreshIndicator(
              color: AppColors.accentSoft,
              onRefresh: () => ref.refresh(tournamentListProvider(_query).future),
              child: events.when(
                loading: () => const LoadingPanel(label: 'Loading tournaments…'),
                error: (error, stack) => ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(20),
                  children: [ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(tournamentListProvider(_query)))],
                ),
                data: (items) => items.isEmpty
                    ? ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(20),
                        children: const [EmptyPanel(title: 'No events found', message: 'Try another game mode or search term.', icon: Icons.search_off_rounded)],
                      )
                    : ListView.separated(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
                        itemCount: items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 14),
                        itemBuilder: (context, index) => TournamentCard(tournament: items[index]),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class TournamentDetailScreen extends ConsumerWidget {
  const TournamentDetailScreen({required this.slug, super.key});

  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(tournamentDetailProvider(slug));
    return Scaffold(
      appBar: AppBar(title: const Text('Event details')),
      body: detail.when(
        loading: () => const LoadingPanel(label: 'Loading event details…'),
        error: (error, stack) => Padding(
          padding: const EdgeInsets.all(20),
          child: ErrorPanel(message: errorMessage(error), onRetry: () => ref.invalidate(tournamentDetailProvider(slug))),
        ),
        data: (data) => _TournamentDetailBody(
          tournament: Tournament.fromJson(data),
          onRefresh: () async { await ref.refresh(tournamentDetailProvider(slug).future); },
        ),
      ),
      bottomNavigationBar: detail.whenOrNull(
        data: (data) => _JoinBar(tournament: Tournament.fromJson(data)),
      ),
    );
  }
}

class _TournamentDetailBody extends StatelessWidget {
  const _TournamentDetailBody({required this.tournament, required this.onRefresh});

  final Tournament tournament;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final percent = tournament.maxSlots <= 0 ? 0.0 : (tournament.registeredSlots / tournament.maxSlots).clamp(0.0, 1.0).toDouble();
    final raw = tournament.raw;
    final room = asJson(raw['room']);

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
            sliver: SliverToBoxAdapter(child: _DetailArtwork(tournament: tournament)),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
            sliver: SliverList.list(children: [
              Row(
                children: [
                  StatusPill(statusLabel(tournament.status)),
                  const SizedBox(width: 8),
                  Text(typeLabel(tournament.type), style: Theme.of(context).textTheme.bodySmall),
                  const Spacer(),
                  if (raw['isVerified'] == true) const Icon(Icons.verified_rounded, color: AppColors.accentSoft, size: 19),
                ],
              ),
              const SizedBox(height: 12),
              Text(tournament.title, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.schedule_rounded, color: AppColors.accentSoft, size: 17),
                  const SizedBox(width: 7),
                  Expanded(child: Text(dateLabel(raw['startTime']), style: Theme.of(context).textTheme.bodyMedium)),
                ],
              ),
              const SizedBox(height: 20),
              AppPanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: _DetailMetric(label: 'PRIZE POOL', value: money(tournament.prizePool), color: AppColors.reward)),
                        Expanded(child: _DetailMetric(label: 'ENTRY / PLAYER', value: tournament.entryFee == 0 ? 'Free' : money(tournament.entryFee))),
                      ],
                    ),
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        Expanded(child: _DetailMetric(label: 'MODE', value: typeLabel(tournament.type))),
                        Expanded(child: _DetailMetric(label: 'MAP', value: tournament.map)),
                      ],
                    ),
                    const SizedBox(height: 19),
                    Row(
                      children: [
                        Expanded(child: Text('CAPACITY', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.muted))),
                        Text('${tournament.registeredSlots}/${tournament.maxSlots} ${tournament.capacityUnit}', style: const TextStyle(color: AppColors.foreground, fontSize: 12, fontWeight: FontWeight.w800)),
                      ],
                    ),
                    const SizedBox(height: 9),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: LinearProgressIndicator(value: percent, minHeight: 7, backgroundColor: Colors.white.withValues(alpha: 0.08)),
                    ),
                    const SizedBox(height: 6),
                    Text('${tournament.slotsLeft} ${tournament.capacityUnit} remaining', style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              if (room.isNotEmpty) ...[
                const SizedBox(height: 14),
                AppPanel(
                  padding: const EdgeInsets.all(15),
                  child: Row(
                    children: [
                      const Icon(Icons.lock_clock_rounded, color: AppColors.accentSoft),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Private room access', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.foreground)),
                            const SizedBox(height: 4),
                            Text('Room credentials are shared with confirmed players when the event window opens.', style: Theme.of(context).textTheme.bodySmall),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              if (tournament.prizes.isNotEmpty) ...[
                const SizedBox(height: 26),
                const SectionHeading('Prize breakdown'),
                const SizedBox(height: 10),
                ...tournament.prizes.map((prize) => _PrizeRow(prize: prize)),
              ],
              const SizedBox(height: 26),
              SectionHeading('Registered players · ${tournament.registeredPlayers}', action: tournament.participants.isEmpty ? null : '${tournament.participants.length} shown'),
              const SizedBox(height: 10),
              if (tournament.participants.isEmpty)
                const EmptyPanel(title: 'Be the first to join', message: 'The player list appears when seats are confirmed.', icon: Icons.groups_outlined)
              else
                ...tournament.participants.take(24).map((participant) => _ParticipantRow(participant: participant)),
              if (tournament.matches.isNotEmpty) ...[
                const SizedBox(height: 26),
                const SectionHeading('Match schedule'),
                const SizedBox(height: 10),
                ...tournament.matches.map((match) => _PublicMatchRow(match: match)),
              ],
              const SizedBox(height: 18),
              Text(
                'Entry fees and eligibility are validated by CLUTCHNEX when you join. Room IDs and passwords are never displayed on this public event page.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ]),
          ),
        ],
      ),
    );
  }
}

class _DetailArtwork extends StatelessWidget {
  const _DetailArtwork({required this.tournament});

  final Tournament tournament;

  @override
  Widget build(BuildContext context) {
    final url = AppConfig.mediaUrl(tournament.banner);
    return ClipRRect(
      borderRadius: BorderRadius.circular(21),
      child: SizedBox(
        height: 200,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Container(
              decoration: const BoxDecoration(gradient: LinearGradient(colors: [Color(0xFF302352), Color(0xFF101626)], begin: Alignment.topLeft, end: Alignment.bottomRight)),
              child: const Align(alignment: Alignment.centerRight, child: Icon(Icons.bolt_rounded, size: 145, color: Color(0x268B5CF6))),
            ),
            if (url != null) CachedNetworkImage(imageUrl: url, fit: BoxFit.cover, errorWidget: (_, __, ___) => const SizedBox.shrink()),
            const DecoratedBox(
              decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Color(0xCC070A14)])),
            ),
            Positioned(
              left: 18,
              right: 18,
              bottom: 17,
              child: Row(
                children: [
                  const Icon(Icons.map_outlined, color: Colors.white70, size: 16),
                  const SizedBox(width: 5),
                  Text(tournament.map, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                  const Spacer(),
                  const Icon(Icons.sports_esports_rounded, color: AppColors.accentSoft, size: 17),
                  const SizedBox(width: 5),
                  Text(typeLabel(tournament.type), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailMetric extends StatelessWidget {
  const _DetailMetric({required this.label, required this.value, this.color = AppColors.foreground});

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.muted, fontSize: 9)),
      const SizedBox(height: 5),
      Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.w900)),
    ]);
  }
}

class _PrizeRow extends StatelessWidget {
  const _PrizeRow({required this.prize});
  final JsonMap prize;

  @override
  Widget build(BuildContext context) {
    final place = intValue(prize['position']);
    final title = stringValue(prize['label'], fallback: place == 1 ? 'Champion' : 'Place $place');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppPanel(
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
        borderRadius: 14,
        child: Row(
          children: [
            CircleAvatar(radius: 16, backgroundColor: AppColors.reward.withValues(alpha: 0.14), child: Text('$place', style: const TextStyle(color: AppColors.reward, fontWeight: FontWeight.w900))),
            const SizedBox(width: 11),
            Expanded(child: Text(title, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700))),
            Text(money(prize['amount']), style: const TextStyle(color: AppColors.reward, fontWeight: FontWeight.w900)),
          ],
        ),
      ),
    );
  }
}

class _ParticipantRow extends StatelessWidget {
  const _ParticipantRow({required this.participant});
  final JsonMap participant;

  @override
  Widget build(BuildContext context) {
    final user = asJson(participant['user']);
    final team = asJson(participant['team']);
    final title = team.isNotEmpty
        ? '${stringValue(team['name'])} [${stringValue(team['tag'])}]'
        : stringValue(user['ign'], fallback: stringValue(user['username'], fallback: 'Player'));
    final seat = intValue(participant['seatNumber']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: AppPanel(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
        borderRadius: 14,
        child: Row(
          children: [
            Container(width: 31, height: 31, alignment: Alignment.center, decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(9)), child: Text(seat > 0 ? '$seat' : '—', style: const TextStyle(color: AppColors.accentSoft, fontSize: 11, fontWeight: FontWeight.w900))),
            const SizedBox(width: 11),
            Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700))),
            if (team.isNotEmpty) const Icon(Icons.groups_rounded, color: AppColors.muted, size: 17),
          ],
        ),
      ),
    );
  }
}

class _PublicMatchRow extends StatelessWidget {
  const _PublicMatchRow({required this.match});
  final JsonMap match;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppPanel(
        padding: const EdgeInsets.all(14),
        borderRadius: 14,
        child: Row(
          children: [
            Container(width: 42, height: 42, decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)), child: const Icon(Icons.sports_mma_rounded, color: AppColors.accentSoft)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Match ${intValue(match['matchNumber'], fallback: 1)} · ${stringValue(match['map'], fallback: 'Map TBA')}', style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(dateLabel(match['scheduledAt']), style: Theme.of(context).textTheme.bodySmall),
            ])),
            StatusPill(statusLabel(stringValue(match['status'], fallback: 'scheduled'))),
          ],
        ),
      ),
    );
  }
}

class _JoinBar extends ConsumerWidget {
  const _JoinBar({required this.tournament});
  final Tournament tournament;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final open = tournament.registrationOpen && tournament.slotsLeft > 0;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
        decoration: const BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.line))),
        child: Row(
          children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(tournament.entryFee == 0 ? 'FREE ENTRY' : 'ENTRY FEE', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.muted, fontSize: 8)),
                const SizedBox(height: 4),
                Text(tournament.entryFee == 0 ? 'Free' : '${money(tournament.entryFee)} / player', style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w900, fontSize: 15)),
              ]),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 154,
              child: ElevatedButton(
                onPressed: open ? () => _startJoin(context, ref) : null,
                child: Text(open ? 'JOIN EVENT' : tournament.slotsLeft <= 0 ? 'FULL' : 'CLOSED'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _startJoin(BuildContext context, WidgetRef ref) async {
    final player = ref.read(authControllerProvider).valueOrNull;
    if (player == null) {
      context.push('/sign-in?from=${Uri.encodeComponent('/tournament/${tournament.slug}')}');
      return;
    }
    final joined = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.surface,
      builder: (_) => _JoinTournamentSheet(tournament: tournament),
    );
    if (joined == true && context.mounted) {
      ref.invalidate(tournamentDetailProvider(tournament.slug));
      ref.invalidate(tournamentListProvider);
      ref.invalidate(featuredTournamentsProvider);
      ref.invalidate(matchesProvider);
      ref.invalidate(walletProvider);
      showAppMessage(context, 'Seat request confirmed. See you in the lobby!');
    }
  }
}

class _JoinTournamentSheet extends ConsumerStatefulWidget {
  const _JoinTournamentSheet({required this.tournament});
  final Tournament tournament;

  @override
  ConsumerState<_JoinTournamentSheet> createState() => _JoinTournamentSheetState();
}

class _JoinTournamentSheetState extends ConsumerState<_JoinTournamentSheet> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _uid;
  late final TextEditingController _ign;
  late final TextEditingController _phone;
  late Future<List<JsonMap>> _teams;
  String? _selectedTeamId;
  bool _useFreeAgent = true;
  bool _busy = false;
  String? _error;

  bool get _teamMode => widget.tournament.teamSize > 1;
  bool get _independentAllowed => widget.tournament.teamSize == 2
      ? widget.tournament.allowIndependentDuo
      : widget.tournament.allowIndependentSquad;
  String get _requiredTeamType => widget.tournament.teamSize == 2 ? 'DUO' : 'SQUAD';

  @override
  void initState() {
    super.initState();
    final player = ref.read(authControllerProvider).valueOrNull!;
    _uid = TextEditingController(text: player.freeFireUid);
    _ign = TextEditingController(text: player.freeFireIgn);
    _phone = TextEditingController(text: player.phone);
    _teams = ref.read(apiClientProvider).myTeams();
    _useFreeAgent = _independentAllowed;
  }

  @override
  void dispose() {
    _uid.dispose();
    _ign.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_teamMode && _selectedTeamId == null && (!_independentAllowed || !_useFreeAgent)) {
      setState(() => _error = 'Choose your ${_requiredTeamType.toLowerCase()} team or select free-agent entry.');
      return;
    }
    final uid = _uid.text.trim();
    final ign = _ign.text.trim();
    final phone = _phone.text.trim();
    final teamId = _selectedTeamId;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = ref.read(authControllerProvider.notifier);
      await auth.updateProfile({
        'freeFireUID': uid,
        'freeFireIGN': ign,
        'phone': phone,
      });
      await ref.read(apiClientProvider).joinTournament(
            slug: widget.tournament.slug,
            teamId: teamId,
            freeFireUid: teamId == null ? uid : null,
            freeFireIgn: teamId == null ? ign : null,
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 14, 20, 20 + keyboard),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Center(child: Container(width: 42, height: 4, decoration: BoxDecoration(color: AppColors.muted, borderRadius: BorderRadius.circular(5)))),
            const SizedBox(height: 20),
            Text('Lock in your seat', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 5),
            Text('${widget.tournament.title} · ${widget.tournament.entryFee == 0 ? 'Free entry' : '${money(widget.tournament.entryFee)} per player'}', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 18),
            Form(
              key: _formKey,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (_teamMode) ...[
                  Text('TEAM ENTRY', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.muted)),
                  const SizedBox(height: 9),
                  FutureBuilder<List<JsonMap>>(
                    future: _teams,
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) return const LinearProgressIndicator(minHeight: 2);
                      if (snapshot.hasError) {
                        return TextButton.icon(
                          onPressed: () => setState(() => _teams = ref.read(apiClientProvider).myTeams()),
                          icon: const Icon(Icons.refresh_rounded),
                          label: const Text('Could not load teams — retry'),
                        );
                      }
                      final filtered = (snapshot.data ?? []).map((row) => asJson(row['team'])).where((team) => team['type'] == _requiredTeamType).toList();
                      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        if (_independentAllowed)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: ChoiceChip(
                              label: const Text('Join as a free agent'),
                              selected: _useFreeAgent,
                              onSelected: _busy ? null : (selected) {
                                if (!selected) return;
                                setState(() {
                                  _useFreeAgent = true;
                                  _selectedTeamId = null;
                                });
                              },
                              showCheckmark: false,
                              selectedColor: AppColors.accent.withValues(alpha: 0.2),
                            ),
                          ),
                        if (filtered.isEmpty)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Text(
                              _independentAllowed ? 'No matching team? Join as a free agent and the organizer can pair you.' : 'Create or join a ${_requiredTeamType.toLowerCase()} team before entering.',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                        ...filtered.map((team) {
                          final id = stringValue(team['id']);
                          final selected = _selectedTeamId == id;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: InkWell(
                              onTap: _busy ? null : () => setState(() {
                                _selectedTeamId = id;
                                _useFreeAgent = false;
                              }),
                              borderRadius: BorderRadius.circular(13),
                              child: Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(color: selected ? AppColors.accent.withValues(alpha: 0.12) : AppColors.elevated, borderRadius: BorderRadius.circular(13), border: Border.all(color: selected ? AppColors.accent : AppColors.line)),
                                child: Row(children: [
                                  const Icon(Icons.groups_rounded, color: AppColors.accentSoft),
                                  const SizedBox(width: 10),
                                  Expanded(child: Text('${stringValue(team['name'])} [${stringValue(team['tag'])}]', style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700))),
                                  if (selected) const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 18),
                                ]),
                              ),
                            ),
                          );
                        }),
                        if (!_independentAllowed)
                          Align(alignment: Alignment.centerLeft, child: TextButton.icon(onPressed: _busy ? null : () { Navigator.pop(context); context.push('/teams'); }, icon: const Icon(Icons.add_rounded), label: const Text('Manage teams'))),
                      ]);
                    },
                  ),
                  const SizedBox(height: 9),
                ],
                TextFormField(
                  controller: _uid,
                  enabled: !_busy,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Free Fire UID', prefixIcon: Icon(Icons.numbers_rounded)),
                  validator: (value) => value == null || !RegExp(r'^\d{5,15}$').hasMatch(value.trim()) ? 'Enter a valid 5–15 digit UID.' : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _ign,
                  enabled: !_busy,
                  decoration: const InputDecoration(labelText: 'In-game name', prefixIcon: Icon(Icons.sports_esports_outlined)),
                  validator: (value) => value == null || value.trim().length < 2 || value.trim().length > 24 ? 'Name must be 2–24 characters.' : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _phone,
                  enabled: !_busy,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Phone number', prefixIcon: Icon(Icons.phone_outlined)),
                  validator: (value) => value == null || !isValidPlayerPhone(value) ? 'Enter 7–15 digits, optionally starting with +.' : null,
                ),
              ]),
            ),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))),
            const SizedBox(height: 16),
            SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy ? null : _submit, child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('CONFIRM ENTRY'))),
            const SizedBox(height: 8),
            Text('The API checks eligibility, team membership, seat capacity and balance before confirming your entry.', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}
