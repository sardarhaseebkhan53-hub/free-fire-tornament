/* eslint-disable no-console */
// =============================================================================
// Phase 13 verification — PWA: manifest, icons, service worker, offline page,
// install wiring, standalone meta.
//
// Run (web app up on :3000 — production build recommended so the SW registers):
//   npx tsx scripts/verify-pwa.mts
//
// Proves (against the running site + committed source):
//   1. /manifest.webmanifest — standalone display, obsidian theme, start_url,
//      shortcuts, 192 + 512 + maskable icons.
//   2. Icons are real PNGs at the exact declared sizes (IHDR parsed).
//   3. /sw.js — install/activate/fetch handlers, precaches /offline, and NEVER
//      intercepts /api/ (auth + money stay live).
//   4. /offline — renders the offline shell and is noindex.
//   5. Home HTML — manifest link, apple-touch-icon, apple-mobile-web-app-capable,
//      theme-color.
//   6. robots.txt keeps the PWA assets crawlable; sitemap excludes /offline.
//   7. Source wiring — SwRegister (production-gated) + InstallBanner mounted in
//      the root layout; registration points at /sw.js with scope /.
// =============================================================================
import 'dotenv/config';
import { readFileSync } from 'node:fs';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:3000';
const FRONTEND = process.env.FRONTEND_DIR ?? '../frontend';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function get(path: string): Promise<{ status: number; type: string; body: Buffer; text: string }> {
  const res = await fetch(`${WEB}${path}`, { cache: 'no-store' });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type') ?? '', body, text: body.toString('utf8') };
}

/** PNG dimensions straight from the IHDR chunk. */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function main() {
  // ---- 1. Manifest ----------------------------------------------------------
  const mf = await get('/manifest.webmanifest');
  check('manifest served as JSON', mf.status === 200 && mf.type.includes('json'));
  const manifest = JSON.parse(mf.text) as {
    name?: string; short_name?: string; display?: string; theme_color?: string;
    background_color?: string; start_url?: string; scope?: string;
    icons?: Array<{ src: string; sizes: string; purpose?: string }>;
    shortcuts?: unknown[];
  };
  check('manifest names the app', manifest.name?.includes('CLUTCHNEX') && manifest.short_name === 'CLUTCHNEX');
  check('standalone display with obsidian theme', manifest.display === 'standalone' && manifest.theme_color === '#070A14');
  check('start_url & scope are /', manifest.start_url === '/' && manifest.scope === '/');
  const icons = manifest.icons ?? [];
  check(
    'icons declare 192, 512 and maskable 512',
    icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512' && !i.purpose) && icons.some((i) => i.purpose === 'maskable'),
  );
  check('manifest ships app shortcuts', (manifest.shortcuts?.length ?? 0) >= 3);

  // ---- 2. Icons are real PNGs at declared sizes -------------------------------
  for (const [path, w] of [
    ['/icons/icon-192.png', 192],
    ['/icons/icon-512.png', 512],
    ['/icons/icon-maskable-512.png', 512],
    ['/icons/apple-touch-icon.png', 180],
  ] as const) {
    const icon = await get(path);
    const size = icon.status === 200 ? pngSize(icon.body) : null;
    check(`${path} is a ${w}×${w} PNG`, size?.w === w && size?.h === w, size ? `${size.w}×${size.h}` : `HTTP ${icon.status}`);
  }

  // ---- 3. Service worker -------------------------------------------------------
  const sw = await get('/sw.js');
  check('sw.js served as JavaScript', sw.status === 200 && (sw.type.includes('javascript') || sw.type.includes('ecmascript')));
  check('sw handles install/activate/fetch', /addEventListener\('install'/.test(sw.text) && /addEventListener\('activate'/.test(sw.text) && /addEventListener\('fetch'/.test(sw.text));
  check('sw precaches the offline shell', sw.text.includes("'/offline'"));
  check('sw NEVER intercepts /api/', /\/api\//.test(sw.text) && /return;\s*$|return;/m.test(sw.text.split('pathname.startsWith')[1]?.slice(0, 120) ?? ''));
  check('sw is versioned for clean deploys', /CACHE\s*=\s*`?clutchnex-/.test(sw.text));

  // ---- 4. Offline page ----------------------------------------------------------
  const offline = await get('/offline');
  check('offline page renders', offline.status === 200 && offline.text.includes('re offline') && offline.text.toLowerCase().includes('offline mode'));
  check('offline page is noindex', offline.text.includes('noindex'));

  // ---- 5. Home HTML head ---------------------------------------------------------
  const home = await get('/');
  check('home links the manifest', /rel="manifest"/.test(home.text));
  check('home declares apple-touch-icon', /apple-touch-icon/.test(home.text));
  check('home sets apple-mobile-web-app-capable', /apple-mobile-web-app-capable[^>]*content="yes"/.test(home.text) || /content="yes"[^>]*apple-mobile-web-app-capable/.test(home.text));
  check('home sets theme-color', /theme-color/i.test(home.text));

  // ---- 6. Crawl rules -------------------------------------------------------------
  const robots = await get('/robots.txt');
  check('PWA assets stay crawlable', !/disallow:[^\n]*\/(sw\.js|manifest|icons)/i.test(robots.text));
  const sitemap = await get('/sitemap.xml');
  check('sitemap excludes /offline', !sitemap.text.includes('/offline'));

  // ---- 7. Source wiring -------------------------------------------------------------
  const layout = readFileSync(`${FRONTEND}/src/app/layout.tsx`, 'utf8');
  const pwa = readFileSync(`${FRONTEND}/src/components/pwa.tsx`, 'utf8');
  check('SwRegister + InstallBanner mounted in root layout', layout.includes('<SwRegister') && layout.includes('<InstallBanner'));
  check('registration is production-gated', pwa.includes("NODE_ENV !== 'production'"));
  check('registration targets /sw.js at scope /', pwa.includes("'/sw.js'") && pwa.includes("scope: '/'"));
  check('install prompt respects dismissals', pwa.includes(DISMISS_MARKER));

  console.log(failures === 0 ? '\n🏆 All PWA checks passed.' : `\n💥 ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

const DISMISS_MARKER = 'cn_install_dismissed_at';

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
