// =============================================================================
// Unit — dynamic tournament capacity (lib/capacity).
// The platform must never treat any number as a universal slot configuration:
// capacity is always seats × playersPerTeam, and the unit (players vs teams)
// depends on the format.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { capacityOf, isTeamMode, playersPerTeamFor, playersPerTeamOf } from '../../src/lib/capacity';

describe('dynamic capacity', () => {
  it('solo-style modes count individual players: 1 registration = 1 slot', () => {
    for (const type of ['SOLO', 'LONE_WOLF', 'CLASH_SQUAD_1V1'] as const) {
      const cap = capacityOf({ type, maxSlots: 48 });
      expect(cap.playersPerTeam).toBe(1);
      expect(cap.totalPlayers).toBe(48);
      expect(cap.teamMode).toBe(false);
      expect(cap.slotUnit).toBe('players');
    }
  });

  it('duo is 2 players per seat: 24 teams = 48 players', () => {
    const cap = capacityOf({ type: 'DUO', maxSlots: 24 });
    expect(cap.playersPerTeam).toBe(2);
    expect(cap.totalPlayers).toBe(48);
    expect(cap.slotUnit).toBe('teams');
  });

  it('squad / clash squad are 4 players per seat: 12 teams = 48 players', () => {
    for (const type of ['SQUAD', 'CLASH_SQUAD'] as const) {
      const cap = capacityOf({ type, maxSlots: 12 });
      expect(cap.playersPerTeam).toBe(4);
      expect(cap.totalPlayers).toBe(48);
      expect(cap.slotUnit).toBe('teams');
    }
  });

  it('CUSTOM capacity = players per team × teams (4×12 → 48, 2×10 → 20)', () => {
    const a = capacityOf({ type: 'CUSTOM', maxSlots: 12, playersPerTeam: 4 });
    expect(a.totalPlayers).toBe(48);
    expect(a.slotUnit).toBe('teams');

    const b = capacityOf({ type: 'CUSTOM', maxSlots: 10, playersPerTeam: 2 });
    expect(b.totalPlayers).toBe(20);

    // 1v1 custom formats stay individual slots.
    const c = capacityOf({ type: 'CUSTOM', maxSlots: 16, playersPerTeam: 1 });
    expect(c.totalPlayers).toBe(16);
    expect(c.teamMode).toBe(false);
    expect(c.slotUnit).toBe('players');
  });

  it('built-in modes are pinned to their real team size even if the column drifts', () => {
    expect(playersPerTeamOf({ type: 'SQUAD', maxSlots: 12, playersPerTeam: 1 })).toBe(4);
    expect(playersPerTeamOf({ type: 'SOLO', maxSlots: 48, playersPerTeam: 4 })).toBe(1);
    // CUSTOM reads the configured column.
    expect(playersPerTeamOf({ type: 'CUSTOM', maxSlots: 10, playersPerTeam: 3 })).toBe(3);
    expect(playersPerTeamOf({ type: 'CUSTOM', maxSlots: 10, playersPerTeam: null })).toBe(1);
  });

  it('persists the admin size for CUSTOM and pins built-ins', () => {
    expect(playersPerTeamFor('CUSTOM', 3)).toBe(3);
    expect(playersPerTeamFor('CUSTOM', 25)).toBe(8); // bounded 1..8
    expect(playersPerTeamFor('CUSTOM', 0)).toBe(1);
    expect(playersPerTeamFor('SQUAD', 3)).toBe(4); // built-ins ignore overrides
    expect(playersPerTeamFor('SOLO')).toBe(1);
  });

  it('team mode detection follows players-per-team for CUSTOM', () => {
    expect(isTeamMode('CUSTOM', 4)).toBe(true);
    expect(isTeamMode('CUSTOM', 1)).toBe(false);
    expect(isTeamMode('SOLO', 1)).toBe(false);
    expect(isTeamMode('SQUAD', 4)).toBe(true);
  });
});
