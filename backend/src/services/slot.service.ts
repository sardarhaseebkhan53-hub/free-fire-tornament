// =============================================================================
// Admin slot control (spec §12, §37) — visual slot board + full control.
//
//   Slot board    → GET /admin/tournaments/:id/slots   (all 1..maxSlots)
//   Assign        → POST /admin/slots/:regId/assign    { slot, reason? }
//   Lock/Note     → POST /admin/slots/:regId/lock      { locked, note? }
//   Mark absent   → POST /admin/slots/:regId/status    { absent: true, note? }
//   Replace       → same as assign (admin moves another registration into the
//                    slot; the vacated registration gets seatNumber = null)
//
// Slots are assigned with the same race-safe conditional-UPDATE the join
// engine uses; duplicate assignments are impossible. Every mutation writes an
// AuditLog row (old value → new value). Locked slots refuse auto-assignment
// and admin moves until explicitly unlocked.
// =============================================================================
import crypto from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { TX_OPTS } from './wallet.service';

interface Ctx { ip?: string; userAgent?: string }

const num = (d: unknown) => Math.round(Number(d ?? 0) * 100) / 100;

export interface SlotBoardEntry {
  slot: number;
  registrationId: string | null;
  player: string | null;
  ign: string | null;
  uid: string | null; // admin-only view
  username: string | null;
  team: string | null;
  status: string | null;
  payment: string | null;
  entryAmount: number | null;
  locked: boolean;
  note: string | null;
  matchCount: number;
  matches: Array<{
    participantId: string; id: string; matchNumber: number; status: string;
    placement: number | null; kills: number | null; finalScore: number | null;
    ready: boolean; absent: boolean; participantStatus: string; notes: string | null;
  }>;
}

/** Full slot board for a tournament (all seats; admin view with UID). */
export async function slotBoard(tournamentId: string) {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, title: true, type: true, maxSlots: true, registeredSlots: true, status: true },
  });
  if (!t) throw notFound('Tournament not found');

  const regs = await prisma.tournamentRegistration.findMany({
    where: { tournamentId, status: { in: ['CONFIRMED', 'DISQUALIFIED'] } },
    orderBy: [{ seatNumber: 'asc' }, { registeredAt: 'asc' }],
    select: {
      id: true, userId: true, teamId: true, seatNumber: true, status: true,
      entryAmount: true, slotLocked: true, slotNote: true, registeredAt: true,
      user: { select: { username: true, profile: { select: { freeFireUID: true, freeFireIGN: true } } } },
      team: { select: { name: true, tag: true } },
    },
  });

  // Match history per registration/user/team (for the slot drawer).
  const userIds = [...new Set(regs.map((r) => r.userId))];
  const teamIds = [...new Set(regs.map((r) => r.teamId).filter((x): x is string => x !== null))];
  const participants = await prisma.matchParticipant.findMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { teamId: { in: teamIds } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, matchId: true, userId: true, teamId: true, placement: true, kills: true,
      finalScore: true, status: true, readyAt: true, absent: true, notes: true,
      match: { select: { id: true, matchNumber: true, status: true } },
    },
  });

  const board = new Map<number, SlotBoardEntry>();
  for (let slot = 1; slot <= t.maxSlots; slot++) {
    board.set(slot, {
      slot,
      registrationId: null, player: null, ign: null, uid: null, username: null,
      team: null, status: null, payment: null, entryAmount: null,
      locked: false, note: null, matchCount: 0, matches: [],
    });
  }

  for (const r of regs) {
    if (r.seatNumber === null || r.seatNumber < 1 || r.seatNumber > t.maxSlots) continue;
    const entry = board.get(r.seatNumber)!;
    entry.registrationId = r.id;
    entry.player = r.team ? `${r.team.name} [${r.team.tag}]` : (r.user.profile?.freeFireIGN ?? r.user.username);
    entry.ign = r.user.profile?.freeFireIGN ?? null;
    entry.uid = r.user.profile?.freeFireUID ?? null;
    entry.username = r.user.username;
    entry.team = r.team ? r.team.tag : null;
    entry.status = r.status;
    entry.payment = r.status === 'CONFIRMED' ? 'PAID' : r.status;
    entry.entryAmount = num(r.entryAmount);
    entry.locked = r.slotLocked;
    entry.note = r.slotNote;
    const history = participants.filter((p) => (r.teamId ? p.teamId === r.teamId : p.userId === r.userId));
    entry.matchCount = history.length;
    entry.matches = history.map((p) => ({
      participantId: p.id,
      id: p.match.id, matchNumber: p.match.matchNumber, status: p.match.status,
      placement: p.placement, kills: p.kills, finalScore: p.finalScore,
      ready: p.readyAt !== null, absent: p.absent, participantStatus: p.status, notes: p.notes,
    }));
  }

  return {
    tournament: { id: t.id, title: t.title, type: t.type, maxSlots: t.maxSlots, registeredSlots: t.registeredSlots, status: t.status },
    slots: [...board.values()],
    occupied: regs.filter((r) => r.seatNumber !== null).length,
  };
}

