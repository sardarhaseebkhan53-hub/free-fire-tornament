'use client';
// =============================================================================
// Admin — SLOT CONTROL (spec §12, §37)
//   Visual 1..maxSlots board. Per slot: assign/move, clear (remove), lock/
//   unlock with note, mark ready, and per-match ready/absent/DQ. Every action
//   goes through the audited admin endpoints (SLOT_* audit trail server-side).
// =============================================================================
import { useEffect, useState } from 'react';
import { Loader2, Lock, LockOpen, MapPin, RefreshCcw, UserX, X, CheckCircle2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Modal, Pill, useAdminList } from '@/components/admin/kit';
import { api, apiGet, authedFetch } from '@/lib/client-api';

interface SlotMatch {
  participantId: string; id: string; matchNumber: number; status: string;
  placement: number | null; kills: number | null; finalScore: number | null;
  ready: boolean; absent: boolean; participantStatus: string; notes: string | null;
}
interface SlotEntry {
  slot: number; registrationId: string | null; player: string | null; ign: string | null;
  uid: string | null; username: string | null; team: string | null; status: string | null;
  payment: string | null; entryAmount: number | null; locked: boolean; note: string | null;
  matchCount: number; matches: SlotMatch[];
}
interface Board {
  tournament: { id: string; title: string; type: string; maxSlots: number; registeredSlots: number; status: string };
  slots: SlotEntry[]; occupied: number;
}
interface TList { items: Array<{ id: string; title: string }> }

type Mode = { kind: 'move' | 'clear' | 'lock' | 'ready'; regId: string; player: string; slot: number } | null;

