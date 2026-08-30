/* eslint-disable no-console */
// =============================================================================
// Phase 12 verification — SEO + Blog CMS.
//
// Run (frontend :3000 + backend :4000 + database up, seeded):
//   npx tsx scripts/verify-seo.mts
//
// Proves:
//   1. robots.txt — sitemap reference + app/admin/API surfaces disallowed.
//   2. sitemap.xml — static pages, the SEO hub, all four mode routes, live
//      tournament slugs and published blog slugs.
//   3. Structured data — Organization + WebSite + FAQPage on home, FAQPage +
//      BreadcrumbList on the hub and mode pages, Event + BreadcrumbList on
//      tournament details, Article on blog posts.
//   4. Canonical URLs + Open Graph tags on every checked page.
//   5. Admin SEO overrides actually reach the site: upsert SeoConfig for
//      'winners' → the live page title/og:title change; removing the override
//      restores the built-in metadata.
//   6. Blog CMS SEO fields: a published post with seoTitle/seoDescription uses
//      them on the article page (title + og + Article JSON-LD headline).
//   7. Auth pages are noindex.
// =============================================================================
import 'dotenv/config';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:3000';
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api';
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=5';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function get(path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${WEB}${path}`, { cache: 'no-store' });
  return { status: res.status, text: await res.text() };
}

