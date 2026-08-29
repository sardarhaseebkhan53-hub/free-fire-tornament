// =============================================================================
// Teams — create, invite, accept/decline, remove, leave, transfer captaincy.
// Rules: a player holds at most one DUO and one SQUAD team; member caps are
// 2 (duo) and 4 (squad); only captains manage membership.
// =============================================================================
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import type { Prisma, TeamType } from '../../generated/prisma';

const CAPACITY: Record<TeamType, number> = { DUO: 2, SQUAD: 4 };

/** Unique human-friendly team join code: CNX-XXXXX */
function newJoinCode(): string {
  return `CNX-${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5)}`;
}

/** Captain — get or rotate the team's shareable join code. */
export async function teamJoinCode(actorId: string, teamId: string, rotate: boolean) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw notFound('Team not found');
  if (team.captainId !== actorId) throw forbidden('Only the captain can manage the join code.');

  if (team.joinCode && !rotate) return { code: team.joinCode };
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newJoinCode();
    try {
      const updated = await prisma.team.update({ where: { id: teamId }, data: { joinCode: code } });
      return { code: updated.joinCode };
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
  }
  throw badRequest('VALIDATION_ERROR', 'Could not generate a unique code — try again.');
}


/** Admin — rotate any team's join code (captain agnostic). Audited. */
export async function rotateTeamJoinCode(adminId: string, teamId: string, ctx: { ip?: string; userAgent?: string } = {}) {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true, joinCode: true } });
  if (!team) throw notFound('Team not found');
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newJoinCode();
    try {
      const updated = await prisma.team.update({ where: { id: teamId }, data: { joinCode: code } });
      await prisma.auditLog.create({
        data: {
          actorId: adminId, action: 'TEAM_JOIN_CODE_ROTATED', entity: 'Team', entityId: teamId,
          before: { joinCode: team.joinCode }, after: { joinCode: updated.joinCode },
          ip: ctx.ip, userAgent: ctx.userAgent,
        },
      });
      return { code: updated.joinCode };
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
  }
  throw badRequest('VALIDATION_ERROR', 'Could not generate a unique code — try again.');
}

/** Player — join a DUO/SQUAD team via code (accepts CNX-XXXXX or raw code). */
export async function joinByCode(userId: string, codeRaw: string) {
  const code = codeRaw.trim().toUpperCase();
  return prisma.$transaction(async (tx) => {
    // Lock in a stable order: user first, then team. This serializes the
    // one-duo/one-squad invariant and the target team's capacity check.
    const userRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status" FROM "users" WHERE "id" = ${userId} FOR UPDATE
    `;
    if (!userRows[0] || userRows[0].status !== 'ACTIVE') throw forbidden('Account is not active.');
    const teamRows = await tx.$queryRaw<Array<{ id: string; captainId: string; type: string; name: string; tag: string }>>`
      SELECT "id", "captainId", "type", "name", "tag"
      FROM "teams" WHERE "joinCode" = ${code} FOR UPDATE
    `;
    const team = teamRows[0];
    if (!team) throw notFound('Team not found — check the code.');
    if (team.captainId === userId) throw badRequest('VALIDATION_ERROR', 'You are this team’s captain.');

    const existing = await tx.teamMember.findFirst({ where: { userId, team: { type: team.type as TeamType } } });
    if (existing) throw conflict('CONFLICT', `You already belong to a ${team.type.toLowerCase()} team.`);
    const members = await tx.teamMember.count({ where: { teamId: team.id } });
    if (members >= CAPACITY[team.type as TeamType]) throw badRequest('VALIDATION_ERROR', 'This team is full.');

    const member = await tx.teamMember.create({
      data: { teamId: team.id, userId, role: 'MEMBER' },
    });
    await tx.notification.create({
      data: {
        userId: team.captainId, type: 'TEAM_INVITE',
        title: 'New squadmate via join code',
        body: `A player joined ${team.name} [${team.tag}] with your code.`,
        data: { teamId: team.id },
      },
    });
    return { teamId: team.id, name: team.name, tag: team.tag, memberId: member.id };
  });
}

// ---------------------------------------------------------------------------
export async function createTeam(userId: string, input: { name: string; tag: string; type: TeamType }) {
  const tag = input.tag.trim().toUpperCase();
  // Every team is born with a shareable join code (spec §8) — the captain can
  // copy it straight from the create response / team card instead of waiting
  // for a lazy GET. Retry on the (rare) join-code unique collision; a tag
  // collision is a real conflict and is reported as such.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const userRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT "id", "status" FROM "users" WHERE "id" = ${userId} FOR UPDATE
        `;
        if (!userRows[0] || userRows[0].status !== 'ACTIVE') throw forbidden('Account is not active.');
        const existing = await tx.teamMember.findFirst({
          where: { userId, team: { type: input.type } },
          select: { team: { select: { name: true } } },
        });
        if (existing) {
          throw conflict('CONFLICT', `You already belong to a ${input.type.toLowerCase()} team (${existing.team.name}).`);
        }
        return tx.team.create({
          data: {
            name: input.name.trim(),
            tag,
            type: input.type,
            captainId: userId,
            joinCode: newJoinCode(),
            members: { create: { userId, role: 'CAPTAIN' } },
          },
        });
      });
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      // P2002 can be the tag OR the join code. If the tag is taken it is a
      // genuine conflict; otherwise the random code collided — loop again.
      const tagTaken = await prisma.team.findUnique({ where: { tag } });
      if (tagTaken) throw conflict('CONFLICT', 'This team tag is taken.');
    }
  }
  throw badRequest('VALIDATION_ERROR', 'Could not generate a unique join code — try again.');
}

