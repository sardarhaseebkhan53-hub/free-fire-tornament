'use client';
// Mobile featured tournament card — design 41: art, ENTRY FEE (gem), PRIZE POOL,
// mode chip + teams, fill progress, and the STARTS IN countdown boxes.
import Link from 'next/link';
import { Crown, Gem, Users } from 'lucide-react';
import { MODE_LABEL } from '@/lib/format';
import { useTimeLeft } from '@/lib/client-time';

export interface FeaturedTournament {
  slug: string;
  title: string;
  type: string;
  entryFeePerPlayer: number;
  prizePool: number;
  registeredSlots: number;
  maxSlots: number;
  startsInMs: number;
  banner: string | null;
}

function Boxes({ targetMs }: { targetMs: number }) {
  const left = useTimeLeft(targetMs);
  const t = Math.max(0, left ?? targetMs);
  const parts: Array<[string, number]> = [
    ['DAYS', Math.floor(t / 86_400_000)],
    ['HRS', Math.floor((t % 86_400_000) / 3600_000)],
    ['MINS', Math.floor((t % 3600_000) / 60_000)],
    ['SECS', Math.floor((t % 60_000) / 1000)],
  ];
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-fg-3">Starts in</span>
      {parts.map(([label, v], i) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="min-w-[2.4rem] rounded-input border border-line bg-white/[4%] px-1.5 py-1 text-center">
            <span className="tabular block font-display text-sm font-bold leading-none text-fg">{String(v).padStart(2, '0')}</span>
            <span className="mt-1 block text-[7px] font-bold tracking-wider text-fg-3">{label}</span>
          </span>
          {i < parts.length - 1 && <span className="text-fg-3">·</span>}
        </span>
      ))}
    </div>
  );
}

export function FeaturedMobile({ t }: { t: FeaturedTournament }) {
  const fillPct = Math.min(100, Math.round((t.registeredSlots / t.maxSlots) * 100));
  return (
    <section className="px-4 pt-6 lg:hidden">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-fg">
          <Crown size={16} className="text-reward" /> Featured Tournament
        </p>
        <Link href="/tournaments" className="-m-1.5 px-1.5 py-1.5 text-xs font-semibold text-fg-3 transition hover:text-accent active:scale-95">view all</Link>
      </div>

      <Link href={`/tournaments/${t.slug}`} className="glass card-hover block overflow-hidden rounded-card">
        <div className="flex gap-4 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={t.banner ?? '/art/tournament-default.png'}
            alt=""
            className="h-24 w-24 shrink-0 rounded-card border border-line object-cover sm:h-28 sm:w-28"
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-base font-bold text-fg">{t.title}</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-fg-3">
                  Entry Fee <Gem size={11} className="text-accent" />
                </p>
                <p className="tabular font-display text-lg font-bold text-accent">PKR {t.entryFeePerPlayer.toLocaleString('en-PK')}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-fg-3">Prize Pool</p>
                <p className="tabular font-display text-lg font-bold text-reward">PKR {t.prizePool.toLocaleString('en-PK')}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 text-xs text-fg-2">
          <span className="rounded-pill border border-line bg-white/[4%] px-2.5 py-0.5 font-semibold">{MODE_LABEL[t.type] ?? t.type}</span>
          <span className="flex items-center gap-1.5">
            <Users size={13} className="text-fg-3" /> {t.registeredSlots}/{t.maxSlots} Teams
            <span className="ml-2 font-bold text-accent">{fillPct}%</span>
          </span>
        </div>
        <div className="px-4 pt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong" style={{ width: `${fillPct}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-4">
          <Boxes targetMs={t.startsInMs} />
        </div>
      </Link>
    </section>
  );
}