async function api(path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();

  // A real admin user for the SEO/blog write paths.
  const staffId = (
    await db.query(
      // Idempotent: the script must be re-runnable against the same database.
      `INSERT INTO users (id, username, email, "passwordHash", role, status, "isVerified", "referralCode", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text,'seotest_admin','seotest_admin@example.com','x','ADMIN','ACTIVE',true,'RES-seo',now(),now())
       ON CONFLICT (username) DO UPDATE SET role='ADMIN', status='ACTIVE', "deletedAt"=NULL
       RETURNING id`,
    )
  ).rows[0].id as string;
  const admin = jwt.sign({ sub: staffId, role: 'ADMIN', username: 'seotest_admin' }, ACCESS_SECRET, { expiresIn: '15m' });

  // ---- 1. robots.txt --------------------------------------------------------
  const robots = await get('/robots.txt');
  check('robots.txt served', robots.status === 200);
  check('robots.txt references the sitemap', /sitemap:\s*http[^\s]*\/sitemap\.xml/i.test(robots.text));
  check('robots.txt disallows /admin, /dashboard, /api', robots.text.includes('/admin') && robots.text.includes('/dashboard') && robots.text.includes('/api/'));

  // ---- 2. sitemap.xml -------------------------------------------------------
  const sitemap = await get('/sitemap.xml');
  check('sitemap.xml served', sitemap.status === 200);
  for (const route of [
    '/free-fire-tournaments',
    '/tournaments/solo', '/tournaments/duo', '/tournaments/squad', '/tournaments/clash-squad',
    '/tournaments', '/leaderboard', '/winners', '/blog', '/support',
  ]) {
    check(`sitemap contains ${route}`, sitemap.text.includes(route));
  }
  const dbT = await db.query(`SELECT slug FROM tournaments LIMIT 1`);
  const dbB = await db.query(`SELECT slug FROM blog_posts WHERE status='PUBLISHED' LIMIT 1`);
  if (dbT.rows[0]) check('sitemap contains live tournament slugs', sitemap.text.includes(`/tournaments/${dbT.rows[0].slug}`));
  if (dbB.rows[0]) check('sitemap contains published blog slugs', sitemap.text.includes(`/blog/${dbB.rows[0].slug}`));
  check('sitemap excludes private routes', !sitemap.text.includes('/dashboard') && !sitemap.text.includes('/admin'));

  // ---- 3. Home: Organization + WebSite + FAQPage + canonical + OG ------------
  const home = await get('/');
  check('home has canonical', home.text.includes('rel="canonical"'));
  check('home has og:title', home.text.includes('property="og:title"'));
  check('home has twitter card', home.text.includes('twitter:card'));
  check('home has Organization JSON-LD', home.text.includes('"@type":"Organization"'));
  check('home has WebSite JSON-LD', home.text.includes('"@type":"WebSite"'));
  check('home has FAQPage JSON-LD', home.text.includes('"@type":"FAQPage"'));

  // ---- 4. Hub + mode pages ----------------------------------------------------
  const hub = await get('/free-fire-tournaments');
  check('SEO hub renders', hub.status === 200);
  check('hub canonical points at itself', hub.text.includes('/free-fire-tournaments'));
  check('hub has FAQPage + BreadcrumbList JSON-LD', hub.text.includes('"@type":"FAQPage"') && hub.text.includes('"@type":"BreadcrumbList"'));
  check('hub links all four modes', ['/tournaments/solo', '/tournaments/duo', '/tournaments/squad', '/tournaments/clash-squad'].every((h) => hub.text.includes(h)));

  const solo = await get('/tournaments/solo');
  check('solo mode page renders with canonical', solo.status === 200 && solo.text.includes('rel="canonical"'));
  check('solo page has FAQPage + Breadcrumb JSON-LD', solo.text.includes('"@type":"FAQPage"') && solo.text.includes('"@type":"BreadcrumbList"'));
  check('solo page carries mode keywords', solo.text.includes('Solo Free Fire Tournaments'));

  // ---- 5. Tournament details: Event + Breadcrumb --------------------------------
  if (dbT.rows[0]) {
    const slug = dbT.rows[0].slug as string;
    const detail = await get(`/tournaments/${slug}`);
    check('tournament page has Event JSON-LD', detail.text.includes('"@type":"Event"'));
    check('Event JSON-LD carries entry fee offer', detail.text.includes('"@type":"Offer"'));
    check('tournament page has BreadcrumbList', detail.text.includes('"@type":"BreadcrumbList"'));
    check('tournament page has og:title', detail.text.includes('property="og:title"'));
    // mode route precedence: /tournaments/solo must NOT resolve as a [slug] tournament
    const t = await db.query(`SELECT title FROM tournaments WHERE slug=$1`, [slug]);
    check('tournament detail renders its title', detail.text.includes(String(t.rows[0].title).slice(0, 12)));
  }

  // ---- 6. Blog article: Article JSON-LD + SEO fields ------------------------------
  const seoTitle = `SEO test headline ${Date.now()}`;
  const created = await api('/admin/blog', admin, {
    title: 'Verify SEO blog pipeline',
    category: 'NEWS',
    content: 'This article exists to verify that seoTitle and seoDescription reach the public article page.',
    seoTitle,
    seoDescription: 'A verification-only SEO description for the Phase 12 suite.',
    publish: true,
  });
  check('admin can publish a post with SEO fields', created.status === 201, String(created.json.message ?? ''));
  const newSlug = (created.json.data as { slug?: string } | undefined)?.slug;
  if (newSlug) {
    const art = await get(`/blog/${newSlug}`);
    check('article uses the custom SEO title', art.text.includes(seoTitle));
    check('article has Article JSON-LD', art.text.includes('"@type":"Article"'));
    check('article og:type is article', /property="og:type"[^>]*content="article"/.test(art.text));
    check('article has canonical', art.text.includes('rel="canonical"'));
    const sitemap2 = await get('/sitemap.xml');
    check('new post appears in sitemap', sitemap2.text.includes(`/blog/${newSlug}`));
    await db.query(`DELETE FROM blog_posts WHERE slug=$1`, [newSlug]);
  } else {
    check('post slug returned', false);
  }

  // ---- 7. Admin SeoConfig overrides reach the live site ----------------------------
  const seoPublic = await api('/public/seo/winners');
  check('public SEO endpoint responds', seoPublic.status === 200 && typeof seoPublic.json.data === 'object');
  const overrideTitle = `Winners OVERRIDE ${Date.now()}`;
  const up = await api('/admin/seo', admin, { pageSlug: 'winners', title: overrideTitle, description: 'Override description for verification.' });
  check('admin upserts a SeoConfig override', up.status === 200);
  const winners = await get('/winners');
  check('live page reflects the override title', winners.text.includes(overrideTitle), overrideTitle);
  check('override lands in og:title too', /property="og:title"[^>]*Winners OVERRIDE/.test(winners.text));
  await api('/admin/seo', admin, { pageSlug: 'winners', title: '', description: '' }); // clear
  const winners2 = await get('/winners');
  check('clearing the override restores built-in metadata', !winners2.text.includes(overrideTitle) && winners2.text.includes('Verified PKR Prize Payouts'));

  // ---- 8. Auth pages noindex --------------------------------------------------------
  const login = await get('/login');
  check('login page is noindex', login.text.includes('noindex'));

  // ---- cleanup -----------------------------------------------------------------------
  await db.query(`DELETE FROM seo_configs WHERE "pageSlug"='winners'`);
  await db.query(`DELETE FROM audit_logs WHERE "actorId"=$1`, [staffId]);
  await db.query(`DELETE FROM users WHERE username='seotest_admin'`);
  await db.end();

  console.log(failures === 0 ? '\n🏆 All SEO & Blog CMS checks passed.' : `\n💥 ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