export async function updateTeam(actorId: string, teamId: string, patch: { name?: string; tag?: string }) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw notFound('Team not found');
  if (team.captainId !== actorId) throw forbidden('Only the captain can edit the team.');
  try {
    return await prisma.team.update({
      where: { id: teamId },
      data: {
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.tag ? { tag: patch.tag.trim().toUpperCase() } : {}),
      },
    });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2002') throw conflict('CONFLICT', 'This team tag is taken.');
    throw e;
  }
}

// ---------------------------------------------------------------------------
export async function inviteMember(actorId: string, teamId: string, usernameRaw: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { members: true },
  });
  if (!team) throw notFound('Team not found');
  if (team.captainId !== actorId) throw forbidden('Only the captain can invite players.');
  if (team.members.length >= CAPACITY[team.type]) throw badRequest('VALIDATION_ERROR', 'Team is already full.');

  const username = usernameRaw.trim().toLowerCase();
  const invitee = await prisma.user.findUnique({ where: { username } });
  if (!invitee || invitee.status !== 'ACTIVE') {
    throw notFound('No player found with that username — check the spelling and try again.');
  }
  if (invitee.id === actorId) throw badRequest('VALIDATION_ERROR', 'You cannot invite yourself.');

  const hasTeam = await prisma.teamMember.findFirst({
    where: { userId: invitee.id, team: { type: team.type } },
  });
  if (hasTeam) throw conflict('CONFLICT', `${invitee.username} already has a ${team.type.toLowerCase()} team.`);

  const invite = await prisma.teamInvite.upsert({
    where: { teamId_inviteeId: { teamId, inviteeId: invitee.id } },
    create: { teamId, inviteeId: invitee.id, invitedById: actorId, status: 'PENDING' },
    update: { status: 'PENDING', invitedById: actorId, respondedAt: null },
  });
  await prisma.notification.create({
    data: {
      userId: invitee.id, type: 'TEAM_INVITE',
      title: `Invite from ${team.name} [${team.tag}]`,
      body: 'Open Teams to accept or decline.',
      data: { teamId, inviteId: invite.id },
    },
  });
  return invite;
}

