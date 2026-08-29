// Tournament details — spec §29 + §68: full financial breakdown, prizes with
// kill pool & MVP info, rules, participants, matches (credentials hidden
// until release — public responses never contain them).
import { notFound } from 'next/navigation';
import { Clock, MapPin, ShieldCheck, Skull, Star, Users } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import type { TournamentDetails } from '@/lib/types';
import { money, MODE_LABEL, STATUS_LABEL, dateTime, displayStatus, slotLabel } from '@/lib/format';
import { Badge, Avatar } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { Countdown, CountdownUntil } from '@/components/countdown';
import { JoinTournament } from '@/components/join-tournament';
import { TournamentImage } from '@/components/tournament-image';
import { AdSlot } from '@/components/ad-slot';
import { JsonLd, breadcrumbJsonLd, eventJsonLd, pageMetadata } from '@/lib/seo';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = await apiServerSafe<TournamentDetails>(`/public/tournaments/${slug}`);
  if (!t) return { title: 'Tournament not found | CLUTCHNEX' };
  return pageMetadata({
    slug: `tournament-${slug}`,
    title: `${t.title} — Prize Pool ${money(t.prizePool)} | Free Fire ${MODE_LABEL[t.type]} | CLUTCHNEX`,
    description:
      t.description?.slice(0, 300) ||
      `Free Fire ${MODE_LABEL[t.type]} tournament: entry ${money(t.entryFeePerPlayer)}, prize pool ${money(t.prizePool)}, ${t.numWinners} winners. Join on CLUTCHNEX — verified prizes, secure room credentials.`,
    path: `/tournaments/${slug}`,
    keywords: `free fire ${MODE_LABEL[t.type].toLowerCase()} tournament, ${t.title}, FF tournament pkr`,
  });
}

