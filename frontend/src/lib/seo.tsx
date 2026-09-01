// SEO toolkit (Phase 12) — one metadata builder used by every public page,
// admin-managed per-page overrides (SeoConfig via /public/seo/:slug), and
// JSON-LD structured data: Organization, WebSite, FAQPage, BreadcrumbList,
// Event (tournaments) and Article (blog).
import type { Metadata } from 'next';
import { apiServerSafe } from './api';

export const SITE_URL = (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const SITE_NAME = 'CLUTCHNEX';

interface SeoOverride {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  ogImageUrl?: string;
  keywords?: string;
}

export interface PageMetaInput {
  /** SeoConfig pageSlug for admin overrides, e.g. 'home', 'leaderboard' */
  slug: string;
  title: string;
  description: string;
  /** Canonical path on this site, e.g. '/tournaments' */
  path: string;
  keywords?: string;
  ogImage?: string;
  type?: 'website' | 'article';
  publishedTime?: string;
  noIndex?: boolean;
}

/**
 * Build page metadata: built-in title/description, overridden by the admin
 * SEO screen (SeoConfig), with canonical URL, Open Graph + Twitter cards.
 */
export async function pageMetadata(input: PageMetaInput): Promise<Metadata> {
  const override = await apiServerSafe<SeoOverride>(`/public/seo/${input.slug}`) ?? {};
  const title = override.title?.trim() || input.title;
  const description = override.description?.trim() || input.description;
  const canonical = override.canonicalUrl?.trim() || `${SITE_URL}${input.path}`;
  const ogImage = override.ogImageUrl?.trim() || input.ogImage || undefined;
  const keywords = (override.keywords?.trim() || input.keywords || '')
    .split(',').map((k) => k.trim()).filter(Boolean);

  const md: Metadata = {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: input.type ?? 'website',
      ...(input.type === 'article' && input.publishedTime ? { publishedTime: input.publishedTime } : {}),
      ...(ogImage ? { images: [{ url: ogImage, width: 1200, height: 630, alt: title }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    ...(keywords.length ? { keywords } : {}),
    ...(input.noIndex ? { robots: { index: false, follow: false } } : {}),
  };
  return md;
}

// ---------------------------------------------------------------------------
// JSON-LD builders — rendered once per page via <JsonLd>
// ---------------------------------------------------------------------------

export function JsonLd({ data }: { data: Record<string, unknown> | Array<Record<string, unknown>> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

export function organizationJsonLd(whatsapp?: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.ico`,
    description: 'Premium Free Fire esports tournament platform for Pakistan — Solo, Duo, Squad and Clash Squad tournaments with verified PKR prize pools.',
    ...(whatsapp ? { contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', telephone: whatsapp, availableLanguage: ['en', 'ur'] }] } : {}),
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/tournaments?search={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export function faqJsonLd(faqs: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  };
}

/** Event structured data for a tournament (entry fee = offers, prizes in description). */
export function eventJsonLd(t: {
  title: string; slug: string; description?: string | null;
  startTime: string | Date; type: string; entryFee: number; prizePool: number; currency?: string;
}) {
  const start = new Date(t.startTime);
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${t.title} — Free Fire ${t.type === 'CLASH_SQUAD' ? 'Clash Squad' : t.type === 'LONE_WOLF' ? 'Lone Wolf' : t.type === 'CLASH_SQUAD_1V1' ? 'Clash Squad 1v1' : t.type} Tournament`,
    url: `${SITE_URL}/tournaments/${t.slug}`,
    startDate: start.toISOString(),
    endDate: new Date(start.getTime() + 3 * 3600_000).toISOString(),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url: `${SITE_URL}/tournaments/${t.slug}` },
    description:
      t.description?.slice(0, 300) ||
      `Free Fire ${t.type} tournament on CLUTCHNEX. Entry ₨${t.entryFee}, prize pool ₨${t.prizePool}. Room credentials release to registered players before the match.`,
    image: [`${SITE_URL}/favicon.ico`],
    organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    offers: {
      '@type': 'Offer',
      price: String(t.entryFee),
      priceCurrency: 'PKR',
      availability: 'https://schema.org/InStock',
      url: `${SITE_URL}/tournaments/${t.slug}`,
      validFrom: new Date(Date.now() - 7 * 86400_000).toISOString(),
    },
  };
}

export function articleJsonLd(post: {
  title: string; slug: string; excerpt?: string | null; publishedAt?: string | null; author: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title.slice(0, 110),
    description: post.excerpt ?? undefined,
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.publishedAt ?? undefined,
    author: { '@type': 'Person', name: post.author },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
  };
}