export async function myInvites(userId: string) {
  return prisma.teamInvite.findMany({
    where: { inviteeId: userId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    include: {
      team: { select: { id: true, name: true, tag: true, type: true } },
      invitedBy: { select: { username: true } },
    },
  });
}

export async function respondInvite(userId: string, inviteId: string, accept: boolean) {
  if (!accept) {
    const updated = await prisma.teamInvite.updateMany({
      where: { id: inviteId, inviteeId: userId, status: 'PENDING' },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    if (updated.count !== 1) throw notFound('Invite not found or already handled.');
    return prisma.teamInvite.findUniqueOrThrow({ where: { id: inviteId } });
  }

  return prisma.$transaction(async (tx) => {
    const userRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status" FROM "users" WHERE "id" = ${userId} FOR UPDATE
    `;
    if (!userRows[0] || userRows[0].status !== 'ACTIVE') throw forbidden('Account is not active.');

    const invite = await tx.teamInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.inviteeId !== userId || invite.status !== 'PENDING') {
      throw notFound('Invite not found or already handled.');
    }
    const teamRows = await tx.$queryRaw<Array<{ id: string; captainId: string; type: string; name: string; tag: string }>>`
      SELECT "id", "captainId", "type", "name", "tag"
      FROM "teams" WHERE "id" = ${invite.teamId} FOR UPDATE
    `;
    const team = teamRows[0];
    if (!team) throw notFound('Team not found.');

    const existing = await tx.teamMember.findFirst({ where: { userId, team: { type: team.type as TeamType } } });
    if (existing) throw conflict('CONFLICT', `You already belong to a ${team.type.toLowerCase()} team.`);
    const members = await tx.teamMember.count({ where: { teamId: team.id } });
    if (members >= CAPACITY[team.type as TeamType]) {
      throw badRequest('VALIDATION_ERROR', 'The team filled up before you accepted.');
    }

    const updated = await tx.teamInvite.updateMany({
      where: { id: inviteId, status: 'PENDING' },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
    if (updated.count !== 1) throw conflict('CONFLICT', 'This invite was updated by another request.');
    await tx.teamMember.create({ data: { teamId: team.id, userId, role: 'MEMBER' } });
    await tx.notification.create({
      data: {
        userId: team.captainId, type: 'TEAM_INVITE',
        title: 'Invite accepted',
        body: `A player joined ${team.name}.`,
      },
    });
    return tx.teamInvite.findUniqueOrThrow({ where: { id: inviteId } });
  });
}

// ---------------------------------------------------------------------------
async function assertTeamRosterMutable(tx: Prisma.TransactionClient, teamId: string) {
  const activeRegistration = await tx.tournamentRegistration.findFirst({
    where: {
      teamId,
      status: 'CONFIRMED',
      tournament: { status: { in: ['REGISTRATION_OPEN', 'LIVE'] } },
    },
    select: { tournament: { select: { title: true } } },
  });
  if (activeRegistration) {
    throw conflict('CONFLICT', `Roster is locked while ${activeRegistration.tournament.title} is active. Use the admin replacement/refund flow.`);
  }
}

export async function removeMember(actorId: string, teamId: string, memberId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "teams" WHERE "id" = ${teamId} FOR UPDATE`;
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team) throw notFound('Team not found');
    if (team.captainId !== actorId) throw forbidden('Only the captain can remove members.');
    if (memberId === team.captainId) throw badRequest('VALIDATION_ERROR', 'The captain cannot be removed — transfer captaincy first.');
    await assertTeamRosterMutable(tx, teamId);
    const deleted = await tx.teamMember.deleteMany({ where: { teamId, userId: memberId } });
    if (deleted.count !== 1) throw notFound('That player is not in this team.');
    return { removed: true };
  });
}

export async function leaveTeam(userId: string, teamId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "teams" WHERE "id" = ${teamId} FOR UPDATE`;
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team) throw notFound('Team not found');
    if (team.captainId === userId) {
      throw badRequest('VALIDATION_ERROR', 'Captains must transfer captaincy before leaving.');
    }
    await assertTeamRosterMutable(tx, teamId);
    const deleted = await tx.teamMember.deleteMany({ where: { teamId, userId } });
    if (deleted.count !== 1) throw notFound('You are not a member of this team.');
    return { left: true };
  });
}

export async function transferCaptaincy(actorId: string, teamId: string, newCaptainId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "teams" WHERE "id" = ${teamId} FOR UPDATE`;
    const team = await tx.team.findUnique({
      where: { id: teamId },
      include: { members: true },
    });
    if (!team) throw notFound('Team not found');
    if (team.captainId !== actorId) throw forbidden('Only the captain can transfer captaincy.');
    const target = team.members.find((m) => m.userId === newCaptainId);
    if (!target) throw notFound('That player is not in this team.');

    await tx.team.update({ where: { id: teamId }, data: { captainId: newCaptainId } });
    await tx.teamMember.updateMany({ where: { teamId, userId: actorId }, data: { role: 'MEMBER' } });
    await tx.teamMember.updateMany({ where: { teamId, userId: newCaptainId }, data: { role: 'CAPTAIN' } });
    return { transferred: true };
  });
}

// ---------------------------------------------------------------------------
export async function myTeams(userId: string) {
  return prisma.teamMember.findMany({
    where: { userId },
    include: {
      team: {
        include: {
          members: { select: { userId: true } },
          captain: { select: { username: true } },
        },
      },
    },
  });
}

export async function teamDetails(teamId: string, requesterId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      captain: { select: { username: true } },
      members: {
        include: {
          user: {
            select: {
              username: true, avatar: true,
              profile: { select: { freeFireUID: true, freeFireIGN: true, fullName: true } },
              stats: { select: { wins: true, matchesPlayed: true, kills: true, totalPoints: true } },
            },
          },
        },
      },
      registrations: {
        where: { status: 'CONFIRMED' },
        orderBy: { registeredAt: 'desc' },
        take: 10,
        select: {
          registeredAt: true,
          tournament: { select: { title: true, slug: true, type: true, status: true } },
        },
      },
      winnings: {
        where: { status: 'CREDITED' },
        orderBy: { creditedAt: 'desc' },
        take: 5,
        select: { position: true, amount: true, creditedAt: true },
      },
    },
  });
  if (!team) throw notFound('Team not found');
  if (!team.members.some((member) => member.userId === requesterId)) {
    // This route powers the authenticated team-management screen, not a public
    // player directory. Do not leak roster identities to another player.
    throw forbidden('You are not a member of this team.');
  }
  return team;
}
