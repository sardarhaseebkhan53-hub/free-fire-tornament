// Blog article — markdown rendered server-side and sanitised before it reaches
// the DOM. Admin-authored is NOT a trust boundary: a stolen staff session must
// not become stored XSS on a public page.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import { renderMarkdownSafe } from '@/lib/markdown';
import { dateOnly } from '@/lib/format';
import { Badge } from '@/components/ui';
import { AdSlot } from '@/components/ad-slot';
import { JsonLd, articleJsonLd, breadcrumbJsonLd, pageMetadata } from '@/lib/seo';
import type { Metadata } from 'next';

interface Post {
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  category: string;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  author: { username: string };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await apiServerSafe<Post>(`/public/blog/${slug}`);
  if (!post) return { title: 'Article not found | CLUTCHNEX' };
  return pageMetadata({
    slug: `blog-${slug}`,
    title: `${post.seoTitle ?? post.title} | CLUTCHNEX Blog`,
    description: post.seoDescription ?? post.excerpt ?? `${post.title} — read it on the CLUTCHNEX blog.`,
    path: `/blog/${slug}`,
    type: 'article',
    publishedTime: post.publishedAt ?? undefined,
  });
}

export default async function BlogArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await apiServerSafe<Post>(`/public/blog/${slug}`);
  if (!post) notFound();

  const html = await renderMarkdownSafe(post.content);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {/* Structured data — Article + Breadcrumb (Phase 12) */}
      <JsonLd
        data={[
          articleJsonLd({
            title: post.title, slug: post.slug, excerpt: post.excerpt,
            publishedAt: post.publishedAt, author: post.author.username,
          }),
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Blog', path: '/blog' },
            { name: post.title, path: `/blog/${post.slug}` },
          ]),
        ]}
      />
      <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-3 hover:text-accent">
        <ArrowLeft size={15} /> All articles
      </Link>
      <div className="mt-6 flex items-center gap-3">
        <Badge tone="info">{post.category}</Badge>
        {post.publishedAt && <span className="text-xs text-fg-3">{dateOnly(post.publishedAt)}</span>}
      </div>
      <h1 className="mt-4 font-display text-3xl font-bold leading-tight text-fg sm:text-4xl">{post.title}</h1>
      <p className="mt-3 text-sm text-fg-3">By {post.author.username}</p>
      <div
        className="prose-cn mt-8"
        // Sanitised: only allow-listed tags/attributes and http(s)/mailto/tel
        // URLs survive renderMarkdownSafe.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <AdSlot placement="BLOG" className="mt-10" />
    </article>
  );
}