export default async function TournamentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await apiServerSafe<TournamentDetails>(`/public/tournaments/${slug}`);
  if (!t) notFound();

  const killPrize = t.prizes.find((p) => p.kind === 'KILL_POOL');
  const mvpPrize = t.prizes.find((p) => p.kind === 'MVP');
  const placement = t.prizes.filter((p) => (p.kind ?? 'PLACEMENT') === 'PLACEMENT');

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {/* Structured data — Event + Breadcrumb (Phase 12) */}
      <JsonLd
        data={[
          eventJsonLd({
            title: t.title, slug: t.slug, description: t.description, startTime: t.startTime,
            type: t.type, entryFee: Number(t.entryFeePerPlayer), prizePool: Number(t.prizePool),
          }),
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Tournaments', path: '/tournaments' },
            { name: t.title, path: `/tournaments/${t.slug}` },
          ]),
        ]}
      />
      {/* Header */}
      <div className="relative overflow-hidden rounded-card border border-line bg-gradient-to-br from-accent/25 via-elevated to-surface p-6 sm:p-10">
        {t.banner && (
          <TournamentImage
            src={t.banner}
            alt={t.title}
            label={t.title}
            className="absolute inset-0 h-full w-full object-cover opacity-40"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-elevated via-elevated/60 to-elevated/30" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_15%,rgba(139,92,246,0.35),transparent_55%)]" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{MODE_LABEL[t.type]}</Badge>
            {(() => {
              const s = displayStatus(t);
              const tone = s === 'LIVE' ? 'danger' : s === 'REGISTRATION_OPEN' ? 'success' : s === 'ALMOST_FULL' ? 'warning' : 'neutral';
              return <Badge tone={tone as 'danger' | 'success' | 'warning' | 'neutral'} live={s === 'LIVE'}>
                {s === 'REGISTRATION_OPEN' ? 'Registration Open' : s === 'ALMOST_FULL' ? 'Almost Full' : s === 'UPCOMING' ? 'Upcoming' : STATUS_LABEL[t.status] ?? s}
              </Badge>;
            })()}
            {t.isVerified && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                <ShieldCheck size={13} /> Verified tournament
              </span>
            )}
          </div>
          <h1 className="mt-4 max-w-2xl font-display text-3xl font-bold leading-tight text-fg sm:text-4xl">
            {t.title}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-4 text-sm text-fg-2">
            {t.map && <span className="inline-flex items-center gap-1.5"><MapPin size={14} /> {t.map}</span>}
            <span className="inline-flex items-center gap-1.5"><Clock size={14} /> {dateTime(t.startTime)}</span>
            <span className="inline-flex items-center gap-1.5"><Users size={14} /> {t.registeredSlots}/{t.maxSlots} {t.type === 'SOLO' ? 'players' : 'teams'}</span>
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            {t.registrationOpen ? (
              <p className="text-sm text-fg-2">
                Registration closes in{' '}
                <CountdownUntil at={t.registrationDeadline} className="font-bold text-warning" />{' '}
                · match starts in <Countdown targetMs={t.startsInMs} className="font-bold text-fg" />
              </p>
            ) : (
              <p className="text-sm font-semibold text-fg-3">
                {t.status === 'COMPLETED' ? 'This tournament has finished — results below.' : 'Registration is closed.'}
              </p>
            )}
          </div>
        </div>
      </div>

      <AdSlot placement="TOURNAMENT_PAGE" className="mt-8" />

      <Reveal><div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Main column */}
        <div className="space-y-8">
          {t.description && <p className="text-sm leading-relaxed text-fg-2">{t.description}</p>}

          {/* Financial transparency — §68 */}
          <section className="glass rounded-card p-6">
            <h2 className="font-display text-lg font-bold text-fg">Transparent Economics</h2>
            <p className="mt-1 text-xs text-fg-3">Exactly where the entry money goes.</p>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-fg-2">Entry fees collected</dt><dd className="tabular font-semibold text-fg">{money(t.prizeBreakdown.entryFeesCollected)}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-2">Prize pool (players)</dt><dd className="tabular font-semibold text-reward">{money(t.prizeBreakdown.prizePool)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2.5"><dt className="text-fg-2">Platform service fee</dt><dd className="tabular font-semibold text-fg">{money(t.prizeBreakdown.platformFee)}</dd></div>
            </dl>
            {killPrize && (
              <p className="mt-4 flex items-center gap-2 rounded-input bg-white/[4%] px-3 py-2.5 text-xs text-fg-2">
                <Skull size={14} className="text-danger" />
                Kill reward: <strong className="text-fg">{money(killPrize.perKill ?? '0')} per kill</strong>
                {killPrize.cap && <> · pool capped at <strong className="text-fg">{money(killPrize.cap)}</strong></>}
              </p>
            )}
            {mvpPrize && (
              <p className="mt-2 flex items-center gap-2 rounded-input bg-white/[4%] px-3 py-2.5 text-xs text-fg-2">
                <Star size={14} className="text-reward" />
                MVP bonus: <strong className="text-fg">{money(mvpPrize.amount)}</strong>
              </p>
            )}
          </section>

          {/* Prizes */}
          <section className="glass rounded-card p-6">
            <h2 className="font-display text-lg font-bold text-fg">Prize Distribution</h2>
            <div className="mt-4 space-y-2">
              {placement.map((p) => (
                <div key={p.position} className="flex items-center justify-between rounded-input bg-white/[4%] px-4 py-3">
                  <span className="flex items-center gap-3 text-sm font-semibold text-fg">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full font-display text-xs font-bold ${
                      p.position === 1 ? 'bg-reward/20 text-reward' : p.position === 2 ? 'bg-fg-2/20 text-fg-2' : 'bg-accent/15 text-accent'
                    }`}>
                      #{p.position}
                    </span>
                    {p.label ?? `Position ${p.position}`}
                  </span>
                  <span className="tabular font-display font-bold text-reward">{money(p.amount)}</span>
                </div>
              ))}
              {killPrize && (
                <div className="flex items-center justify-between rounded-input bg-white/[4%] px-4 py-3">
                  <span className="flex items-center gap-3 text-sm font-semibold text-fg"><Skull size={16} className="text-danger" /> Kill Pool (up to)</span>
                  <span className="tabular font-display font-bold text-reward">{money(killPrize.cap ?? killPrize.amount)}</span>
                </div>
              )}
              {mvpPrize && (
                <div className="flex items-center justify-between rounded-input bg-white/[4%] px-4 py-3">
                  <span className="flex items-center gap-3 text-sm font-semibold text-fg"><Star size={16} className="text-reward" /> MVP</span>
                  <span className="tabular font-display font-bold text-reward">{money(mvpPrize.amount)}</span>
                </div>
              )}
            </div>
          </section>

          {/* Matches */}
          <section className="glass rounded-card p-6">
            <h2 className="font-display text-lg font-bold text-fg">Match Schedule</h2>
            <div className="mt-4 space-y-2.5">
              {t.matches.map((m) => (
                <div key={m.id} className="rounded-input border border-line px-4 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-fg">
                      Match {m.matchNumber} {m.round > 1 ? `· Round ${m.round}` : ''} {m.map ? `· ${m.map}` : ''}
                    </p>
                    <p className="text-xs text-fg-3">{dateTime(m.scheduledAt)}</p>
                  </div>
                  <p className="mt-2 text-xs text-fg-2">
                    {m.credentialsUnlocked ? (
                      <span className="font-semibold text-success">Room details available in My Matches</span>
                    ) : m.credentialsReleaseInMs !== null && m.credentialsReleaseInMs > 0 ? (
                      <>Room details available in <Countdown targetMs={m.credentialsReleaseInMs} className="font-semibold text-warning" /></>
                    ) : (
                      'Room details released before start'
                    )}
                  </p>
                </div>
              ))}
              {t.matches.length === 0 && <p className="text-sm text-fg-3">Schedule is announced after registration.</p>}
            </div>
          </section>

          {/* Participants — seat grid (spec: 48-seat allocation) */}
          <section className="glass rounded-card p-6">
            <h2 className="font-display text-lg font-bold text-fg">Registered {t.type === 'SOLO' ? 'Players' : 'Teams'}</h2>
            <p className="mt-1 text-xs text-fg-3">
              {t.slotsLeft > 0
                ? <>Seats {t.registeredSlots} of {t.maxSlots} occupied · <strong className="text-warning">{t.slotsLeft} remaining</strong></>
                : <>All {t.maxSlots} seats are occupied — tournament is full.</>}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {t.participants.map((p, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-2 rounded-pill border border-line bg-white/[3%] py-1 pl-1 pr-3 text-xs font-semibold text-fg-2"
                  title={p.seatNumber !== null ? `Seat #${p.seatNumber}` : undefined}
                >
                  <span className="flex items-center gap-1.5 rounded-pill bg-base/70 pl-1 pr-0.5">
                    <Avatar name={p.team?.name ?? p.user.username} size={22} />
                    <span className="tabular px-0.5 font-bold text-accent" title={p.seatNumber !== null ? `Seat ${p.seatNumber}` : undefined}>
                      {p.seatNumber !== null ? slotLabel(p.seatNumber) : '··'}
                    </span>
                  </span>
                  {p.team ? `${p.team.name} [${p.team.tag}]` : p.user.username}
                </span>
              ))}
              {t.participants.length === 0 && <p className="text-sm text-fg-3">Be the first to join.</p>}
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <AdSlot placement="SIDEBAR" />
          <div className="glass rounded-card p-5">
            <h3 className="text-xs font-bold tracking-[0.15em] uppercase text-fg-3">Summary</h3>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-fg-2">Entry / player</dt><dd className="tabular font-semibold text-fg">{money(t.entryFeePerPlayer)}</dd></div>
              {t.teamSize > 1 && <div className="flex justify-between"><dt className="text-fg-2">Entry / team ({t.teamSize})</dt><dd className="tabular font-semibold text-fg">{money(t.entryFeePerTeam)}</dd></div>}
              <div className="flex justify-between"><dt className="text-fg-2">Prize pool</dt><dd className="tabular font-semibold text-reward">{money(t.prizePool)}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-2">Seats</dt><dd className="tabular font-semibold text-fg">{t.registeredSlots}/{t.maxSlots}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-2">Remaining</dt><dd className={`tabular font-semibold ${t.slotsLeft > 0 ? 'text-success' : 'text-danger'}`}>{t.slotsLeft > 0 ? t.slotsLeft : 'FULL'}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-2">Winners paid</dt><dd className="tabular font-semibold text-fg">Top {t.numWinners}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-2">Points / kill</dt><dd className="tabular font-semibold text-fg">{t.pointsPerKill}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-2">Refund on cancel</dt><dd className="tabular font-semibold text-success">{Number(t.refundPercent)}%</dd></div>
            </dl>
            <div className="mt-5">
              <JoinTournament
                slug={t.slug}
                type={t.type}
                entryPerPlayer={Number(t.entryFeePerPlayer)}
                entryPerTeam={t.entryFeePerTeam}
                teamSize={t.teamSize}
                registrationOpen={t.registrationOpen}
                slotsLeft={t.slotsLeft}
                maxSlots={t.maxSlots}
                allowIndependentDuo={t.allowIndependentDuo}
                allowIndependentSquad={t.allowIndependentSquad}
              />
            </div>
          </div>

          {t.rules && (
            <div className="glass rounded-card p-5">
              <h3 className="text-xs font-bold tracking-[0.15em] uppercase text-fg-3">Rules</h3>
              <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-fg-2">{t.rules}</p>
            </div>
          )}
        </aside>
      </div></Reveal>
    </div>
  );
}
