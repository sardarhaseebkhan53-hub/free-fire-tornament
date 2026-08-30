// Shared admin match-table editor (spec §11, §38, §39) — used by both the
// Match Management page and the Results (publish workflow) page.
// Room-style data table + direct result entry + Draft→Review→Confirm→Publish.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useDialog } from '@/lib/use-dialog';
import { Check, Download, Loader2, Lock, Search, ShieldCheck, X } from 'lucide-react';
import { Modal, Pill } from '@/components/admin/kit';
import { deferLoad } from '@/lib/session';
import { api, apiGet, downloadProtectedFile } from '@/lib/client-api';

export interface TableParticipant {
  participantId: string; slot: number | null; playerOrTeam: string; ign: string | null; uid: string | null;
  username: string | null; team: string | null; registrationId: string | null; entryAmount: number | null;
  payment: string; ready: boolean; absent: boolean; status: string; placement: number | null; kills: number | null;
  bonus: number | null; penalty: number | null; points: number | null; finalScore: number | null;
  prize: number | null; slotLocked: boolean; notes: string | null; evidenceUrl: string | null;
}
export interface MatchTableData {
  match: {
    id: string; matchNumber: number; round: number; map: string | null; scheduledAt: string;
    status: string; resultsStatus: string; notes: string | null; roomId: string | null;
    roomPassword: string | null; credentialsReleaseAt: string | null; resultsFinalized: boolean;
    tournament: { id: string; title: string; type: string; maxSlots: number };
  };
  scoring: { pointsPerKill: number; placementTable: number[] };
  rows: TableParticipant[]; totalSeats: number; filled: number;
}