/** Assign (or move) a registration to a specific slot. */
export async function assignSlot(
  adminId: string,
  registrationId: string,
  slot: number,
  reason: string,
  ctx: Ctx = {},
) {
  const reg = await prisma.tournamentRegistration.findUnique({
    where: { id: registrationId },
    include: { tournament: { select: { id: true, title: true, maxSlots: true } }, user: { select: { username: true } }, team: { select: { name: true } } },
  });
  if (!reg) throw notFound('Registration not found');
  if (reg.status !== 'CONFIRMED') throw badRequest('VALIDATION_ERROR', 'Only confirmed registrations can hold a slot.');
  if (!Number.isInteger(slot) || slot < 1 || slot > reg.tournament.maxSlots) {
    throw badRequest('VALIDATION_ERROR', `Slot must be between 1 and ${reg.tournament.maxSlots}.`);
  }
  if (reg.slotLocked) throw conflict('CONFLICT', 'This registration slot is locked by an admin — unlock it first.');

  return prisma.$transaction(async (tx) => {
    // Lock the tournament row so joins and every admin slot operation share one
    // serialization point. Team registrations are moved as a group — splitting
    // one member away from the team's seat would corrupt match assignment.
    await tx.$queryRaw`SELECT "id" FROM "tournaments" WHERE "id" = ${reg.tournamentId} FOR UPDATE`;
    const current = await tx.tournamentRegistration.findUnique({ where: { id: registrationId } });
    if (!current || current.status !== 'CONFIRMED') throw badRequest('VALIDATION_ERROR', 'Only confirmed registrations can hold a slot.');
    const targetWhere = current.teamId
      ? { tournamentId: reg.tournamentId, teamId: current.teamId, status: 'CONFIRMED' as const }
      : { id: registrationId };
    const targets = await tx.tournamentRegistration.findMany({ where: targetWhere });
    if (!targets.length) throw notFound('Registration not found');
    if (targets.some((target) => target.slotLocked)) throw conflict('CONFLICT', 'This registration slot is locked by an admin — unlock it first.');
    const targetIds = targets.map((target) => target.id);

    const occupied = await tx.tournamentRegistration.findFirst({
      where: {
        tournamentId: reg.tournamentId,
        seatNumber: slot,
        status: 'CONFIRMED',
        id: { notIn: targetIds },
      },
    });
    if (occupied) {
      throw conflict('CONFLICT', `Slot ${String(slot).padStart(2, '0')} is already held by another player/team — move or remove them first.`);
    }
    const before = { seatNumber: current.seatNumber, locked: current.slotLocked, note: current.slotNote };
    await tx.tournamentRegistration.updateMany({ where: { id: { in: targetIds } }, data: { seatNumber: slot } });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'SLOT_ASSIGNED', entity: 'TournamentRegistration', entityId: registrationId,
        before, after: { seatNumber: slot, affectedRegistrations: targetIds.length, reason: reason || null }, ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return { id: registrationId, seatNumber: slot, freedSlot: current.seatNumber };
  }, TX_OPTS);
}

