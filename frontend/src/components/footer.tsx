// Footer — spec §49: brand, links, legal, WhatsApp support.
// v2 upgrade: real brand icons (WhatsApp/Discord/Instagram/YouTube/Facebook/
// TikTok), 44px touch targets, hover glow, configurable community links.
import Link from 'next/link';
import { Users } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import {
  WhatsAppIcon, DiscordIcon, InstagramIcon, YouTubeIcon, FacebookIcon, TikTokIcon,
} from '@/components/social-icons';

export async function Footer() {
  const settings = await apiServerSafe<Record<string, unknown>>('/public/settings/public');
  const whatsapp = String(settings?.['platform.whatsappNumber'] ?? '');
  const community = String(settings?.['platform.whatsappCommunity'] ?? '');
  const waHref = whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, '')}` : 'https://whatsapp.com';

  const socials = [
    { href: waHref, label: 'WhatsApp', Icon: WhatsAppIcon },
    { href: String(settings?.['social.discord'] ?? 'https://discord.gg/clutchnex'), label: 'Discord', Icon: DiscordIcon },
    { href: String(settings?.['social.instagram'] ?? 'https://instagram.com/clutchnex'), label: 'Instagram', Icon: InstagramIcon },
    { href: String(settings?.['social.youtube'] ?? 'https://youtube.com/@clutchnex'), label: 'YouTube', Icon: YouTubeIcon },
    { href: String(settings?.['social.facebook'] ?? 'https://facebook.com/clutchnex'), label: 'Facebook', Icon: FacebookIcon },
    { href: String(settings?.['social.tiktok'] ?? 'https://tiktok.com/@clutchnex'), label: 'TikTok', Icon: TikTokIcon },
  ];

  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div>
          <p className="font-display text-lg font-bold text-fg">
            CLUTCH<span className="text-accent">NEX</span>
          </p>
          <p className="mt-1 text-xs font-semibold tracking-[0.2em] uppercase text-fg-3">
            Compete. Clutch. Conquer.
          </p>
          <p className="mt-4 max-w-xs text-sm text-fg-2">
            Pakistan&apos;s premium Free Fire tournament platform — verified prize pools,
            transparent fees, fair play.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              className="press inline-flex items-center gap-2 rounded-input bg-success/15 px-4 py-2 text-sm font-semibold text-success transition hover:bg-success/25"
            >
              <WhatsAppIcon size={15} /> WhatsApp Support
            </a>
            {community && (
              <a
                href={community}
                target="_blank"
                rel="noreferrer"
                className="press inline-flex items-center gap-2 rounded-input bg-reward/15 px-4 py-2 text-sm font-semibold text-reward transition hover:bg-reward/25"
              >
                <Users size={15} /> WhatsApp Community
              </a>
            )}
          </div>

          {/* Social — official brand icons, real links, 44px touch targets */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {socials.map(({ href, label, Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                title={label}
                className="press touch-target h-11 w-11 rounded-full border border-line bg-white/[3%] text-fg-3 transition hover:border-accent/50 hover:text-accent hover:glow-accent"
              >
                <Icon size={16} />
              </a>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold tracking-[0.15em] uppercase text-fg-3">Platform</p>
          <ul className="space-y-2 text-sm text-fg-2">
            <li><Link className="transition hover:text-accent" href="/tournaments">Tournaments</Link></li>
            <li><Link className="transition hover:text-accent" href="/leaderboard">Leaderboard</Link></li>
            <li><Link className="transition hover:text-accent" href="/winners">Winners</Link></li>
            <li><Link className="transition hover:text-accent" href="/blog">Blog</Link></li>
            <li><Link className="transition hover:text-accent" href="/legal/how-it-works">How It Works</Link></li>
            <li><Link className="transition hover:text-accent" href="/matches">Matches</Link></li>
            <li><Link className="transition hover:text-accent" href="/teams">Teams</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold tracking-[0.15em] uppercase text-fg-3">Support</p>
          <ul className="space-y-2 text-sm text-fg-2">
            <li><Link className="transition hover:text-accent" href="/support">Support Center</Link></li>
            <li><Link className="transition hover:text-accent" href="/legal/tournament-rules">Tournament Rules</Link></li>
            <li><Link className="transition hover:text-accent" href="/legal/fair-play-policy">Fair Play Policy</Link></li>
            <li><Link className="transition hover:text-accent" href="/legal/contact">Contact</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold tracking-[0.15em] uppercase text-fg-3">Legal</p>
          <ul className="space-y-2 text-sm text-fg-2">
            <li><Link className="transition hover:text-accent" href="/legal/terms-of-service">Terms &amp; Conditions</Link></li>
            <li><Link className="transition hover:text-accent" href="/legal/privacy-policy">Privacy Policy</Link></li>
            <li><Link className="transition hover:text-accent" href="/legal/refund-policy">Refund Policy</Link></li>
            <li><Link className="transition hover:text-accent" href="/legal/responsible-play">Responsible Play</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line px-4 py-5 text-center text-xs text-fg-3">
        <p className="mx-auto max-w-3xl">
          <span className="font-semibold text-fg-2">
            CLUTCHNEX is currently available as a web application / PWA.
          </span>{' '}
          Install it from your browser — it is not distributed on Google Play or the Apple App Store.
        </p>
        <p className="mt-2">
          © {new Date().getFullYear()} CLUTCHNEX. Tournaments are skill-based competitive events —
          no guaranteed earnings. Please participate responsibly.
        </p>
      </div>
    </footer>
  );
}
