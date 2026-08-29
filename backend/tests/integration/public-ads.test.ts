// =============================================================================
// Integration — public ad placements (§E.1).
//
// Regression coverage for the activeAds date-window bug: the original query
// combined `OR: [{startsAt:null},{startsAt:{lte:now}}]` with
// `AND: [{endsAt:null},{endsAt:{gte:now}}]`, which required endsAt to be null
// AND in the future on the same row at once — impossible — so the endpoint
// always returned zero ads. Also covers the impression/click counters.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeAds, recordAdClick, recordAdImpression } from '../../src/services/public.service';
import { db, setSetting } from '../helpers/db';

const created: string[] = [];
const HOUR = 3_600_000;

async function makeAd(overrides: {
  placement?: string; isActive?: boolean;
  startsAt?: Date | null; endsAt?: Date | null;
} = {}) {
  const ad = await db.advertisement.create({
    data: {
      placement: (overrides.placement ?? 'HEADER') as never,
      name: `test-ad-${created.length}`,
      isActive: overrides.isActive ?? true,
      startsAt: overrides.startsAt ?? null,
      endsAt: overrides.endsAt ?? null,
    },
  });
  created.push(ad.id);
  return ad;
}

afterAll(async () => {
  await db.advertisement.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

describe('activeAds — date-window filtering (§E.1)', () => {
  beforeAll(async () => {
    // Apps ship with ads.enabled=false; these tests exercise the placement
    // logic, so turn the master switch on for this suite.
    await setSetting('ads.enabled', true);
  });

  it('returns ads that are live now (null window, past start, future end)', async () => {
    await makeAd({ startsAt: null, endsAt: null });
    await makeAd({ startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + HOUR) });
    await makeAd({ startsAt: null, endsAt: new Date(Date.now() + HOUR) });
    await makeAd({ startsAt: new Date(Date.now() - HOUR), endsAt: null });

    const { items } = await activeAds('HEADER');
    expect(items).toHaveLength(4);
  });

  it('excludes ads that have not started yet', async () => {
    await makeAd({ startsAt: new Date(Date.now() + HOUR), endsAt: null });
    const { items } = await activeAds('HEADER');
    expect(items.some((a) => a.name === 'test-ad-4')).toBe(false);
  });

  it('excludes ads that have already ended', async () => {
    await makeAd({ startsAt: null, endsAt: new Date(Date.now() - HOUR) });
    const { items } = await activeAds('HEADER');
    expect(items.some((a) => a.name === 'test-ad-5')).toBe(false);
  });

  it('excludes inactive ads and other placements', async () => {
    await makeAd({ isActive: false });
    await makeAd({ placement: 'SIDEBAR' });
    const { items } = await activeAds('HEADER');
    expect(items.some((a) => a.name === 'test-ad-6')).toBe(false);
    expect(items.some((a) => a.name === 'test-ad-7')).toBe(false);
  });
});

describe('ad impression/click counters (§E.1)', () => {
  it('increments impression and click counters server-side', async () => {
    const ad = await makeAd({});
    await recordAdImpression(ad.id);
    await recordAdImpression(ad.id);
    await recordAdClick(ad.id);

    const row = await db.advertisement.findUnique({ where: { id: ad.id } });
    expect(row?.impressions).toBe(2);
    expect(row?.clicks).toBe(1);
  });

  it('is a safe no-op for unknown ad ids', async () => {
    await expect(recordAdImpression('does-not-exist')).resolves.toBeUndefined();
    await expect(recordAdClick('does-not-exist')).resolves.toBeUndefined();
  });
});