/** Remove a player/team from their slot (seat becomes available). */
export async function clearSlot(adminId: string, registrationId: string, reason: string, ctx: Ctx = {}) {
  const reg = await prisma.tournamentRegistration.findUnique({ where: { id: registrationId } });
  if (!reg) throw notFound('Registration not found');
  if (reg.seatNumber === null) throw badRequest('VALIDATION_ERROR', 'This registration has no assigned slot.');
  if (reg.slotLocked) throw conflict('CONFLICT', 'This slot is locked — unlock it before clearing.');

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "tournaments" WHERE "id" = ${reg.tournamentId} FOR UPDATE`;
    const current = await tx.tournamentRegistration.findUnique({ where: { id: registrationId } });
    if (!current || current.seatNumber === null) throw badRequest('VALIDATION_ERROR', 'This registration has no assigned slot.');
    const targetWhere = current.teamId
      ? { tournamentId: reg.tournamentId, teamId: current.teamId, status: 'CONFIRMED' as const }
      : { id: registrationId };
    const targets = await tx.tournamentRegistration.findMany({ where: targetWhere });
    if (targets.some((target) => target.slotLocked)) throw conflict('CONFLICT', 'This slot is locked — unlock it before clearing.');
    const targetIds = targets.map((target) => target.id);
    const before = { seatNumber: current.seatNumber, locked: current.slotLocked };
    await tx.tournamentRegistration.updateMany({ where: { id: { in: targetIds } }, data: { seatNumber: null } });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'SLOT_CLEARED', entity: 'TournamentRegistration', entityId: registrationId,
        before, after: { seatNumber: null, affectedRegistrations: targetIds.length, reason: reason || null }, ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return { id: registrationId, seatNumber: null };
  }, TX_OPTS);
}

/** Lock/unlock a slot (locked slots are never auto-assigned or moved). */
export async function setSlotLock(
  adminId: string,
  registrationId: string,
  locked: boolean,
  note: string | null,
  ctx: Ctx = {},
) {
  const reg = await prisma.tournamentRegistration.findUnique({ where: { id: registrationId } });
  if (!reg) throw notFound('Registration not found');

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "tournaments" WHERE "id" = ${reg.tournamentId} FOR UPDATE`;
    const current = await tx.tournamentRegistration.findUnique({ where: { id: registrationId } });
    if (!current) throw notFound('Registration not found');
    const targetWhere = current.teamId
      ? { tournamentId: reg.tournamentId, teamId: current.teamId, status: 'CONFIRMED' as const }
      : { id: registrationId };
    const targets = await tx.tournamentRegistration.findMany({ where: targetWhere });
    const targetIds = targets.map((target) => target.id);
    await tx.tournamentRegistration.updateMany({
      where: { id: { in: targetIds } },
      data: { slotLocked: locked, slotNote: note ?? (locked ? current.slotNote : null) },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: locked ? 'SLOT_LOCKED' : 'SLOT_UNLOCKED', entity: 'TournamentRegistration', entityId: registrationId,
        before: { locked: current.slotLocked, note: current.slotNote },
        after: { locked, affectedRegistrations: targetIds.length, note: note ?? null }, ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return { id: registrationId, slotLocked: locked, slotNote: note ?? (locked ? current.slotNote : null) };
  }, TX_OPTS);
  return updated;
}

