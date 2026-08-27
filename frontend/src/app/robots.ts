// robots.txt — public site indexable; app/admin/API surfaces excluded.
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/dashboard', '/wallet', '/matches', '/teams', '/support/tickets'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
