// Legal / trust pages + How It Works — content served from the API (static_pages).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import { renderMarkdownSafe } from '@/lib/markdown';

interface Page { slug: string; title: string; content: string; }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await apiServerSafe<Page>(`/public/pages/${slug}`);
  return { title: page ? `${page.title}` : 'Page' };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await apiServerSafe<Page>(`/public/pages/${slug}`);
  if (!page) notFound();
  const html = await renderMarkdownSafe(page.content);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-3 hover:text-accent">
        <ArrowLeft size={15} /> Home
      </Link>
      <h1 className="mt-5 font-display text-3xl font-bold text-fg">{page.title}</h1>
      <div className="prose-cn mt-6" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
