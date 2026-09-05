// =============================================================================
// Public read APIs — power the public website, SEO pages and (later) Flutter.
// GET-only, no auth required. Room credentials are never served from here.
// =============================================================================
import { Router } from 'express';
import { z } from 'zod';
import * as svc from '../services/public.service';
import { ok } from '../lib/respond';
import { badRequest } from '../lib/errors';

export const publicRouter = Router();

const pageQuery = z.coerce.number().int().min(1).default(1);
const limitQuery = z.coerce.number().int().min(1).max(50).default(12);

publicRouter.get('/tournaments', async (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type.toUpperCase() : undefined;
  if (type && !['SOLO', 'DUO', 'SQUAD', 'CLASH_SQUAD', 'LONE_WOLF', 'CLASH_SQUAD_1V1', 'CUSTOM'].includes(type)) {
    throw badRequest('VALIDATION_ERROR', 'Invalid tournament type');
  }
  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
  if (status && !['REGISTRATION_OPEN', 'LIVE', 'COMPLETED', 'CANCELLED'].includes(status)) {
    throw badRequest('VALIDATION_ERROR', 'Invalid status filter');
  }
  const sort = ['startTime', 'prizePool', 'entryFeePerPlayer', 'createdAt'].includes(String(req.query.sort))
    ? (String(req.query.sort) as 'startTime')
    : undefined;
  const data = await svc.listTournaments({
    type,
    status,
    search: typeof req.query.search === 'string' ? req.query.search.slice(0, 80) : undefined,
    sort,
    dir: req.query.dir === 'asc' ? 'asc' : 'desc',
    page: pageQuery.parse(req.query.page ?? 1),
    limit: limitQuery.parse(req.query.limit ?? 12),
  });
  return ok(res, data);
});

publicRouter.get('/tournaments/:slug', async (req, res) => {
  const slug = String(req.params.slug).slice(0, 120);
  return ok(res, await svc.getTournamentBySlug(slug));
});

// Final standings + credited winners for a completed tournament (Phase 8).
publicRouter.get('/tournaments/:slug/results', async (req, res) => {
  const slug = String(req.params.slug).slice(0, 120);
  return ok(res, await svc.tournamentResults(slug));
});

publicRouter.get('/stats/home', async (_req, res) => {
  return ok(res, await svc.homeStats());
});

publicRouter.get('/leaderboard', async (req, res) => {
  const period = ['all', 'weekly', 'monthly'].includes(String(req.query.period))
    ? (String(req.query.period) as 'all' | 'weekly' | 'monthly')
    : 'all';
  return ok(res, await svc.leaderboard({
    period,
    page: pageQuery.parse(req.query.page ?? 1),
    limit: limitQuery.parse(req.query.limit ?? 20),
  }));
});

publicRouter.get('/winners', async (req, res) => {
  const take = Math.min(24, Math.max(1, Number(req.query.limit ?? 8)));
  return ok(res, await svc.recentWinners(take));
});

publicRouter.get('/blog', async (req, res) => {
  return ok(res, await svc.listBlogPosts(
    pageQuery.parse(req.query.page ?? 1),
    Math.min(24, Math.max(1, Number(req.query.limit ?? 9))),
  ));
});

publicRouter.get('/blog/:slug', async (req, res) => {
  return ok(res, await svc.getBlogPost(String(req.params.slug).slice(0, 120)));
});

publicRouter.get('/pages/:slug', async (req, res) => {
  return ok(res, await svc.getStaticPage(String(req.params.slug).slice(0, 60)));
});

publicRouter.get('/players/:username', async (req, res) => {
  return ok(res, await svc.getPublicPlayer(String(req.params.username).slice(0, 40)));
});

publicRouter.get('/faqs', async (_req, res) => {
  return ok(res, await svc.listFaqs());
});

publicRouter.get('/settings/public', async (_req, res) => {
  return ok(res, await svc.publicSettings());
});

// Phase 12 — per-page SEO overrides (title/description/canonical/OG/keywords)
publicRouter.get('/seo/:pageSlug', async (req, res) => {
  const slug = String(req.params.pageSlug).slice(0, 120);
  return ok(res, await svc.getSeoConfig(slug));
});

// Admin-managed ad placements (rendered by the site)
publicRouter.get('/ads/:placement', async (req, res) => {
  const placement = String(req.params.placement).slice(0, 24);
  return ok(res, await svc.activeAds(placement));
});

// Anonymous analytics beacons — the counters on the Advertisement model exist
// but nothing incremented them until now. Fire-and-forget from the consumer.
publicRouter.post('/ads/:id/impression', async (req, res) => {
  await svc.recordAdImpression(String(req.params.id).slice(0, 40));
  return ok(res, { recorded: true });
});

publicRouter.post('/ads/:id/click', async (req, res) => {
  await svc.recordAdClick(String(req.params.id).slice(0, 40));
  return ok(res, { recorded: true });
});
