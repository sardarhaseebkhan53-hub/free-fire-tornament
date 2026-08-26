'use client';
// Join tournament flow — talks to the race-safe join engine.
// Solo: direct join (+ optional coupon). Team modes: captain team picker is
// delivered with the Teams module (Phase 6); until then the message is honest.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { money } from '@/lib/format';

const FRIENDLY: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'Not enough cash balance. Add money to your wallet first.',
  TOURNAMENT_FULL: 'This tournament just filled up.',
  TOURNAMENT_CLOSED: 'Registration is closed for this tournament.',
  ALREADY_REGISTERED: 'You are already registered for this tournament.',
  VALIDATION_ERROR: 'Please check your input and try again.',
};

export function JoinTournament({
  slug, type, entryPerPlayer, entryPerTeam, teamSize, registrationOpen,
}: {
  slug: string; type: string; entryPerPlayer: number; entryPerTeam: number;
  teamSize: number; registrationOpen: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<'idle' | 'confirm' | 'busy' | 'done'>('idle');
  const [coupon, setCoupon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ totalPaid: number; balance: string | null } | null>(null);

  if (!registrationOpen) return null;

  function start() {
    const token = localStorage.getItem('cn_access');
    if (!token) {
      router.push(`/login?next=/tournaments/${slug}`);
      return;
    }
    setError(null);
    setStage('confirm');
  }

  async function confirm() {
    const token = localStorage.getItem('cn_access');
    if (!token) return router.push(`/login?next=/tournaments/${slug}`);
    setStage('busy');
    setError(null);
    try {
      const res = await fetch('/api/backend/tournaments/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ tournamentSlug: slug, couponCode: coupon || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        setReceipt({ totalPaid: json.data.totalPaid, balance: json.data.cashBalanceAfter });
        setStage('done');
      } else {
        setError(FRIENDLY[json.code] ?? json.message ?? 'Could not join right now.');
        setStage('confirm');
      }
    } catch {
      setError('Could not reach the server. Please try again.');
      setStage('confirm');
    }
  }

  if (stage === 'done' && receipt) {
    return (
      <div className="rounded-input border border-success/30 bg-success/10 px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-bold text-success">
          <ShieldCheck size={16} /> You are in! Entry of {money(receipt.totalPaid)} confirmed.
        </p>
        <p className="mt-1 text-xs text-fg-2">
          Room details unlock 30 minutes before start{receipt.balance ? ` · cash balance now ${money(receipt.balance)}` : ''}.
        </p>
      </div>
    );
  }

  if (stage === 'confirm' || stage === 'busy') {
    return (
      <div className="glass rounded-card p-5">
        <h3 className="font-display text-base font-bold text-fg">Confirm Entry</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-fg-2">Entry fee{teamSize > 1 ? ' (per player)' : ''}</dt><dd className="tabular font-semibold text-fg">{money(entryPerPlayer)}</dd></div>
          {teamSize > 1 && <div className="flex justify-between"><dt className="text-fg-2">Team total ({teamSize} players)</dt><dd className="tabular font-semibold text-fg">{money(entryPerTeam)}</dd></div>}
        </dl>
        {teamSize === 1 ? (
          <>
            <input
              value={coupon}
              onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              placeholder="Coupon code (optional)"
              className="mt-3 w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
              aria-label="Coupon code"
            />
            {error && <p role="alert" className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs font-medium text-danger">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                onClick={confirm}
                disabled={stage === 'busy'}
                className="flex flex-1 items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white transition hover:bg-accent-strong disabled:opacity-60"
              >
                {stage === 'busy' && <Loader2 size={15} className="animate-spin" />}
                Pay {money(entryPerPlayer)} &amp; Join
              </button>
              <button onClick={() => setStage('idle')} disabled={stage === 'busy'} className="rounded-input border border-line px-4 text-sm font-semibold text-fg-2 hover:text-fg">
                Back
              </button>
            </div>
          </>
        ) : (
          <div className="mt-3 rounded-input border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
            Squad &amp; duo registration is opened by the team captain from the Teams page — that module ships in the
            next update. Your spot cannot be double-booked either way.
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={start}
      className="w-full rounded-input bg-accent px-8 py-3.5 text-sm font-bold text-white shadow-[0_0_28px_rgba(139,92,246,0.45)] transition hover:bg-accent-strong"
    >
      JOIN TOURNAMENT — {money(teamSize > 1 ? entryPerTeam : entryPerPlayer)}
    </button>
  );
}
