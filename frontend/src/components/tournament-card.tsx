// Tournament card — design 01 (desktop grid) + design 41 (mobile horizontal
// row): banner art, type, entry, prize, slots, countdown, join button.
import Link from 'next/link';
import { Gem, MapPin, ShieldCheck, Users } from 'lucide-react';
import type { TournamentSummary } from '@/lib/types';
import { money, MODE_LABEL, dateTime, displayStatus } from '@/lib/format';
import { Badge } from './ui';
import { Countdown } from './countdown';
import { TournamentImage } from './tournament-image';

function statusBadge(t: TournamentSummary) {
  const s = displayStatus(t);
  if (s === 'LIVE') return <Badge tone="danger" live>Live</Badge>;
  if (s === 'FULL') return <Badge tone="neutral">Full</Badge>;
  if (s === 'ALMOST_FULL') return <Badge tone="warning">Almost Full</Badge>;
  if (s === 'REGISTRATION_OPEN') return <Badge tone="success">Open</Badge>;
  if (s === 'UPCOMING') return <Badge tone="info">Upcoming</Badge>;
  if (s === 'COMPLETED') return <Badge tone="neutral">Completed</Badge>;
  return <Badge tone="warning">Cancelled</Badge>;
}

export function TournamentCard({ t }: { t: TournamentSummary }) {
  const fillPct = Math.min(100, Math.round((t.registeredSlots / t.maxSlots) * 100));
  return (
    <Link
      href={`/tournaments/${t.slug}`}
      className="glass card-hover group flex overflow-hidden rounded-card duration-200 hover:-translate-y-1 sm:flex-col"
    >
      {/* Banner zone — tournament art with the approved gradient treatment */}
      <div className="relative h-auto min-h-28 w-24 shrink-0 overflow-hidden bg-gradient-to-br from-accent/30 via-elevated to-surface sm:h-28 sm:w-full">
        {t.banner && (
          <TournamentImage
            src={t.banner}
            alt=""
            label={t.title}
            className="absolute inset-0 h-full w-full object-cover opacity-55 transition duration-300 group-hover:scale-[1.03] group-hover:opacity-70"
          />
        )}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(139,92,246,0.35),transparent_60%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-surface/80 via-transparent to-transparent" />
        <div className="absolute left-4 top-4 hidden gap-2 sm:flex">
          <Badge tone="accent">{MODE_LABEL[t.type]}</Badge>
          {statusBadge(t)}
        </div>
        {t.isVerified && (
          <div className="absolute right-4 top-4 hidden items-center gap-1 text-xs font-semibold text-success sm:flex">
            <ShieldCheck size={14} /> Verified
          </div>
        )}
        <span className="absolute bottom-2 left-2 rounded-pill bg-base/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent sm:hidden">
          {MODE_LABEL[t.type]}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-display text-sm font-bold leading-snug text-fg group-hover:text-accent sm:text-lg sm:leading-snug">
            {t.title}
          </h3>
          <div className="sm:hidden">{statusBadge(t)}</div>
        </div>
        <p className="mt-1 hidden items-center gap-3 text-xs text-fg-3 sm:flex">
          {t.map && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {t.map}</span>}
          <span>{dateTime(t.startTime)}</span>
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-input bg-white/[4%] px-2 py-2 text-left sm:text-center">
            <p className="text-[9px] font-bold uppercase tracking-wide text-fg-3 sm:text-[10px]">Prize Pool</p>
            <p className="tabular text-sm font-bold text-reward sm:text-base">{money(t.prizePool)}</p>
          </div>
          <div className="rounded-input bg-white/[4%] px-2 py-2 text-left sm:text-center">
            <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-fg-3 sm:justify-center sm:text-[10px]">
              <Gem size={10} className="text-accent sm:hidden" /> Entry Fee
            </p>
            <p className="tabular text-sm font-bold text-fg sm:text-base">{money(t.entryFeePerPlayer)}</p>
          </div>
          <div className="hidden rounded-input bg-white/[4%] px-2 py-2 text-center sm:block">
            <p className="tabular text-base font-bold text-fg">
              {t.registeredSlots}/{t.maxSlots}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-fg-3">Slots</p>
          </div>
        </div>

        {/* Slots progress */}
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong transition-[width] duration-500"
              style={{ width: `${fillPct}%` }}
            />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-3">
            <Users size={12} className="shrink-0" />
            {t.registeredSlots}/{t.maxSlots}
            {t.slotsLeft > 0 && t.registrationOpen && (
              <span className="font-semibold text-warning">· only {t.slotsLeft} left</span>
            )}
            {t.map && <span className="hidden sm:inline">· {t.map}</span>}
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 sm:mt-4 sm:pt-4">
          <div className="text-xs text-fg-3">
            {t.status === 'COMPLETED' ? (
              'Completed'
            ) : (
              <>
                Starts in{' '}
                <Countdown targetMs={t.startsInMs} className="font-semibold text-fg" />
              </>
            )}
          </div>
          {t.registrationOpen && t.slotsLeft > 0 ? (
            <span className="rounded-input bg-accent px-4 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition duration-200 group-hover:bg-accent-strong group-hover:shadow-[0_0_22px_rgba(139,92,246,0.55)] group-active:scale-95 sm:px-5">
              Join
            </span>
          ) : t.status === 'REGISTRATION_OPEN' && t.slotsLeft <= 0 ? (
            <span className="rounded-input border border-line bg-white/[3%] px-4 py-2 text-xs font-bold text-fg-3 sm:px-5">
              Tournament Full
            </span>
          ) : (
            <span className="rounded-input border border-line px-4 py-2 text-xs font-semibold text-fg-3 transition group-hover:border-accent/30 group-hover:text-fg-2 sm:px-5">
              {t.status === 'COMPLETED' ? 'Results' : 'Details'}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