export function MatchTableModal({ matchId, onClose, onChanged, onOpenSlots }: {
  matchId: string; onClose: () => void;
  onChanged: () => void; onOpenSlots: (tournamentId: string) => void;
}) {
  const [data, setData] = useState<MatchTableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [activeRow, setActiveRow] = useState<TableParticipant | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await apiGet<MatchTableData>(`/admin/matches/${matchId}/table`);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }
  const refresh = () => load().then(onChanged);

  // Load the match table whenever this modal is opened for a match id.
  // deferLoad keeps the state update out of the commit phase (same pattern as
  // useAdminList), so the modal mounts with a spinner and then fetches.
  useEffect(() => {
    deferLoad(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Server-side score preview for the editor
  function previewScore(p: TableParticipant, patch: { position?: number; kills?: number; bonus?: number; penalty?: number }) {
    const table = data?.scoring.placementTable ?? [12, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const ppk = Number(data?.scoring.pointsPerKill ?? 1);
    const pos = patch.position ?? p.placement ?? 0;
    const base = pos >= 1 && pos <= table.length ? table[pos - 1]! : 0;
    const kills = Math.max(0, patch.kills ?? p.kills ?? 0) * ppk;
    const bonus = Math.max(0, patch.bonus ?? p.bonus ?? 0);
    const penalty = Math.max(0, patch.penalty ?? p.penalty ?? 0);
    return Math.max(0, base + kills + bonus - penalty);
  }

  const visible = (data?.rows ?? []).filter((r) =>
    !search || `${r.playerOrTeam} ${r.ign ?? ''} ${r.uid ?? ''} ${r.username ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  async function saveRow(p: TableParticipant, patch: Partial<TableParticipant>, save = true): Promise<boolean> {
    setBusy(true);
    try {
      await api(`/admin/matches/${matchId}/results/row`, {
        method: 'POST',
        body: {
          participantId: p.participantId,
          position: patch.placement ?? p.placement,
          kills: patch.kills ?? p.kills,
          bonus: patch.bonus ?? p.bonus,
          penalty: patch.penalty ?? p.penalty,
          prize: patch.prize ?? p.prize,
          notes: patch.notes ?? p.notes,
          status: patch.status ?? p.status,
          absent: patch.absent ?? p.absent,
          ready: patch.ready ?? p.ready,
          evidenceUrl: patch.evidenceUrl ?? p.evidenceUrl,
        },
      });
      setMsg(`Saved result for ${p.playerOrTeam}.`);
      if (save) await refresh(); else await load();
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv() {
    try {
      await downloadProtectedFile(`/matches/${matchId}/export`, `match-${matchId.slice(0, 8)}.csv`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Download failed.');
    }
  }

  async function setWorkflow(next: 'UNDER_REVIEW' | 'CONFIRMED' | 'PUBLISHED' | 'DRAFT') {
    setBusy(true);
    try {
      if (next === 'PUBLISHED' && data?.match.resultsStatus === 'CONFIRMED') {
        await api(`/admin/matches/${matchId}/results/confirm`, { method: 'POST', body: {} });
      }
      await api(`/admin/matches/${matchId}/results/status`, { method: 'POST', body: { status: next } });
      setMsg(next === 'PUBLISHED' ? 'Results published — now public. Winners recorded.' : `Results moved to ${next.replace('_', ' ')}.`);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Workflow change failed');
    } finally {
      setBusy(false);
    }
  }

  const rs = data?.match.resultsStatus ?? 'DRAFT';

  return (
    <Modal title={`Match #${data?.match.matchNumber ?? ''} — ${data?.match.tournament.title ?? '…'}`} onClose={onClose} wide>
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" /></div>
        ) : !data ? (
          <p className="py-10 text-center text-sm text-fg-3">Could not load the match table.</p>
        ) : (
          <>
            {/* Workflow bar */}
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-input border border-line bg-white/[3%] px-3 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-fg-3">Results workflow</span>
              <Pill status={rs} />
              <span className="text-[11px] text-fg-3">{data.filled}/{data.totalSeats} seats · map {data.match.map ?? '—'}</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                {rs === 'DRAFT' && <WorkflowBtn onClick={() => setWorkflow('UNDER_REVIEW')} disabled={busy}>Move to Review</WorkflowBtn>}
                {rs === 'UNDER_REVIEW' && <WorkflowBtn onClick={() => setWorkflow('CONFIRMED')} disabled={busy}>Confirm Results</WorkflowBtn>}
                {rs === 'CONFIRMED' && <WorkflowBtn onClick={() => setWorkflow('PUBLISHED')} disabled={busy} gold>Calculate Prizes & Publish</WorkflowBtn>}
                {rs === 'PUBLISHED' && <span className="flex items-center gap-1 text-xs font-bold text-success"><ShieldCheck size={13} /> Published &amp; locked</span>}
                {rs !== 'DRAFT' && rs !== 'PUBLISHED' && <WorkflowBtn onClick={() => setWorkflow('DRAFT')} disabled={busy}>Back to Draft</WorkflowBtn>}
                <WorkflowBtn onClick={() => onOpenSlots(data.match.tournament.id)}>Slot Board</WorkflowBtn>
                <button onClick={() => void downloadCsv()}
                  className="inline-flex items-center gap-1 rounded-input border border-line px-2.5 py-1.5 text-[11px] font-bold text-fg-2 hover:text-fg">
                  <Download size={12} /> CSV
                </button>
              </div>
            </div>

            {msg && <p className="mb-3 rounded-input border border-success/30 bg-success/10 px-3 py-2 text-xs font-semibold text-success">{msg}</p>}

            <MatchSetupEditor
              matchId={matchId}
              match={data.match}
              open={showSetup}
              onToggle={() => setShowSetup(!showSetup)}
              onSaved={async (m) => {
                setShowSetup(false);
                setMsg('Match setup updated.');
                await load();
                onChanged();
                void m;
              }}
            />

            <div className="mb-3 flex items-center gap-2">
              <Search size={14} className="text-fg-3" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, UID, team…"
                className="w-64 rounded-input border border-line bg-white/[3%] px-3 py-1.5 text-xs text-fg outline-none placeholder:text-fg-3 focus:border-accent" />
              <span className="text-[11px] text-fg-3">Placement table: [{data.scoring.placementTable.join(', ')}] · {data.scoring.pointsPerKill} pts/kill · Score = placement + kills + bonus − penalty</span>
            </div>

            {/* Desktop (≥768px): full-width data table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1080px] text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-fg-3">
                    {['Slot', 'Player/Team', 'FF Name', 'UID', 'Team', 'Payment', 'Ready', 'Pos', 'Kills', 'Bonus', 'Penalty', 'Pts', 'Score', 'Prize', 'Status', 'Actions'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 font-bold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <ResultRowEditor key={p.participantId} p={p} busy={busy} preview={previewScore} onSave={saveRow} />
                  ))}
                  {visible.length === 0 && <tr><td colSpan={16} className="py-8 text-center text-fg-3">No rows match.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Mobile (<768px): cards, actions behind a per-row sheet (spec: cards,
                never horizontal scroll on small screens). */}
            <div className="space-y-2.5 md:hidden">
              {visible.map((p) => (
                <ResultRowCard key={p.participantId} p={p} preview={previewScore} onEdit={() => setActiveRow(p)} />
              ))}
              {visible.length === 0 && <p className="py-8 text-center text-fg-3">No rows match.</p>}
            </div>

            {activeRow && (
              <ResultRowSheet
                p={activeRow}
                busy={busy}
                preview={previewScore}
                onSave={saveRow}
                onClose={() => setActiveRow(null)}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Match setup — room credentials, map, schedule, admin notes (PUT /matches/:id)
// ---------------------------------------------------------------------------
function MatchSetupEditor({ matchId, match, open, onToggle, onSaved }: {
  matchId: string;
  match: MatchTableData['match'];
  open: boolean; onToggle: () => void;
  onSaved: (m: MatchTableData['match']) => void;
}) {
  // The editor form is DERIVED from the match it is editing: an admin edit
  // (`draft`) wins, otherwise we always show the server's current values. This
  // replaces an effect that copied props into state (cascading renders, and a
  // stale form whenever the match refreshed while the panel was open).
  const serverForm = useMemo(() => ({
    // Identity of the server state we derived from — a refresh that actually
    // changes the match invalidates a stale draft.
    key: JSON.stringify([matchId, match.roomId, match.roomPassword, match.notes, match.map, match.scheduledAt]),
    roomId: match.roomId ?? '', roomPassword: match.roomPassword ?? '',
    notes: match.notes ?? '', map: match.map ?? '',
    scheduledAt: match.scheduledAt ? new Date(match.scheduledAt).toISOString().slice(0, 16) : '',
  }), [matchId, match]);
  const [draft, setDraft] = useState<typeof serverForm | null>(null);
  const form = draft && draft.key === serverForm.key ? draft : serverForm;
  const setForm = (next: Omit<typeof serverForm, 'key'> & { key?: string }) =>
    setDraft({ ...next, key: serverForm.key });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/admin/matches/${matchId}`, {
        method: 'PUT',
        body: {
          roomId: form.roomId || null,
          roomPassword: form.roomPassword || null,
          notes: form.notes || null,
          map: form.map || null,
          scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
        },
      });
      onSaved(match);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  const cls = 'w-full rounded-input border border-line bg-white/[3%] px-3 py-2 text-xs text-fg outline-none placeholder:text-fg-3 focus:border-accent [color-scheme:dark]';
  return (
    <div className="mb-3">
      <button onClick={onToggle} className="text-[11px] font-bold text-fg-3 hover:text-fg">
        {open ? '▾ hide' : '▸ match setup —'} map {match.map ?? '—'} · room {match.roomId ?? 'auto'} · creds {match.credentialsReleaseAt ? 'released' : 'locked'}
      </button>
      {open && (
        <div className="mt-2 grid gap-2 rounded-input border border-line bg-white/[3%] p-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Room ID</span>
            <input value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} placeholder="auto" className={cls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Room password</span>
            <input value={form.roomPassword} onChange={(e) => setForm({ ...form, roomPassword: e.target.value })} placeholder="auto" className={cls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Map</span>
            <input value={form.map} onChange={(e) => setForm({ ...form, map: e.target.value })} placeholder="Bermuda" className={cls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Scheduled</span>
            <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} className={cls} />
          </label>
          <label className="block sm:col-span-3">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Admin notes</span>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="visible to staff only" className={cls} />
          </label>
          <button onClick={save} disabled={busy} className="self-end rounded-input bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
            {busy ? 'Saving…' : 'Save setup'}
          </button>
        </div>
      )}
    </div>
  );
}

export function WorkflowBtn({ children, onClick, disabled, gold }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; gold?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded-input px-2.5 py-1.5 text-[11px] font-bold transition disabled:opacity-40 ${gold ? 'bg-reward/20 text-reward hover:bg-reward/30' : 'bg-accent/15 text-accent hover:bg-accent/25'}`}>
      {children}
    </button>
  );
}

export function ResultRowEditor({ p, busy, preview, onSave }: {
  p: TableParticipant; busy: boolean;
  preview: (p: TableParticipant, patch: { position?: number; kills?: number; bonus?: number; penalty?: number }) => number;
  onSave: (p: TableParticipant, patch: Partial<TableParticipant>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Partial<TableParticipant>>({});
  const merged = { ...p, ...draft };
  const score = preview(p, {
    position: draft.placement ?? undefined, kills: draft.kills ?? undefined,
    bonus: draft.bonus ?? undefined, penalty: draft.penalty ?? undefined,
  });

  const set = (k: keyof TableParticipant, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const inputCls = 'w-16 rounded-input border border-line bg-white/[3%] px-1.5 py-1 text-center text-xs text-fg outline-none focus:border-accent [color-scheme:dark]';

  return (
    <tr className="border-b border-line/50 align-middle hover:bg-accent/[3%]">
      <td className="px-2 py-2 font-display font-bold text-fg">
        {p.slot !== null ? String(p.slot).padStart(2, '0') : '··'}
        {p.slotLocked && <Lock size={10} className="ml-1 inline text-warning" />}
      </td>
      <td className="max-w-40 truncate px-2 py-2 font-semibold text-fg">{p.playerOrTeam}</td>
      <td className="max-w-32 truncate px-2 py-2 text-fg-2">{p.ign ?? '—'}</td>
      <td className="tabular px-2 py-2 text-fg-3">{p.uid ?? '—'}</td>
      <td className="px-2 py-2 text-fg-3">{p.team ?? '—'}</td>
      <td className="px-2 py-2"><Pill status={p.payment === 'PAID' ? 'APPROVED' : 'PENDING'} label={p.payment} /></td>
      <td className="px-2 py-2">
        <button onClick={() => onSave(p, { ready: !p.ready })}
          className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${p.ready ? 'bg-success/15 text-success' : 'bg-white/5 text-fg-3'}`}>
          {p.ready ? 'READY' : 'SET'}
        </button>
      </td>
      <td className="px-1 py-2"><input type="number" min={1} value={draft.placement ?? p.placement ?? ''} onChange={(e) => set('placement', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} /></td>
      <td className="px-1 py-2"><input type="number" min={0} value={draft.kills ?? p.kills ?? ''} onChange={(e) => set('kills', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} /></td>
      <td className="px-1 py-2"><input type="number" min={0} value={draft.bonus ?? p.bonus ?? ''} onChange={(e) => set('bonus', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} /></td>
      <td className="px-1 py-2"><input type="number" min={0} value={draft.penalty ?? p.penalty ?? ''} onChange={(e) => set('penalty', e.target.value === '' ? null : Number(e.target.value))} className={`${inputCls} border-danger/30 text-danger`} /></td>
      <td className="tabular px-2 py-2 text-fg-2">{p.points ?? '—'}</td>
      <td className="tabular px-2 py-2 font-bold text-fg">{score ?? '—'}</td>
      <td className="px-1 py-2"><input type="number" min={0} value={draft.prize ?? p.prize ?? ''} onChange={(e) => set('prize', e.target.value === '' ? null : Number(e.target.value))} className={`${inputCls} w-20 text-reward`} /></td>
      <td className="px-2 py-2">
        <select value={merged.status} onChange={(e) => set('status', e.target.value)} className="w-24 rounded-input border border-line bg-white/[3%] px-1 py-1 text-[10px] text-fg-2 [color-scheme:dark]">
          <option value="REGISTERED">REGISTERED</option>
          <option value="PLAYED">PLAYED</option>
          <option value="DISQUALIFIED">DISQUALIFIED</option>
        </select>
        {p.absent && <span className="ml-1 text-[10px] font-bold text-danger">ABSENT</span>}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col gap-1">
          <button disabled={busy} onClick={() => onSave(p, draft)}
            className="flex items-center justify-center gap-1 rounded-input bg-accent px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40">
            <Check size={11} /> Save
          </button>
          <div className="flex gap-1">
            <button disabled={busy} onClick={() => onSave(p, { absent: !p.absent })} className="rounded-input bg-danger/10 px-1.5 py-0.5 text-[9px] font-bold text-danger disabled:opacity-40">
              {p.absent ? 'UNDO ABSENT' : 'ABSENT'}
            </button>
            {merged.status !== 'DISQUALIFIED' ? (
              <button disabled={busy} onClick={() => onSave(p, { status: 'DISQUALIFIED' })} className="rounded-input bg-danger/10 px-1.5 py-0.5 text-[9px] font-bold text-danger disabled:opacity-40">DQ</button>
            ) : (
              <button disabled={busy} onClick={() => onSave(p, { status: 'PLAYED' })} className="rounded-input bg-success/10 px-1.5 py-0.5 text-[9px] font-bold text-success disabled:opacity-40">UNDO</button>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Mobile card + per-row result sheet (spec: cards, not horizontal scroll)
// ---------------------------------------------------------------------------

type PreviewFn = (p: TableParticipant, patch: { position?: number; kills?: number; bonus?: number; penalty?: number }) => number;

/** Shared draft-state hook for the desktop row editor and the mobile sheet. */
function useResultDraft(p: TableParticipant) {
  const [draft, setDraft] = useState<Partial<TableParticipant>>({});
  const merged = { ...p, ...draft };
  const set = (k: keyof TableParticipant, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  return { draft, merged, set };
}

const resultInput = 'w-full rounded-input border border-line bg-white/[3%] px-2 py-2 text-center text-sm text-fg outline-none focus:border-accent [color-scheme:dark]';

/** Collapsed per-row card for <768px — summary of the same fields the desktop
 *  table shows, with the editing actions behind a bottom sheet. */
function ResultRowCard({ p, preview, onEdit }: { p: TableParticipant; preview: PreviewFn; onEdit: () => void }) {
  const score = preview(p, {});
  return (
    <div className="rounded-card border border-line bg-white/[2%] p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-input bg-white/[4%] font-display text-sm font-bold text-fg">
          {p.slot !== null ? String(p.slot).padStart(2, '0') : '··'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{p.playerOrTeam}</p>
          <p className="truncate text-[11px] text-fg-3">
            {p.ign ?? '—'}{p.team ? ` · ${p.team}` : ''} · UID {p.uid ?? '—'} · Reg {p.registrationId ? `#${p.registrationId.slice(-6)}` : '—'}
          </p>
        </div>
        <Pill status={p.payment === 'PAID' ? 'APPROVED' : 'PENDING'} label={p.payment} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-2">
        <span>Score <strong className="tabular text-fg">{score ?? '—'}</strong></span>
        <span>Prize <strong className="tabular text-reward">{p.prize ?? '—'}</strong></span>
        <span className={p.ready ? 'font-bold text-success' : 'text-fg-3'}>{p.ready ? 'READY' : 'NOT READY'}</span>
        <span className="text-fg-3">{p.status}{p.absent ? ' · ABSENT' : ''}</span>
      </div>
      <button
        onClick={onEdit}
        className="mt-2.5 w-full rounded-input border border-line py-1.5 text-[11px] font-bold text-fg-2 transition hover:border-accent hover:text-accent"
      >
        Edit result
      </button>
    </div>
  );
}

/** Bottom sheet with the full result editor for one participant (mobile). */
function ResultRowSheet({ p, busy, preview, onSave, onClose }: {
  p: TableParticipant; busy: boolean; preview: PreviewFn;
  onSave: (p: TableParticipant, patch: Partial<TableParticipant>) => Promise<boolean>;
  onClose: () => void;
}) {
  const { draft, merged, set } = useResultDraft(p);
  const [saving, setSaving] = useState(false);
  const score = preview(p, {
    position: draft.placement ?? undefined,
    kills: draft.kills ?? undefined,
    bonus: draft.bonus ?? undefined,
    penalty: draft.penalty ?? undefined,
  });

  const dialogRef = useDialog<HTMLDivElement>(onClose);

  async function save() {
    setSaving(true);
    const ok = await onSave(p, draft);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit result for ${p.playerOrTeam}`}
        tabIndex={-1}
        className="animate-fade-up max-h-[85vh] w-full overflow-y-auto rounded-t-[20px] border border-line bg-surface p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-base font-bold text-fg">
            {p.slot !== null ? `#${String(p.slot).padStart(2, '0')} ` : ''}{p.playerOrTeam}
          </h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-3 hover:text-fg" aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <p className="mt-1 text-xs text-fg-3">{p.ign ?? '—'}{p.team ? ` · ${p.team}` : ''} · UID {p.uid ?? '—'}</p>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Position</span>
            <input type="number" min={1} value={draft.placement ?? p.placement ?? ''} onChange={(e) => set('placement', e.target.value === '' ? null : Number(e.target.value))} className={resultInput} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Kills</span>
            <input type="number" min={0} value={draft.kills ?? p.kills ?? ''} onChange={(e) => set('kills', e.target.value === '' ? null : Number(e.target.value))} className={resultInput} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Bonus</span>
            <input type="number" min={0} value={draft.bonus ?? p.bonus ?? ''} onChange={(e) => set('bonus', e.target.value === '' ? null : Number(e.target.value))} className={resultInput} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Penalty</span>
            <input type="number" min={0} value={draft.penalty ?? p.penalty ?? ''} onChange={(e) => set('penalty', e.target.value === '' ? null : Number(e.target.value))} className={`${resultInput} border-danger/30 text-danger`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Prize (PKR)</span>
            <input type="number" min={0} value={draft.prize ?? p.prize ?? ''} onChange={(e) => set('prize', e.target.value === '' ? null : Number(e.target.value))} className={`${resultInput} text-reward`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-fg-3">Status</span>
            <select value={merged.status} onChange={(e) => set('status', e.target.value)} className="w-full rounded-input border border-line bg-white/[3%] px-2 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]">
              <option value="REGISTERED">REGISTERED</option>
              <option value="PLAYED">PLAYED</option>
              <option value="DISQUALIFIED">DISQUALIFIED</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => set('ready', !(draft.ready ?? p.ready))}
            className={`rounded-pill px-3 py-1.5 text-[11px] font-bold ${(draft.ready ?? p.ready) ? 'bg-success/15 text-success' : 'bg-white/5 text-fg-3'}`}>
            {(draft.ready ?? p.ready) ? 'READY' : 'MARK READY'}
          </button>
          <button onClick={() => set('absent', !(draft.absent ?? p.absent))}
            className={`rounded-pill px-3 py-1.5 text-[11px] font-bold ${(draft.absent ?? p.absent) ? 'bg-danger/15 text-danger' : 'bg-white/5 text-fg-3'}`}>
            {(draft.absent ?? p.absent) ? 'ABSENT (undo)' : 'MARK ABSENT'}
          </button>
          <span className="ml-auto text-xs text-fg-2">Final score <strong className="tabular text-fg">{score ?? '—'}</strong></span>
        </div>

        <button onClick={save} disabled={busy || saving}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-input bg-accent py-3 text-sm font-bold text-white disabled:opacity-50">
          {(busy || saving) ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save result
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule match (existing behavior + notes)
// ---------------------------------------------------------------------------
