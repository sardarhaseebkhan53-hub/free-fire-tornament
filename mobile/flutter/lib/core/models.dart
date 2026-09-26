import 'package:intl/intl.dart';

typedef JsonMap = Map<String, dynamic>;

JsonMap asJson(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, value) => MapEntry('$key', value));
  return <String, dynamic>{};
}

List<JsonMap> jsonList(Object? value) {
  if (value is! List) return const [];
  return value.map(asJson).toList(growable: false);
}

String stringValue(Object? value, {String fallback = ''}) =>
    value == null ? fallback : value.toString();

bool isValidPlayerPhone(String? value) {
  if (value == null) return false;
  final digits = value.replaceAll(RegExp(r'[\s-]'), '').replaceFirst(RegExp(r'^\+'), '');
  return RegExp(r'^\d{7,15}$').hasMatch(digits);
}

int intValue(Object? value, {int fallback = 0}) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse('$value') ?? fallback;
}

double numberValue(Object? value, {double fallback = 0}) {
  if (value is num) return value.toDouble();
  return double.tryParse('$value') ?? fallback;
}

DateTime? dateValue(Object? value) {
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value)?.toLocal();
  return null;
}

String money(Object? value, {String currency = 'PKR'}) {
  final formatted = NumberFormat('#,##0.##').format(numberValue(value));
  return currency == 'PKR' ? 'Rs $formatted' : '$currency $formatted';
}

String dateLabel(Object? value, {String pattern = 'EEE, d MMM · h:mm a'}) {
  final date = dateValue(value);
  if (date == null) return 'Schedule to be announced';
  return DateFormat(pattern).format(date);
}

String typeLabel(String type) => switch (type.toUpperCase()) {
      'SOLO' => 'Solo',
      'DUO' => 'Duo',
      'SQUAD' => 'Squad',
      'CLASH_SQUAD' => 'Clash Squad',
      'CLASH_SQUAD_1V1' => 'Clash Squad 1v1',
      'LONE_WOLF' => 'Lone Wolf',
      'CUSTOM' => 'Custom',
      _ => type.replaceAll('_', ' ').toLowerCase(),
    };

String statusLabel(String status) => status
    .replaceAll('_', ' ')
    .toLowerCase()
    .split(' ')
    .where((word) => word.isNotEmpty)
    .map((word) => '${word[0].toUpperCase()}${word.substring(1)}')
    .join(' ');

class Player {
  const Player({required this.raw});

  final JsonMap raw;

  factory Player.fromJson(Object? json) => Player(raw: asJson(json));

  String get id => stringValue(raw['id']);
  String get username => stringValue(raw['username'], fallback: 'Player');
  String get email => stringValue(raw['email']);
  String get phone => stringValue(raw['phone']);
  String get role => stringValue(raw['role'], fallback: 'USER');
  String get avatar => stringValue(raw['avatar']);
  JsonMap get profile => asJson(raw['profile']);
  String get fullName => stringValue(profile['fullName'], fallback: username);
  String get freeFireUid => stringValue(profile['freeFireUID']);
  String get freeFireIgn => stringValue(profile['freeFireIGN']);
  JsonMap get wallet => asJson(raw['wallet']);
  JsonMap get stats => asJson(raw['stats']);
  JsonMap get rankInfo => asJson(raw['rankInfo']);
  bool get profileComplete => raw['profileComplete'] == true;
  bool get showPublicProfile => profile['showPublicProfile'] != false;

  JsonMap toJson() => raw;
}

class Tournament {
  const Tournament({required this.raw});

  final JsonMap raw;

  factory Tournament.fromJson(Object? json) => Tournament(raw: asJson(json));

  String get id => stringValue(raw['id']);
  String get slug => stringValue(raw['slug']);
  String get title => stringValue(raw['title'], fallback: 'Tournament');
  String get type => stringValue(raw['type'], fallback: 'SOLO');
  String get status => stringValue(raw['status'], fallback: 'UPCOMING');
  String get map => stringValue(raw['map'], fallback: 'Map TBA');
  String get banner => stringValue(raw['banner']);
  int get maxSlots => intValue(raw['maxSlots']);
  int get registeredSlots => intValue(raw['registeredSlots']);
  int get slotsLeft => intValue(raw['slotsLeft'], fallback: (maxSlots - registeredSlots).clamp(0, 100000).toInt());
  int get registeredPlayers => intValue(raw['registeredPlayers']);
  int get teamSize => intValue(raw['teamSize'], fallback: 1);
  String get capacityUnit => stringValue(raw['capacityUnit'], fallback: 'players');
  double get entryFee => numberValue(raw['entryFeePerPlayer']);
  double get prizePool => numberValue(raw['prizePool']);
  bool get registrationOpen => raw.containsKey('registrationOpen') ? raw['registrationOpen'] == true : status == 'REGISTRATION_OPEN';
  bool get allowIndependentDuo => raw['allowIndependentDuo'] == true;
  bool get allowIndependentSquad => raw['allowIndependentSquad'] == true;
  DateTime? get startsAt => dateValue(raw['startTime']);
  List<JsonMap> get participants => jsonList(raw['participants']);
  List<JsonMap> get prizes => jsonList(raw['prizes']);
  List<JsonMap> get matches => jsonList(raw['matches']);
}

class WalletSummary {
  const WalletSummary({required this.raw});

  final JsonMap raw;

  factory WalletSummary.fromJson(Object? json) => WalletSummary(raw: asJson(json));

  JsonMap get wallet => asJson(raw['wallet']);
  JsonMap get settings => asJson(raw['settings']);
  JsonMap get pending => asJson(raw['pending']);
  List<JsonMap> get transactions => jsonList(raw['recentTransactions']);
  double get balance => numberValue(wallet['balance']);
  double get withdrawable => numberValue(wallet['withdrawable']);
}

class TournamentQuery {
  const TournamentQuery({this.search = '', this.type});

  final String search;
  final String? type;

  @override
  bool operator ==(Object other) =>
      other is TournamentQuery && other.search == search && other.type == type;

  @override
  int get hashCode => Object.hash(search, type);
}
