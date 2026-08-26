// =============================================================================
// Teams — create, invite, accept/decline, remove, leave, transfer captaincy.
// Rules: a player holds at most one DUO and one SQUAD team; member caps are
// 2 (duo) and 4 (squad); only captains manage membership.
// =============================================================================
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import type { TeamType } from '../../generated/prisma';

const CAPACITY: Record<TeamType, number> = { DUO: 2, SQUAD: 4 };

async function assertNoTeamOfType(userId: string, type: TeamType) {
  const existing = await prisma.teamMember.findFirst({
    where: { userId, team: { type } },
    select: { team: { select: { name: true } } },
  });
  if (existing) {
    throw conflict('CONFLICT', `You already belong to a ${type.toLowerCase()} team (${existing.team.name}).`);
  }
}

// ---------------------------------------------------------------------------
export async function createTeam(userId: string, input: { name: string; tag: string; type: TeamType }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'ACTIVE') throw forbidden('Account is not active.');
  await assertNoTeamOfType(userId, input.type);

  try {
    const team = await prisma.team.create({
      data: {
        name: input.name.trim(),
        tag: input.tag.trim().toUpperCase(),
        type: input.type,
        captainId: userId,
        members: { create: { userId, role: 'CAPTAIN' } },
      },
    });
    return team;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2002') {
      throw conflict('CONFLICT', 'This team tag is taken.');
    }
    throw e;
  }
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
  if (!invitee || invitee.status !== 'ACTIVE') throw notFound('Player not found');
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
  const invite = await prisma.teamInvite.findUnique({
    where: { id: inviteId },
    include: { team: { include: { members: true } } },
  });
  if (!invite || invite.inviteeId !== userId) throw notFound('Invite not found');
  if (invite.status !== 'PENDING') throw badRequest('VALIDATION_ERROR', 'Invite already handled.');

  if (!accept) {
    return prisma.teamInvite.update({ where: { id: inviteId }, data: { status: 'DECLINED', respondedAt: new Date() } });
  }

  await assertNoTeamOfType(userId, invite.team.type);
  if (invite.team.members.length >= CAPACITY[invite.team.type]) {
    throw badRequest('VALIDATION_ERROR', 'The team filled up before you accepted.');
  }

  const [updated] = await prisma.$transaction([
    prisma.teamInvite.update({ where: { id: inviteId }, data: { status: 'ACCEPTED', respondedAt: new Date() } }),
    prisma.teamMember.create({ data: { teamId: invite.teamId, userId, role: 'MEMBER' } }),
    prisma.notification.create({
      data: {
        userId: invite.team.captainId, type: 'TEAM_INVITE',
        title: 'Invite accepted',
        body: `A player joined ${invite.team.name}.`,
      },
    }),
  ]);
  return updated;
}

// ---------------------------------------------------------------------------
export async function removeMember(actorId: string, teamId: string, memberId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw notFound('Team not found');
  if (team.captainId !== actorId) throw forbidden('Only the captain can remove members.');
  if (memberId === team.captainId) throw badRequest('VALIDATION_ERROR', 'The captain cannot be removed — transfer captaincy first.');
  await prisma.teamMember.deleteMany({ where: { teamId, userId: memberId } });
  return { removed: true };
}

export async function leaveTeam(userId: string, teamId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw notFound('Team not found');
  if (team.captainId === userId) {
    throw badRequest('VALIDATION_ERROR', 'Captains must transfer captaincy before leaving.');
  }
  await prisma.teamMember.deleteMany({ where: { teamId, userId } });
  return { left: true };
}

export async function transferCaptaincy(actorId: string, teamId: string, newCaptainId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { members: true },
  });
  if (!team) throw notFound('Team not found');
  if (team.captainId !== actorId) throw forbidden('Only the captain can transfer captaincy.');
  const target = team.members.find((m) => m.userId === newCaptainId);
  if (!target) throw notFound('That player is not in this team.');

  await prisma.$transaction([
    prisma.team.update({ where: { id: teamId }, data: { captainId: newCaptainId } }),
    prisma.teamMember.updateMany({ where: { teamId, userId: actorId }, data: { role: 'MEMBER' } }),
    prisma.teamMember.updateMany({ where: { teamId, userId: newCaptainId }, data: { role: 'CAPTAIN' } }),
  ]);
  return { transferred: true };
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

export async function teamDetails(teamId: string) {
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
  return team;
}