export default function AdminSlotsPage() {
  const [tourId, setTourId] = useState('');
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyReg, setBusyReg] = useState<string | null>(null);
  const [action, setAction] = useState<Mode>(null);
  const [history, setHistory] = useState(false);
  const tours = useAdminList<TList>('/admin/tournaments?pageSize=50');

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tournament');
    if (t) setTourId(t);
  }, []);

  async function load(tid = tourId) {
    if (!tid) { setBoard(null); setLoading(false); return; }
    setLoading(true);
    const d = await apiGet<Board>(`/admin/tournaments/${tid}/slots`);
    setBoard(d);
    setLoading(false);
  }
  useEffect(() => { void load(tourId); }, [tourId]);

  async function toggleLock(entry: SlotEntry) {
    if (!entry.registrationId) return;
    setBusyReg(entry.registrationId);
    try {
      await api(`/admin/slots/${entry.registrationId}/lock`, {
        method: 'POST',
        body: { locked: !entry.locked, note: '' },
      });
      setMsg(entry.locked ? `Slot ${String(entry.slot).padStart(2, '0')} unlocked.` : `Slot ${String(entry.slot).padStart(2, '0')} locked.`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Lock change failed');
    } finally {
      setBusyReg(null);
    }
  }

  async function partState(regId: string, m: SlotMatch, patch: { ready?: boolean; absent?: boolean; status?: 'DISQUALIFIED' | 'PLAYED' }) {
    setBusyReg(regId);
    try {
      await api(`/admin/matches/${m.id}/participants/${m.participantId}/state`, { method: 'POST', body: patch });
      setMsg(`Match #${m.matchNumber} updated for ${m.participantStatus === 'DISQUALIFIED' ? 'DQ' : 'state'} — board refreshed.`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyReg(null);
    }
  }

  const occupied = board?.occupied ?? 0;
  const maxSlots = board?.tournament.maxSlots ?? 0;
  const lockedCount = board?.slots.filter((s) => s.locked).length ?? 0;

  return (
    <div>
      <AdminPageTitle
        title="Slot Control"
        sub="Assign, move, remove, lock and mark players ready / absent / DQ — every change is audited."
        action={
          <button onClick={async () => { setMsg(null); await load(); }} className="inline-flex items-center gap-1.5 rounded-input border border-line px-4 py-2.5 text-xs font-bold text-fg-2 hover:text-fg">
            <RefreshCcw size={13} /> Refresh board
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={tourId} onChange={(e) => setTourId(e.target.value)}
          className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]">
          <option value="">Select a tournament…</option>
          {tours.data?.items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        {board && (
          <>
            <span className="rounded-pill bg-accent/10 px-3 py-1 text-xs font-bold text-accent">{occupied}/{maxSlots} seats</span>
            <span className="rounded-pill bg-warning/10 px-3 py-1 text-xs font-bold text-warning">{lockedCount} locked</span>
            <span className="text-xs text-fg-3">{board.tournament.type} · {board.tournament.status}</span>
            <button onClick={() => setHistory(!history)} className="text-xs font-bold text-fg-3 hover:text-fg">
              {history ? '▾ hide match history' : '▸ show match history'}
            </button>
          </>
        )}
      </div>

      {msg && <p className="mb-4 rounded-input border border-success/30 bg-success/10 px-3 py-2 text-xs font-semibold text-success">{msg}</p>}

      {!tourId ? (
        <p className="glass rounded-card p-10 text-center text-sm text-fg-2">Pick a tournament to open its slot board.</p>
      ) : loading && !board ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : !board ? (
        <p className="glass rounded-card p-10 text-center text-sm text-fg-2">Could not load the slot board.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {board.slots.map((s) => {
            const filled = s.registrationId !== null;
            const busy = busyReg === s.registrationId;
            return (
              <div key={s.slot}
                className={`rounded-card border p-4 transition ${filled ? 'border-line bg-white/[3%]' : 'border-dashed border-line/60 bg-transparent'} ${s.locked ? 'ring-1 ring-warning/40' : ''}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-display text-lg font-bold text-fg">{String(s.slot).padStart(2, '0')}</span>
                  <div className="flex items-center gap-1.5">
                    {s.locked ? <Lock size={12} className="text-warning" /> : <LockOpen size={12} className="text-fg-3" />}
                    {filled && <Pill status={s.status ?? 'CONFIRMED'} />}
                  </div>
                </div>

                {filled ? (
                  <>
                    <p className="truncate text-sm font-bold text-fg">{s.player}</p>
                    <p className="truncate text-xs text-fg-3">{s.ign}{s.team ? ` · ${s.team}` : ''} · UID {s.uid ?? '—'}</p>
                    <p className="mt-1 text-[11px] text-fg-3">{s.username} · {s.payment} · {s.entryAmount ?? '—'} PKR</p>
                    {s.note && <p className="mt-1 truncate text-[11px] italic text-warning">“{s.note}”</p>}

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Chip onClick={() => setAction({ kind: 'move', regId: s.registrationId!, player: s.player!, slot: s.slot })} busy={busy}><MapPin size={11} /> Move</Chip>
                      <Chip onClick={() => setAction({ kind: 'clear', regId: s.registrationId!, player: s.player!, slot: s.slot })} busy={busy} danger><UserX size={11} /> Remove</Chip>
                      <Chip onClick={() => void toggleLock(s)} busy={busy}>{s.locked ? 'Unlock' : 'Lock'}</Chip>
                      <Chip onClick={() => setAction({ kind: 'ready', regId: s.registrationId!, player: s.player!, slot: s.slot })} busy={busy}><CheckCircle2 size={11} /> Ready</Chip>
                    </div>

                    {history && s.matches.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-line/60 pt-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-fg-3">Match history ({s.matchCount})</p>
                        {s.matches.map((m) => (
                          <div key={m.participantId} className="rounded-input border border-line/60 px-2 py-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-fg-2">M#{m.matchNumber}</span>
                              <span className="text-[10px] text-fg-3">{m.status} · {m.placement ?? '—'}th · {m.kills ?? 0} kills · {m.finalScore ?? 0} pts</span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {!m.ready && <MiniChip onClick={() => void partState(s.registrationId!, m, { ready: true })}>Mark ready</MiniChip>}
                              {m.ready && <span className="text-[10px] font-bold text-success">READY</span>}
                              {!m.absent && <MiniChip onClick={() => void partState(s.registrationId!, m, { absent: true })} danger>Absent</MiniChip>}
                              {m.absent && <span className="text-[10px] font-bold text-danger">ABSENT</span>}
                              {m.participantStatus !== 'DISQUALIFIED'
                                ? <MiniChip onClick={() => void partState(s.registrationId!, m, { status: 'DISQUALIFIED' })} danger>DQ</MiniChip>
                                : <MiniChip onClick={() => void partState(s.registrationId!, m, { status: 'PLAYED' })}>Undo DQ</MiniChip>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="py-3 text-center text-xs text-fg-3">Empty — next auto-assign fills this seat.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {action && (
        <SlotActionModal
          action={action}
          maxSlots={maxSlots}
          onClose={() => setAction(null)}
          onDone={async () => { setAction(null); await load(); }}
        />
      )}
    </div>
  );
}

function Chip({ children, onClick, busy, danger }: { children: React.ReactNode; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className={`inline-flex items-center gap-1 rounded-input border px-2 py-1 text-[10px] font-bold transition disabled:opacity-40 ${danger ? 'border-danger/30 text-danger hover:bg-danger/10' : 'border-line text-fg-2 hover:border-accent hover:text-accent'}`}>
      {children}
    </button>
  );
}

function MiniChip({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`rounded-pill px-1.5 py-0.5 text-[9px] font-bold ${danger ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}>
      {children}
    </button>
  );
}

function SlotActionModal({ action, maxSlots, onClose, onDone }: {
  action: NonNullable<Mode>; maxSlots: number; onClose: () => void; onDone: () => void;
}) {
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titles: Record<NonNullable<Mode>['kind'], string> = {
    move: `Move ${action.player}`,
    clear: `Remove ${action.player} from slot ${String(action.slot).padStart(2, '0')}`,
    lock: `Lock slot ${String(action.slot).padStart(2, '0')}`,
    ready: `Mark ready — ${action.player}`,
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (action.kind === 'move') {
        await api(`/admin/slots/${action.regId}/assign`, {
          method: 'POST', body: { slot: Number(target), reason },
        });
      } else if (action.kind === 'clear') {
        await api(`/admin/slots/${action.regId}/clear`, { method: 'POST', body: { reason } });
      } else if (action.kind === 'lock') {
        await api(`/admin/slots/${action.regId}/lock`, { method: 'POST', body: { locked: true, note: reason } });
      } else {
        await api(`/admin/slots/${action.regId}/ready`, { method: 'POST', body: { ready: true, note: reason } });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  const promptLabel = action.kind === 'move' ? 'Reason (optional)' : action.kind === 'clear' ? 'Reason *' : action.kind === 'lock' ? 'Lock note' : 'Note (optional)';

  return (
    <Modal title={titles[action.kind]} onClose={onClose}>
      <div className="space-y-3">
        {action.kind === 'move' ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-fg-2">Target slot *</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none [color-scheme:dark]">
              <option value="">Select…</option>
              {Array.from({ length: maxSlots }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n} disabled={n === action.slot}>Slot {String(n).padStart(2, '0')}{n === action.slot ? ' (current)' : ''}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-fg-3">Occupied targets are refused server-side — move or remove the current holder first.</p>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-fg-2">{promptLabel}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={action.kind === 'clear' ? 'e.g. withdrew before start' : 'optional'} className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent" />
          </label>
        )}
        {error && <p className="rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <button onClick={submit} disabled={busy || (action.kind === 'move' && !target) || (action.kind === 'clear' && !reason.trim())}
          className="flex w-full items-center justify-center gap-2 rounded-input bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} {action.kind === 'move' ? 'Move player' : action.kind === 'clear' ? 'Remove from slot' : action.kind === 'lock' ? 'Lock slot' : 'Mark ready'}
        </button>
      </div>
    </Modal>
  );
}
