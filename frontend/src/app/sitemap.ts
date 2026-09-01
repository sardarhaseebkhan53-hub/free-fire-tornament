// sitemap.xml — static routes + live tournaments + published blog posts.
import type { MetadataRoute } from 'next';
import { apiServerSafe } from '@/lib/api';
import { SITE_URL } from '@/lib/seo';
import type { TournamentSummary } from '@/lib/types';

interface BlogItem { slug: string; publishedAt: string }

export const revalidate = 3600; // hourly

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/free-fire-tournaments`, lastModified: now, changeFrequency: 'daily', priority: 0.95 },
    { url: `${SITE_URL}/tournaments`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/tournaments/solo`, lastModified: now, changeFrequency: 'daily', priority: 0.85 },
    { url: `${SITE_URL}/tournaments/duo`, lastModified: now, changeFrequency: 'daily', priority: 0.85 },
    { url: `${SITE_URL}/tournaments/squad`, lastModified: now, changeFrequency: 'daily', priority: 0.85 },
    { url: `${SITE_URL}/tournaments/clash-squad`, lastModified: now, changeFrequency: 'daily', priority: 0.85 },
    { url: `${SITE_URL}/tournaments/lone-wolf`, lastModified: now, changeFrequency: 'daily', priority: 0.85 },
    { url: `${SITE_URL}/tournaments/clash-squad-1v1`, lastModified: now, changeFrequency: 'daily', priority: 0.85 },
    { url: `${SITE_URL}/leaderboard`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/winners`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE_URL}/blog`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE_URL}/support`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/register`, lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
  ];

  const [tournaments, blog] = await Promise.all([
    apiServerSafe<{ items: TournamentSummary[] }>('/public/tournaments?limit=50'),
    apiServerSafe<{ items: BlogItem[] }>('/public/blog?limit=50'),
  ]);

  const tournamentRoutes: MetadataRoute.Sitemap = (tournaments?.items ?? []).map((t) => ({
    url: `${SITE_URL}/tournaments/${t.slug}`,
    lastModified: now,
    changeFrequency: 'hourly',
    priority: 0.8,
  }));

  const blogRoutes: MetadataRoute.Sitemap = (blog?.items ?? []).map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: new Date(p.publishedAt),
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [...staticRoutes, ...tournamentRoutes, ...blogRoutes];
}
