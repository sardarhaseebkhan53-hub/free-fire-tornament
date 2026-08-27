// Mobile bottom navigation — design 41/42: Home, Tournaments, Matches, Wallet,
// Profile. Active item: violet icon in a soft glow box + violet label.
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Swords, Trophy, Wallet, User } from 'lucide-react';

const ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/tournaments', label: 'Tournaments', icon: Trophy },
  { href: '/matches', label: 'Matches', icon: Swords },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/dashboard', label: 'Profile', icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Bottom navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-base/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-md items-stretch justify-between px-2 pt-1.5">
        {ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 rounded-card pb-1.5 pt-1 text-[10px] font-semibold transition ${
                active ? 'text-accent' : 'text-fg-3 hover:text-fg-2'
              }`}
            >
              <span
                className={`flex h-8 w-12 items-center justify-center rounded-lg transition ${
                  active
                    ? 'bg-accent/15 shadow-[0_0_16px_rgba(139,92,246,0.35)]'
                    : ''
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 2} />
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
