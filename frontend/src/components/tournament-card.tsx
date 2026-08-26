// Tournament card — spec §67: banner, type, entry, prize, slots, start time,
// countdown, status, join button.
import Link from 'next/link';
import { MapPin, ShieldCheck, Users } from 'lucide-react';
import type { TournamentSummary } from '@/lib/types';
import { money, MODE_LABEL, dateTime } from '@/lib/format';
import { Badge } from './ui';
import { Countdown } from './countdown';

function statusBadge(t: TournamentSummary) {
  if (t.status === 'LIVE') return <Badge tone="danger" live>Live</Badge>;
  if (t.status === 'REGISTRATION_OPEN') return <Badge tone="success">Open</Badge>;
  if (t.status === 'COMPLETED') return <Badge tone="neutral">Completed</Badge>;
  return <Badge tone="warning">Cancelled</Badge>;
}

export function TournamentCard({ t }: { t: TournamentSummary }) {
  const fillPct = Math.min(100, Math.round((t.registeredSlots / t.maxSlots) * 100));
  return (
    <Link
      href={`/tournaments/${t.slug}`}
      className="glass group flex flex-col overflow-hidden rounded-card transition-transform duration-200 hover:-translate-y-1 hover:border-accent/40"
    >
      {/* Banner zone (gradient artwork until banners are uploaded) */}
      <div className="relative h-28 bg-gradient-to-br from-accent/30 via-elevated to-surface">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(139,92,246,0.35),transparent_60%)]" />
        <div className="absolute left-4 top-4 flex gap-2">
          <Badge tone="accent">{MODE_LABEL[t.type]}</Badge>
          {statusBadge(t)}
        </div>
        {t.isVerified && (
          <div className="absolute right-4 top-4 flex items-center gap-1 text-xs font-semibold text-success">
            <ShieldCheck size={14} /> Verified
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-lg font-bold leading-snug text-fg group-hover:text-accent">
          {t.title}
        </h3>
        <p className="mt-1 flex items-center gap-3 text-xs text-fg-3">
          {t.map && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {t.map}</span>}
          <span>{dateTime(t.startTime)}</span>
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-input bg-white/[4%] px-2 py-2">
            <p className="tabular text-sm font-bold text-reward">{money(t.prizePool)}</p>
            <p className="text-[10px] uppercase tracking-wide text-fg-3">Prize Pool</p>
          </div>
          <div className="rounded-input bg-white/[4%] px-2 py-2">
            <p className="tabular text-sm font-bold text-fg">{money(t.entryFeePerPlayer)}</p>
            <p className="text-[10px] uppercase tracking-wide text-fg-3">Entry / Player</p>
          </div>
          <div className="rounded-input bg-white/[4%] px-2 py-2">
            <p className="tabular text-sm font-bold text-fg">
              {t.registeredSlots}/{t.maxSlots}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-fg-3">Slots</p>
          </div>
        </div>

        {/* Slots progress */}
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-accent" style={{ width: `${fillPct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-fg-3">
            {t.slotsLeft > 0 && t.registrationOpen ? (
              <span className="font-semibold text-warning">Only {t.slotsLeft} slots left</span>
            ) : (
              <span className="inline-flex items-center gap-1"><Users size={12} /> {t.registeredSlots} registered</span>
            )}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <div className="text-xs text-fg-3">
            Starts in{' '}
            <Countdown targetMs={t.startsInMs} className="font-semibold text-fg" />
          </div>
          {t.registrationOpen ? (
            <span className="rounded-input bg-accent px-4 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition group-hover:bg-accent-strong">
              JOIN
            </span>
          ) : (
            <span className="rounded-input border border-line px-4 py-2 text-xs font-semibold text-fg-3">
              {t.status === 'COMPLETED' ? 'Results' : 'Details'}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
