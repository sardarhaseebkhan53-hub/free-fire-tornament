// /api/teams — team management (spec §36).
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { ok } from '../lib/respond';
import {
  createTeam, inviteMember, leaveTeam, myInvites, myTeams, removeMember,
  respondInvite, teamDetails, transferCaptaincy, updateTeam,
} from '../services/team.service';
import { createTeamSchema, idBodySchema, inviteSchema, updateTeamSchema } from '../validation/team.schema';

export const teamRouter = Router();
teamRouter.use(requireAuth);

teamRouter.post('/', async (req, res) => {
  const body = createTeamSchema.parse(req.body);
  const team = await createTeam(req.auth!.id, body);
  return ok(res, team, 'Team created', 201);
});

teamRouter.get('/my', async (req, res) => {
  return ok(res, await myTeams(req.auth!.id));
});

teamRouter.get('/invites/my', async (req, res) => {
  return ok(res, await myInvites(req.auth!.id));
});

teamRouter.post('/invites/:inviteId/accept', async (req, res) => {
  return ok(res, await respondInvite(req.auth!.id, String(req.params.inviteId), true), 'Invite accepted');
});

teamRouter.post('/invites/:inviteId/decline', async (req, res) => {
  return ok(res, await respondInvite(req.auth!.id, String(req.params.inviteId), false), 'Invite declined');
});

teamRouter.get('/:teamId', async (req, res) => {
  return ok(res, await teamDetails(String(req.params.teamId)));
});

teamRouter.patch('/:teamId', async (req, res) => {
  const body = updateTeamSchema.parse(req.body);
  return ok(res, await updateTeam(req.auth!.id, String(req.params.teamId), body), 'Team updated');
});

teamRouter.post('/:teamId/invite', async (req, res) => {
  const { username } = inviteSchema.parse(req.body);
  return ok(res, await inviteMember(req.auth!.id, String(req.params.teamId), username), 'Invite sent', 201);
});

teamRouter.post('/:teamId/remove', async (req, res) => {
  const { userId } = idBodySchema.parse(req.body);
  return ok(res, await removeMember(req.auth!.id, String(req.params.teamId), userId), 'Member removed');
});

teamRouter.post('/:teamId/leave', async (req, res) => {
  return ok(res, await leaveTeam(req.auth!.id, String(req.params.teamId)), 'You left the team');
});

teamRouter.post('/:teamId/transfer', async (req, res) => {
  const { userId } = idBodySchema.parse(req.body);
  return ok(res, await transferCaptaincy(req.auth!.id, String(req.params.teamId), userId), 'Captaincy transferred');
});
