import 'package:flutter_test/flutter_test.dart';
import 'package:clutchnex_flutter/core/models.dart';

void main() {
  group('Tournament model', () {
    test('reads the fields returned by the public API', () {
      final tournament = Tournament.fromJson({
        'id': 'event-1',
        'slug': 'solo-showdown',
        'title': 'Solo Showdown',
        'type': 'SOLO',
        'status': 'REGISTRATION_OPEN',
        'entryFeePerPlayer': '100.00',
        'prizePool': 5000,
        'registeredSlots': 17,
        'maxSlots': 48,
        'slotsLeft': 31,
        'registrationOpen': true,
      });

      expect(tournament.title, 'Solo Showdown');
      expect(tournament.entryFee, 100);
      expect(tournament.prizePool, 5000);
      expect(tournament.slotsLeft, 31);
      expect(tournament.registrationOpen, isTrue);
    });

    test('honors the API registration deadline flag over the status label', () {
      final tournament = Tournament.fromJson({
        'status': 'REGISTRATION_OPEN',
        'registrationOpen': false,
      });
      expect(tournament.registrationOpen, isFalse);
    });
  });

  test('humanizes event enums without changing their source value', () {
    expect(typeLabel('CLASH_SQUAD'), 'Clash Squad');
    expect(statusLabel('REGISTRATION_OPEN'), 'Registration Open');
  });

  test('matches the API player-phone requirement', () {
    expect(isValidPlayerPhone('+92 300-1234567'), isTrue);
    expect(isValidPlayerPhone('123456'), isFalse);
    expect(isValidPlayerPhone('abc1234567'), isFalse);
  });

  test('handles absent or malformed numeric fields safely', () {
    final tournament = Tournament.fromJson({'registeredSlots': '12', 'maxSlots': 8});
    expect(tournament.registeredSlots, 12);
    expect(tournament.slotsLeft, 0);
    expect(numberValue('not-a-number'), 0);
  });
}
