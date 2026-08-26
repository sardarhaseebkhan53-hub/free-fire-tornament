// Blog article — markdown rendered server-side (trusted admin content).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { marked } from 'marked';
import { ArrowLeft } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import { dateOnly } from '@/lib/format';
import { Badge } from '@/components/ui';

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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await apiServerSafe<Post>(`/public/blog/${slug}`);
  return {
    title: post?.seoTitle ?? post?.title ?? 'Article',
    description: post?.seoDescription ?? post?.excerpt ?? undefined,
  };
}

export default async function BlogArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await apiServerSafe<Post>(`/public/blog/${slug}`);
  if (!post) notFound();

  const html = await marked.parse(post.content, { async: true });

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
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
        // Admin-authored markdown (trusted source); served read-only.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
