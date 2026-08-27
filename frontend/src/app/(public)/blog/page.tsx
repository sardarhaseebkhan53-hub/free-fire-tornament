// Blog listing — admin-managed content, SEO fields served from the API.
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import type { BlogSummary } from '@/lib/types';
import { dateOnly } from '@/lib/format';
import { SectionHeading, Badge, EmptyState } from '@/components/ui';

export const metadata = {
  title: 'Blog — Guides, Meta & Tournament News',
  description: 'Free Fire tournament guides, Clash Squad meta, and CLUTCHNEX announcements.',
};

export default async function BlogPage() {
  const data = await apiServerSafe<{ items: BlogSummary[]; total: number }>('/public/blog?limit=12');
  const posts = data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <SectionHeading
        kicker="Insights"
        title="Blog"
        sub="Guides, strategy and platform announcements from the CLUTCHNEX team."
      />
      {posts.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="glass group flex flex-col overflow-hidden rounded-card transition hover:-translate-y-1 hover:border-accent/40"
            >
              <div className="h-32 bg-gradient-to-br from-info/25 via-elevated to-surface">
                <div className="flex h-full items-end p-4">
                  <Badge tone="info">{p.category}</Badge>
                </div>
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h2 className="font-display text-base font-bold leading-snug text-fg group-hover:text-accent">
                  {p.title}
                </h2>
                {p.excerpt && <p className="mt-2 line-clamp-3 text-sm text-fg-2">{p.excerpt}</p>}
                <div className="mt-auto flex items-center justify-between pt-4 text-xs text-fg-3">
                  <span>{p.author.username}</span>
                  <span>{dateOnly(p.publishedAt)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No articles yet" sub="Guides and news land here soon." />
      )}
    </div>
  );
}
