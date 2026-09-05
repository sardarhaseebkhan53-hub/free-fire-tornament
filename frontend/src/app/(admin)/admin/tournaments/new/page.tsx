'use client';
// Tournament builder wizard — design 29: basics → schedule → pricing → prizes
// (with the live economics calculator + economic-safety gate) → review/publish.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { api, ApiClientError } from '@/lib/client-api';
import { cleanRoomCredential } from '@/lib/room-form';

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
  // The event's own Custom Room, optional at creation. Kept separate from the per-match
  // credentials (which the Matches screen owns) — a lobby the whole event shares, and one
  // that has to be reachable before the first match starts.
  const [roomInput, setRoomInput] = useState({ roomId: '', roomPassword: '', lead: '' });
  const roomTouched = roomInput.roomId.trim() !== '' || roomInput.roomPassword.trim() !== '' || roomInput.lead.trim() !== '';
  // Capacity is dynamic: solo-style modes count PLAYERS here, team modes count
  // TEAMS (total players = teams × players per team). 48 is just one default,
  // never a universal configuration.
  const [maxSlots, setMaxSlots] = useState('48');
  const [playersPerTeamInput, setPlayersPerTeamInput] = useState('4');
  const [customLabel, setCustomLabel] = useState('');
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

  const isSoloMode = ['SOLO', 'LONE_WOLF', 'CLASH_SQUAD_1V1'].includes(type);
  const teamSize = type === 'CUSTOM'
    ? Math.max(1, Number(playersPerTeamInput || 1))
    : type === 'DUO' ? 2 : isSoloMode ? 1 : 4;
  const totalPlayerCapacity = Number(maxSlots || 0) * teamSize;
  const economics = useMemo(() => {
    const fee = Number(entryFee || 0);
    const slots = Number(maxSlots || 0);
    // Entry fee is PER PLAYER — a team slot collects playersPerTeam shares.
    const collection = fee * slots * teamSize;
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
  }, [entryFee, maxSlots, prizes, teamSize]);

  function setPrize(i: number, patch: Partial<Prize>) {
    setPrizes((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function valid(n: number): boolean {
    if (n === 0) return title.trim().length >= 4;
    if (n === 1) {
      const slotsOk = Number(maxSlots) >= 2 && Number(minSlots) >= 2;
      const customOk = type !== 'CUSTOM' || (Number(playersPerTeamInput) >= 1 && Number(playersPerTeamInput) <= 8);
      return startTime !== '' && deadline !== '' && slotsOk && customOk;
    }
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
          // Solo-style formats send total PLAYERS; team formats send the TEAM
          // count (the server folds it into seats and multiplies by players
          // per team for the real capacity).
          ...(isSoloMode ? { maxSlots: Number(maxSlots) } : { teamCount: Number(maxSlots) }),
          ...(type === 'CUSTOM' ? { playersPerTeam: Number(playersPerTeamInput), customLabel: customLabel.trim() } : {}),
          minSlotsToStart: Number(minSlots),
          entryFeePerPlayer: Number(entryFee), pointsPerKill: Number(pointsPerKill),
          numWinners: Number(numWinners),
          prizes: prizes.map((p) => ({
            kind: p.kind, label: p.label, amount: Number(p.amount),
            ...(p.kind === 'KILL_POOL' ? { perKill: Number(p.perKill ?? 0), cap: Number(p.cap ?? p.amount) } : {}),
          })),
          // Only sent when something was typed: an absent `room` means "no row at all",
          // which the room panel then treats as `Room Not Added`.
          ...(roomTouched
            ? {
                room: {
                  roomId: roomInput.roomId.trim(),
                  roomPassword: roomInput.roomPassword.trim(),
                  ...(roomInput.lead.trim() ? { releaseMinutesBeforeStart: Number(roomInput.lead) } : {}),
                },
              }
            : {}),
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
                <select
                  value={type}
                  onChange={(e) => {
                    const v = e.target.value;
                    setType(v);
                    // Sensible per-format capacity defaults — never one fixed number.
                    if (['SOLO', 'LONE_WOLF', 'CLASH_SQUAD_1V1'].includes(v)) setMaxSlots('48');
                    else if (v === 'DUO') setMaxSlots('24');
                    else if (v === 'CUSTOM') { setMaxSlots('12'); setPlayersPerTeamInput('4'); }
                    else setMaxSlots('12');
                  }}
                  className={inputCls}
                >
                  <option value="SOLO">Solo</option>
                  <option value="DUO">Duo</option>
                  <option value="SQUAD">Squad</option>
                  <option value="CLASH_SQUAD">Clash Squad (4v4)</option>
                  <option value="LONE_WOLF">Lone Wolf (1v1)</option>
                  <option value="CLASH_SQUAD_1V1">Clash Squad 1v1</option>
                  <option value="CUSTOM">Custom (set players per team)</option>
                </select>
              </Field>
              <Field label="Map">
                <select value={map} onChange={(e) => setMap(e.target.value)} className={inputCls}>
                  <option>Bermuda</option><option>Purgatory</option><option>Kalahari</option><option>Alpine</option><option>NeXTerra</option>
                </select>
              </Field>
            </div>
            {type === 'CUSTOM' && (
              <Field label="Format label (shown to players)">
                <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} className={inputCls} placeholder='e.g. "3v3 Zone Clash" or "2v2 Rush"' />
              </Field>
            )}
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
              {isSoloMode ? (
                <Field label="Total player slots *">
                  <input value={maxSlots} onChange={(e) => setMaxSlots(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} placeholder="e.g. 48" />
                </Field>
              ) : (
                <Field label={`Number of teams * (${teamSize} players each)`}>
                  <input value={maxSlots} onChange={(e) => setMaxSlots(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} placeholder="e.g. 12" />
                </Field>
              )}
              <Field label="Minimum slots to start *">
                <input value={minSlots} onChange={(e) => setMinSlots(e.target.value.replace(/[^\d]/g, ''))} className={inputCls} />
              </Field>
            </div>

            {type === 'CUSTOM' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Players per team *">
                  <select value={playersPerTeamInput} onChange={(e) => setPlayersPerTeamInput(e.target.value)} className={inputCls}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>{n === 1 ? '1 — individual slots' : `${n} players per team`}</option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-end pb-1 text-xs text-fg-3">
                  Capacity = players per team × number of teams — updated live below.
                </div>
              </div>
            )}

            {/* Live slot preview — recalculates on every keystroke */}
            <div className="rounded-card border border-accent/25 bg-accent/[6%] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">Slot Preview</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-input bg-white/[4%] px-2 py-2.5">
                  <p className="tabular text-lg font-bold text-fg">{totalPlayerCapacity || 0}</p>
                  <p className="text-[10px] uppercase tracking-wide text-fg-3">Total players</p>
                </div>
                <div className="rounded-input bg-white/[4%] px-2 py-2.5">
                  <p className="tabular text-lg font-bold text-fg">{isSoloMode ? (Number(maxSlots || 0) || 0) : (Number(maxSlots || 0) || 0)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-fg-3">{isSoloMode ? 'Individual slots' : 'Teams'}</p>
                </div>
                <div className="rounded-input bg-white/[4%] px-2 py-2.5">
                  <p className="tabular text-lg font-bold text-fg">{teamSize}</p>
                  <p className="text-[10px] uppercase tracking-wide text-fg-3">Players / team</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-fg-2">
                {isSoloMode
                  ? <>1 registration = <strong className="text-fg">1 player slot</strong>. {totalPlayerCapacity || 0} individual players can register.</>
                  : <>1 team registration reserves <strong className="text-fg">{teamSize} player positions</strong>. {Number(maxSlots || 0) || 0} teams × {teamSize} = <strong className="text-fg">{totalPlayerCapacity || 0} players</strong> total.</>}
              </p>
            </div>

            <div className="rounded-card border border-line bg-white/[3%] p-4">
              <p className="font-display text-sm font-bold uppercase tracking-[0.12em] text-fg">Custom room (optional)</p>
              <p className="mt-1 text-xs text-fg-2">
                Leave it empty and add the room later from the tournament list — players see <strong>Room Not Added</strong> until you do.
                Anything you enter here stays hidden from every player until{' '}
                <strong>a few minutes before the start time</strong> (5 by default; the number below overrides it for this event only).
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <Field label="Room ID (numbers only)">
                  <input value={roomInput.roomId} onChange={(e) => setRoomInput({ ...roomInput, roomId: cleanRoomCredential(e.target.value, 20) })} inputMode="numeric" autoComplete="off" className={inputCls} placeholder="123456789" />
                </Field>
                <Field label="Room password (numbers only)">
                  <input value={roomInput.roomPassword} onChange={(e) => setRoomInput({ ...roomInput, roomPassword: cleanRoomCredential(e.target.value, 30) })} inputMode="numeric" autoComplete="off" className={inputCls} placeholder="123456" />
                </Field>
                <Field label="Minutes before start">
                  <input value={roomInput.lead} onChange={(e) => setRoomInput({ ...roomInput, lead: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" className={inputCls} placeholder="5" />
                </Field>
              </div>
              {roomInput.roomPassword.trim() !== '' && roomInput.roomId.trim() === '' ? (
                <p className="mt-2 text-xs font-semibold text-warning">A password with no Room ID cannot be saved — players need both to get in.</p>
              ) : null}
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
              Slots are {isSoloMode ? 'individual players' : `teams of ${teamSize}`}; every player pays the entry fee individually. Collection = fee × {isSoloMode ? 'slots' : `teams × ${teamSize} players`} ={' '}
              <span className="font-bold text-fg">PKR {economics.collection.toLocaleString('en-PK')}</span>.
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
                  <input value={p.amount} onChange={(e) => setPrize(i, { amount: e.target.value.replace(/[^\d]/g, '') })} placeholder="Amount PKR " className={`${inputCls} w-28`} />
                  {p.kind === 'KILL_POOL' && (
                    <>
                      <input value={p.perKill ?? ''} onChange={(e) => setPrize(i, { perKill: e.target.value.replace(/[^\d]/g, '') })} placeholder="Per kill PKR " className={`${inputCls} w-28`} />
                      <input value={p.cap ?? ''} onChange={(e) => setPrize(i, { cap: e.target.value.replace(/[^\d]/g, '') })} placeholder="Budget cap PKR " className={`${inputCls} w-32`} />
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
              <p className="mt-1 text-[10px] leading-relaxed text-fg-3">
                Collection − player rewards = <span className="font-bold text-fg-2">platform gross</span>. Net profit is
                estimated later, after payment costs, refunds, bonuses, referral costs, operating costs and taxes.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {[
                  ['Expected collection', economics.collection, 'text-fg'],
                  ['Placement budget', economics.placement, 'text-fg-2'],
                  ['Kill budget (cap)', economics.kill, 'text-fg-2'],
                  ['MVP budget', economics.mvp, 'text-fg-2'],
                  ['Player rewards', economics.rewards, 'text-warning'],
                  ['Est. platform gross', economics.profit, economics.safe ? 'text-success' : 'text-danger'],
                ].map(([label, v, tone]) => (
                  <div key={label as string} className="rounded-input bg-white/[3%] px-3 py-2">
                    <p className="text-[10px] text-fg-3">{label}</p>
                    <p className={`tabular font-bold ${tone}`}>PKR {Number(v).toLocaleString('en-PK')}</p>
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
              <p className="mt-1 text-xs text-fg-3">
                {type === 'CUSTOM' ? (customLabel.trim() || 'Custom') : type.replace('_', ' ')} · {map} ·{' '}
                {isSoloMode ? `${maxSlots} player slots` : `${maxSlots} teams × ${teamSize} players = ${totalPlayerCapacity} players`} · entry PKR {Number(entryFee).toLocaleString('en-PK')}
              </p>
              <p className="mt-2 text-xs text-fg-2">
                {startTime ? new Date(startTime).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—'} → deadline{' '}
                {deadline ? new Date(deadline).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
              </p>
              <p className="mt-2 text-xs text-fg-2">{prizes.length} prizes · rewards PKR {economics.rewards.toLocaleString('en-PK')} · platform gross PKR {economics.profit.toLocaleString('en-PK')}</p>
            </div>
            {!economics.safe && (
              <label className="flex items-start gap-2.5 rounded-input border border-danger/30 bg-danger/[8%] px-4 py-3 text-xs text-fg-2">
                <input type="checkbox" onChange={(e) => { (e.target as HTMLInputElement).dataset.confirmed = 'true'; }} id="confirm-loss" className="mt-0.5 accent-danger" />
                <span>
                  I understand this configuration projects a <span className="font-bold text-danger">platform loss</span> of{' '}
                  PKR {Math.abs(economics.profit).toLocaleString('en-PK')} and confirm publishing anyway.
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
