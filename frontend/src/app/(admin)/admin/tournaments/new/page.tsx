'use client';
// Tournament builder wizard — design 29: basics → schedule → pricing → prizes
// (with the live economics calculator + economic-safety gate) → review/publish.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { api, ApiClientError } from '@/lib/client-api';

const STEPS = ['Basics', 'Schedule', 'Pricing', 'Prizes', 'Review'];

interface Prize { kind: 'PLACEMENT' | 'KILL_POOL' | 'MVP'; label: string; amount: string; perKill?: string; cap?: string }

export default function TournamentBuilderPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [type, setType] = useState('SOLO');
  const [map, setMap] = useState('Bermuda');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [deadline, setDeadline] = useState('');
  const [maxSlots, setMaxSlots] = useState('48');
  const [minSlots, setMinSlots] = useState('8');
  const [entryFee, setEntryFee] = useState('50');
  const [pointsPerKill, setPointsPerKill] = useState('1');
  const [numWinners, setNumWinners] = useState('3');
  const [prizes, setPrizes] = useState<Prize[]>([
    { kind: 'PLACEMENT', label: '1st Place', amount: '300' },
    { kind: 'PLACEMENT', label: '2nd Place', amount: '150' },
    { kind: 'PLACEMENT', label: '3rd Place', amount: '80' },
    { kind: 'KILL_POOL', label: 'Kill Pool', amount: '120', perKill: '5', cap: '120' },
    { kind: 'MVP', label: 'MVP', amount: '60' },
  ]);

  const teamSize = type === 'SOLO' ? 1 : type === 'DUO' ? 2 : 4;
  const economics = useMemo(() => {
    const fee = Number(entryFee || 0);
    const slots = Number(maxSlots || 0);
    const collection = fee * slots;
    let placement = 0, kill = 0, mvp = 0, bonus = 0;
    for (const p of prizes) {
      const amt = Number(p.amount || 0);
      if (p.kind === 'PLACEMENT') placement += amt;
      else if (p.kind === 'KILL_POOL') kill += Number(p.cap ?? p.amount ?? 0);
      else if (p.kind === 'MVP') mvp += amt;
      else bonus += amt;
    }
    const rewards = placement + kill + mvp + bonus;
    const profit = collection - rewards;
    return { collection, placement, kill, mvp, bonus, rewards, profit, safe: profit >= 0 };
  }, [entryFee, maxSlots, prizes]);

  function setPrize(i: number, patch: Partial<Prize>) {
    setPrizes((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function valid(n: number): boolean {
    if (n === 0) return title.trim().length >= 4;
    if (n === 1) return startTime !== '' && deadline !== '' && Number(maxSlots) >= 2 && Number(minSlots) >= 2;
    if (n === 2) return Number(entryFee) >= 0 && Number(pointsPerKill) >= 0 && Number(numWinners) >= 1;
    if (n === 3) return prizes.length > 0 && prizes.every((p) => Number(p.amount) >= 0);
    return true;
  }

  async function submit(publish: boolean, confirmLoss = false) {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/tournaments', {
        method: 'POST',
        body: {
          title, type, description, map,
          startTime: new Date(startTime).toISOString(),
          registrationDeadline: new Date(deadline).toISOString(),
          maxSlots: Number(maxSlots), minSlotsToStart: Number(minSlots),
          entryFeePerPlayer: Number(entryFee), pointsPerKill: Number(pointsPerKill),
          numWinners: Number(numWinners),
          prizes: prizes.map((p) => ({
            kind: p.kind, label: p.label, amount: Number(p.amount),
            ...(p.kind === 'KILL_POOL' ? { perKill: Number(p.perKill ?? 0), cap: Number(p.cap ?? p.amount) } : {}),
          })),
          publish, confirmLoss,
        },
      });
      router.push('/admin/tournaments');
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'ECONOMIC_UNSAFE') {
        setError('This configuration projects a platform LOSS. Review your prizes or enable "confirm loss" on the final step.');
      } else {
        setError(e instanceof Error ? e.message : 'Creation failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <AdminPageTitle title="Tournament Builder" sub="Configure basics, schedule, pricing and prizes — economics are checked live." />

      {/* Stepper */}
      <div className="mb-6 flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 items-center gap-1">
            <button
              onClick={() => setStep(i)}
              className={`flex items-center gap-2 rounded-input px-3 py-2 text-xs font-bold transition ${
                i === step ? 'bg-accent text-white' : i < step ? 'text-accent' : 'text-fg-3'
              }`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${i === step ? 'bg-white/20' : i < step ? 'bg-accent/20 text-accent' : 'border border-line'}`}>
                {i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < step ? 'bg-accent/50' : 'bg-line'}`} />}
          </div>
        ))}
      </div>

      <div className="glass rounded-card p-5 sm:p-6">
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <Field label="Tournament title *">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday Night Clash — Solo Showdown #9" className={inputCls} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mode *">
                <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                  <option value="SOLO">Solo</option><option value="DUO">Duo</option>
                  <option value="SQUAD">Squad</option><option value="CLASH_SQUAD">Clash Squad</option>
                </select>
              </Field>
              <Field label="Map">
                <select value={map} onChange={(e) => setMap(e.target.value)} className={inputCls}>
                  <option>Bermuda</option><option>Purgatory</option><option>Kalahari</option><option>Alpine</option><option>NeXTerra</option>
                </select>
              </Field>
            </div>
            <Field label="Description">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} placeholder="What makes this event special?" />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start time *">
                <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Registration deadline *">
                <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={type === 'SOLO' ? 'Player slots *' : 'Team slots *'}>
                <input value={maxSlots} onChange={(e) => setMaxSlots(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} />
              </Field>
              <Field label="Minimum slots to start *">
                <input value={minSlots} onChange={(e) => setMinSlots(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Entry fee / player (PKR) *">
                <input value={entryFee} onChange={(e) => setEntryFee(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} />
              </Field>
              <Field label="Points per kill">
                <input value={pointsPerKill} onChange={(e) => setPointsPerKill(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} />
              </Field>
              <Field label="Winner positions">
                <input value={numWinners} onChange={(e) => setNumWinners(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} />
              </Field>
            </div>
            <div className="rounded-card border border-line bg-base/50 p-4 text-xs text-fg-3">
              Slots are {type === 'SOLO' ? 'players' : `teams of ${teamSize}`}; every player pays the entry fee individually. Collection = fee × slots ={' '}
              <span className="font-bold text-fg">₹{economics.collection.toLocaleString('en-IN')}</span>.
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            {prizes.map((p, i) => (
              <div key={i} className="rounded-card border border-line bg-white/[2%] p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <select value={p.kind} onChange={(e) => setPrize(i, { kind: e.target.value as Prize['kind'] })} className={`${inputCls} w-auto`}>
                    <option value="PLACEMENT">Placement</option>
                    <option value="KILL_POOL">Kill Pool</option>
                    <option value="MVP">MVP</option>
                  </select>
                  <input value={p.label} onChange={(e) => setPrize(i, { label: e.target.value })} placeholder="Label" className={`${inputCls} w-36`} />
                  <input value={p.amount} onChange={(e) => setPrize(i, { amount: e.target.value.replace(/[^\d]/g, '') })} placeholder="Amount ₹" className={`${inputCls} w-28`} />
                  {p.kind === 'KILL_POOL' && (
                    <>
                      <input value={p.perKill ?? ''} onChange={(e) => setPrize(i, { perKill: e.target.value.replace(/[^\d]/g, '') })} placeholder="Per kill ₹" className={`${inputCls} w-28`} />
                      <input value={p.cap ?? ''} onChange={(e) => setPrize(i, { cap: e.target.value.replace(/[^\d]/g, '') })} placeholder="Budget cap ₹" className={`${inputCls} w-32`} />
                    </>
                  )}
                  <button onClick={() => setPrizes((ps) => ps.filter((_, idx) => idx !== i))} className="ml-auto text-xs font-bold text-danger hover:underline">Remove</button>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={() => setPrizes((ps) => [...ps, { kind: 'PLACEMENT', label: `${ps.filter((x) => x.kind === 'PLACEMENT').length + 1}th Place`, amount: '50' }])}
                className="rounded-input border border-line px-3.5 py-2 text-xs font-bold text-fg-2 hover:text-fg">
                + Placement prize
              </button>
            </div>

            {/* Economics calculator — design 29 */}
            <div className="mt-2 rounded-card border border-line bg-base/60 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-fg-3">Profit Calculator</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {[
                  ['Expected collection', economics.collection, 'text-fg'],
                  ['Placement budget', economics.placement, 'text-fg-2'],
                  ['Kill budget (cap)', economics.kill, 'text-fg-2'],
                  ['MVP budget', economics.mvp, 'text-fg-2'],
                  ['Player rewards', economics.rewards, 'text-warning'],
                  ['Estimated profit', economics.profit, economics.safe ? 'text-success' : 'text-danger'],
                ].map(([label, v, tone]) => (
                  <div key={label as string} className="rounded-input bg-white/[3%] px-3 py-2">
                    <p className="text-[10px] text-fg-3">{label}</p>
                    <p className={`tabular font-bold ${tone}`}>₹{Number(v).toLocaleString('en-IN')}</p>
                  </div>
                ))}
              </div>
              {!economics.safe && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-danger">
                  <AlertTriangle size={13} /> Projects a loss — publishing requires explicit confirmation.
                </p>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div className="rounded-card border border-line bg-white/[2%] p-4 text-sm">
              <p className="font-display text-base font-bold text-fg">{title || 'Untitled tournament'}</p>
              <p className="mt-1 text-xs text-fg-3">{type.replace('_', ' ')} · {map} · {maxSlots} slots · entry ₹{Number(entryFee).toLocaleString('en-IN')}</p>
              <p className="mt-2 text-xs text-fg-2">
                {startTime ? new Date(startTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'} → deadline{' '}
                {deadline ? new Date(deadline).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
              </p>
              <p className="mt-2 text-xs text-fg-2">{prizes.length} prizes · rewards ₹{economics.rewards.toLocaleString('en-IN')} · profit ₹{economics.profit.toLocaleString('en-IN')}</p>
            </div>
            {!economics.safe && (
              <label className="flex items-start gap-2.5 rounded-input border border-danger/30 bg-danger/[8%] px-4 py-3 text-xs text-fg-2">
                <input type="checkbox" onChange={(e) => { (e.target as HTMLInputElement).dataset.confirmed = 'true'; }} id="confirm-loss" className="mt-0.5 accent-danger" />
                <span>
                  I understand this configuration projects a <span className="font-bold text-danger">platform loss</span> of{' '}
                  ₹{Math.abs(economics.profit).toLocaleString('en-IN')} and confirm publishing anyway.
                </span>
              </label>
            )}
            {error && <p className="rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
          </div>
        )}

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
            className="rounded-input border border-line px-5 py-2.5 text-sm font-bold text-fg-2 disabled:opacity-40">
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => valid(step) && setStep((s) => s + 1)} disabled={!valid(step)}
              className="rounded-input bg-accent px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40">
              Continue
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => submit(false)} disabled={busy} className="rounded-input border border-line px-5 py-2.5 text-sm font-bold text-fg-2 disabled:opacity-50">
                Save Draft
              </button>
              <button
                onClick={() => {
                  const confirmed = (document.getElementById('confirm-loss') as HTMLInputElement | null)?.dataset.confirmed === 'true';
                  submit(true, confirmed);
                }}
                disabled={busy}
                className="flex items-center gap-2 rounded-input bg-accent px-6 py-2.5 text-sm font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] disabled:opacity-50"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : null} Publish
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-fg-2">{label}</span>
      {children}
    </label>
  );
}