/** Mark a participant ready / absent / disqualified from the slot board. */
export async function setParticipantState(
  adminId: string,
  participantId: string,
  input: { ready?: boolean; absent?: boolean; status?: 'REGISTERED' | 'PLAYED' | 'DISQUALIFIED'; note?: string },
  ctx: Ctx = {},
) {
  const p = await prisma.matchParticipant.findUnique({ where: { id: participantId } });
  if (!p) throw notFound('Participant not found');

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "matches" WHERE "id" = ${p.matchId} FOR UPDATE`;
    const match = await tx.match.findUnique({ where: { id: p.matchId }, select: { resultsStatus: true } });
    if (!match) throw notFound('Match not found');
    if (match.resultsStatus === 'PUBLISHED') throw conflict('CONFLICT', 'Published match results are locked.');
    const row = await tx.matchParticipant.update({
      where: { id: participantId },
      data: {
        ...(input.ready !== undefined ? { readyAt: input.ready ? new Date() : null } : {}),
        ...(input.absent !== undefined ? { absent: input.absent } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.note !== undefined ? { notes: input.note || p.notes } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: 'SLOT_PARTICIPANT_STATE', entity: 'MatchParticipant', entityId: participantId,
        before: { readyAt: p.readyAt, absent: p.absent, status: p.status },
        after: { readyAt: row.readyAt, absent: row.absent, status: row.status, note: input.note ?? null },
        ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return row;
  }, TX_OPTS);
  return { id: updated.id, ready: updated.readyAt !== null, absent: updated.absent, status: updated.status };
}

/** Pair independently-registered players into a real team (admin action).
 * This powers both the DUO "register solo, get paired by admin" path and the
 * new SQUAD / Clash Squad free-agent path. Players register with no team, then
 * an admin selects exactly teamSize registrations and this turns them into a
 * DUO or SQUAD team, updates the registrations, and notifies + audits the
 * change. Race-safe via the tournament row lock and the Team.tag uniqueness. */
export async function pairIndependentTeam(
  adminId: string,
  tournamentId: string,
  registrationIds: string[],
  ctx: Ctx = {},
) {
  const ids = [...new Set(registrationIds.filter(Boolean))];
  if (ids.length < 2 || ids.length > 4) {
    throw badRequest('VALIDATION_ERROR', 'Pick between 2 and 4 players to pair.');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "tournaments" WHERE "id" = ${tournamentId} FOR UPDATE`;
    const t = await tx.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, title: true, type: true },
    });
    if (!t) throw notFound('Tournament not found');
    if (t.type !== 'DUO' && t.type !== 'SQUAD' && t.type !== 'CLASH_SQUAD') {
      throw badRequest('VALIDATION_ERROR', 'Only team-mode tournaments pair solo registrants.');
    }
    const teamType = t.type === 'DUO' ? 'DUO' as const : 'SQUAD' as const;
    const expectedCount = teamType === 'DUO' ? 2 : 4;
    const modeLabel = teamType === 'DUO' ? 'duo' : 'squad';
    if (ids.length !== expectedCount) {
      throw badRequest('VALIDATION_ERROR', `A ${modeLabel} needs exactly ${expectedCount} players (you selected ${ids.length}).`);
    }

    const regs = await tx.tournamentRegistration.findMany({
      where: { id: { in: ids } },
      include: { user: { select: { id: true, username: true, status: true } } },
    });
    if (regs.length !== ids.length) throw notFound('One or more registrations were not found.');
    for (const r of regs) {
      if (r.tournamentId !== tournamentId) {
        throw badRequest('VALIDATION_ERROR', 'All players must be registered for this tournament.');
      }
      if (r.status !== 'CONFIRMED') {
        throw badRequest('VALIDATION_ERROR', 'All registrations must be confirmed.');
      }
      if (r.teamId) {
        throw conflict('CONFLICT', 'One of these players is already in a team.');
      }
      if (r.user.status !== 'ACTIVE') {
        throw badRequest('VALIDATION_ERROR', 'All players must have active accounts.');
      }
    }
    regs.sort((a, b2) => ids.indexOf(a.id) - ids.indexOf(b2.id));
    const captain = regs[0]!;

    // No selected player may already hold a team of this type elsewhere
    // (the one-team-per-mode invariant used by the join engine).
    const existingMember = await tx.teamMember.findFirst({
      where: { userId: { in: regs.map((r) => r.userId) }, team: { type: teamType } },
      select: { userId: true },
    });
    if (existingMember) {
      throw conflict('CONFLICT', 'One of these players already belongs to a team of this mode.');
    }

    // Unique tag with a collision-retry loop (Team.tag is @unique).
    const tagPrefix = teamType === 'DUO' ? 'D' : 'S';
    let team: { id: string; name: string; tag: string } | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      const tag = `${tagPrefix}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      try {
        team = await tx.team.create({
          data: {
            name: `${t.title.trim().slice(0, 18) || modeLabel} — paired`,
            tag,
            type: teamType,
            captainId: captain.userId,
            members: {
              create: regs.map((r, i) => ({
                userId: r.userId,
                role: i === 0 ? 'CAPTAIN' as const : 'MEMBER' as const,
              })),
            },
          },
        });
        break;
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    if (!team) throw badRequest('VALIDATION_ERROR', 'Could not generate a unique team tag — try again.');

    await tx.tournamentRegistration.updateMany({
      where: { id: { in: ids } },
      // PHASE 18 — pairing IS this team's registration moment, so the roster is
      // frozen here exactly like a captain-led join: the four who paid (and only
      // they) are who the prize money belongs to.
      data: {
        teamId: team.id,
        rosterUserIds: [...new Set(regs.map((r) => r.userId))].sort() as unknown as Prisma.InputJsonValue,
        rosterCapturedAt: new Date(),
      },
    });

    for (const r of regs) {
      const partners = regs.filter((o) => o.id !== r.id).map((o) => o.user.username).join(', ');
      await tx.notification.create({
        data: {
          userId: r.userId,
          type: 'TOURNAMENT_UPDATE',
          title: `${modeLabel.toUpperCase()} paired — ${t.title}`,
          body: `You were paired${partners ? ` with ${partners}` : ''} for this tournament. Room details stay in My Matches.`,
          data: { tournamentId, teamId: team.id },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: 'INDEPENDENT_TEAM_PAIRED',
        entity: 'Team',
        entityId: team.id,
        after: { tournamentId, mode: teamType, registrations: ids, members: regs.map((r) => r.userId) },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });

    return { teamId: team.id, name: team.name, tag: team.tag, members: regs.map((r) => r.userId) };
  }, TX_OPTS);
}

/** Manual slot bookkeeping for players with no participant row yet (ready flag on registration). */
export async function setRegistrationReady(
  adminId: string,
  registrationId: string,
  ready: boolean,
  note: string | null,
  ctx: Ctx = {},
) {
  const reg = await prisma.tournamentRegistration.findUnique({ where: { id: registrationId } });
  if (!reg) throw notFound('Registration not found');
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.tournamentRegistration.update({
      where: { id: registrationId },
      data: { slotNote: note ?? (ready ? 'READY' : reg.slotNote) },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId, action: ready ? 'SLOT_READY' : 'SLOT_NOT_READY', entity: 'TournamentRegistration', entityId: registrationId,
        after: { ready, note: note ?? null }, ip: ctx.ip, userAgent: ctx.userAgent,
      },
    });
    return row;
  }, TX_OPTS);
  return { id: updated.id, slotNote: updated.slotNote };
}
