'use client';
// Tournament edit — same glass styling as the builder. Capacity is recalculated
// live and guarded server-side: it can never drop below the registrations
// already in (the API answers CAPACITY_BELOW_REGISTRATIONS), and the format
// freezes once seats are sold. Registrations are NEVER deleted by an edit.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Loader2, Save } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { api, apiGet, ApiClientError } from '@/lib/client-api';

interface TournamentEdit {
  id: string;
  title: string;
  slug: string;
  type: string;
  description: string | null;
  map: string | null;
  status: string;
  banner: string | null;
  rules: string | null;
  entryFeePerPlayer: number;
  prizePool: number;
  maxSlots: number;
  registeredSlots: number;
  playersPerTeam: number;
  customLabel: string | null;
  minSlotsToStart: number | null;
  numWinners: number;
  refundPercent: number;
  pointsPerKill: number;
  startTime: string;
  registrationDeadline: string;
  capacityUnit: 'players' | 'teams';
  totalPlayerCapacity: number;
  teamMode: boolean;
  confirmedPlayers: number;
  confirmedSeats: number;
}

const MAPS = ['Bermuda', 'Purgatory', 'Kalahari', 'Alpine', 'NeXTerra'];

const inputCls =
  'w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-3">{hint}</span>}
    </label>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminTournamentEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  const [t, setT] = useState<TournamentEdit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Editable fields (strings for controlled inputs).
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [map, setMap] = useState('Bermuda');
  const [customLabel, setCustomLabel] = useState('');
  const [teamCount, setTeamCount] = useState('');
  const [playersPerTeam, setPlayersPerTeam] = useState('4');
  const [entryFee, setEntryFee] = useState('0');
  const [startTime, setStartTime] = useState('');
  const [deadline, setDeadline] = useState('');
  const [rules, setRules] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const data = await apiGet<TournamentEdit>(`/admin/tournaments/${id}`);
    if (!data) {
      setLoadError('Tournament not found.');
      return;
    }
    setT(data);
    setTitle(data.title);
    setDescription(data.description ?? '');
    setMap(data.map ?? 'Bermuda');
    setCustomLabel(data.customLabel ?? '');
    setTeamCount(String(data.maxSlots));
    setPlayersPerTeam(String(data.playersPerTeam));
    setEntryFee(String(data.entryFeePerPlayer));
    setStartTime(toLocalInput(data.startTime));
    setDeadline(toLocalInput(data.registrationDeadline));
    setRules(data.rules ?? '');
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void load();
  }, [id, load]);

  const soloMode = t ? !t.teamMode && t.playersPerTeam <= 1 : true;
  const ppt = Math.max(1, Number(playersPerTeam || 1));
  const seats = Number(teamCount || 0);
  const liveCapacity = soloMode ? seats : seats * ppt;

  const capacityFloor = t ? Math.max(t.confirmedSeats, t.confirmedPlayers > 0 ? 1 : 0) : 0;
  const belowFloor = t !== null && seats < capacityFloor;
  const formatFrozen = (t?.confirmedPlayers ?? 0) > 0;

  const dirty = useMemo(() => t !== null, [t]);

  async function save() {
    if (!t) return;
    setBusy(true);
    setError(null);
    setSaved(false);

    // Local pre-check mirrors the server rule so the admin sees the warning
    // before a round trip: capacity cannot drop below the registrations in.
    if (belowFloor) {
      setError(`Capacity cannot be reduced below the current registration count (${capacityFloor} seats in use). Raise it or remove registrations first.`);
      setBusy(false);
      return;
    }

    const body: Record<string, unknown> = {};
    if (title.trim() !== t.title) body.title = title.trim();
    if (description !== (t.description ?? '')) body.description = description;
    if (map !== (t.map ?? 'Bermuda')) body.map = map;
    if (t.type === 'CUSTOM' && customLabel !== (t.customLabel ?? '')) body.customLabel = customLabel;
    if (Number(teamCount) !== t.maxSlots) body.teamCount = Number(teamCount);
    if (t.type === 'CUSTOM' && Number(playersPerTeam) !== t.playersPerTeam) body.playersPerTeam = Number(playersPerTeam);
    if (Number(entryFee) !== t.entryFeePerPlayer) body.entryFeePerPlayer = Number(entryFee);
    if (rules !== (t.rules ?? '')) body.rules = rules;
    if (startTime) {
      const st = new Date(startTime);
      if (st.getTime() !== new Date(t.startTime).getTime()) body.startTime = st.toISOString();
    }
    if (deadline) {
      const dl = new Date(deadline);
      if (dl.getTime() !== new Date(t.registrationDeadline).getTime()) body.registrationDeadline = dl.toISOString();
    }

    if (Object.keys(body).length === 0) {
      setError('Nothing to save — change a field first.');
      setBusy(false);
      return;
    }

    try {
      await api(`/admin/tournaments/${t.id}`, { method: 'PUT', body });
      setSaved(true);
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'CAPACITY_BELOW_REGISTRATIONS') {
        setError('Capacity cannot be reduced below the current registration count. Existing registrations are protected.');
      } else {
        setError(e instanceof Error ? e.message : 'Save failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="glass rounded-card p-8 text-center text-sm text-fg-2">
        {loadError}{' '}
        <Link href="/admin/tournaments" className="font-bold text-accent hover:underline">Back to tournaments</Link>
      </div>
    );
  }

  if (!t) {
    return <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <AdminPageTitle
        title="Edit Tournament"
        sub={`${t.title} · ${t.status.replace('_', ' ')} · ${t.confirmedPlayers} players registered`}
        action={
          <Link href="/admin/tournaments" className="inline-flex items-center gap-1.5 rounded-input border border-line px-4 py-2.5 text-sm font-bold text-fg-2 hover:text-fg">
            <ArrowLeft size={14} /> Back
          </Link>
        }
      />

      <div className="glass space-y-5 rounded-card p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tournament title *">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Map">
            <select value={map ?? 'Bermuda'} onChange={(e) => setMap(e.target.value)} className={inputCls}>
              {MAPS.map((m) => <option key={m}>{m}</option>)}
              {map && !MAPS.includes(map) && <option>{map}</option>}
            </select>
          </Field>
        </div>

        {t.type === 'CUSTOM' && (
          <Field label="Format label" hint="Shown to players instead of 'Custom'.">
            <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} className={inputCls} placeholder="e.g. 3v3 Zone Clash" />
          </Field>
        )}

        {/* Capacity — the dynamic part */}
        <div className="rounded-card border border-line bg-white/[3%] p-4">
          <p className="font-display text-sm font-bold uppercase tracking-[0.12em] text-fg">Capacity</p>
          <p className="mt-1 text-xs text-fg-3">
            {soloMode
              ? 'This format counts individual player slots: 1 registration = 1 slot.'
              : `This format counts team slots: 1 team registration reserves ${ppt} player positions.`}
            {' '}Registrations already in: <strong className="text-fg">{t.confirmedPlayers} players / {t.confirmedSeats} seats</strong>.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field
              label={soloMode ? 'Total player slots *' : 'Number of teams *'}
              hint={capacityFloor > 0 ? `Cannot go below ${capacityFloor} (current registrations).` : undefined}
            >
              <input
                value={teamCount}
                onChange={(e) => setTeamCount(e.target.value.replace(/[^\d]/g, ''))}
                className={`${inputCls} ${belowFloor ? 'border-danger' : ''}`}
              />
            </Field>
            {t.type === 'CUSTOM' ? (
              <Field
                label="Players per team *"
                hint={formatFrozen ? 'Frozen — registrations exist for this tournament.' : undefined}
              >
                <select
                  value={playersPerTeam}
                  onChange={(e) => setPlayersPerTeam(e.target.value)}
                  disabled={formatFrozen}
                  className={`${inputCls} disabled:opacity-50`}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>{n === 1 ? '1 — individual slots' : `${n} players per team`}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <div className="flex items-end pb-1 text-xs text-fg-3">
                Players per team is fixed by the {t.type.replace('_', ' ').toLowerCase()} format ({t.playersPerTeam}).
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-input bg-white/[4%] px-2 py-2.5">
              <p className="tabular text-lg font-bold text-fg">{liveCapacity || 0}</p>
              <p className="text-[10px] uppercase tracking-wide text-fg-3">Total players</p>
            </div>
            <div className="rounded-input bg-white/[4%] px-2 py-2.5">
              <p className="tabular text-lg font-bold text-fg">{seats || 0}</p>
              <p className="text-[10px] uppercase tracking-wide text-fg-3">{soloMode ? 'Slots' : 'Teams'}</p>
            </div>
            <div className="rounded-input bg-white/[4%] px-2 py-2.5">
              <p className="tabular text-lg font-bold text-fg">{soloMode ? 1 : ppt}</p>
              <p className="text-[10px] uppercase tracking-wide text-fg-3">Players / team</p>
            </div>
          </div>

          {belowFloor && (
            <p className="mt-3 flex items-start gap-2 rounded-input border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs font-semibold text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Capacity cannot be reduced below the current registration count ({capacityFloor} seats in use). Existing registrations are never deleted.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Entry fee / player (PKR)" hint={t.status !== 'DRAFT' && t.status !== 'REGISTRATION_OPEN' ? 'Locked once live.' : undefined}>
            <input
              value={entryFee}
              onChange={(e) => setEntryFee(e.target.value.replace(/[^\d]/g, ''))}
              disabled={t.status !== 'DRAFT' && t.status !== 'REGISTRATION_OPEN'}
              className={`${inputCls} disabled:opacity-50`}
            />
          </Field>
          <Field label="Start time">
            <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Registration deadline">
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} />
        </Field>
        <Field label="Rules">
          <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={3} className={inputCls} />
        </Field>

        {error && <p className="rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
        {saved && !error && <p className="rounded-input border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">Saved — tournament updated.</p>}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-xs text-fg-3">
            Status changes stay on the tournament list page. Edits never delete registrations.
          </p>
          <button
            onClick={() => void save()}
            disabled={busy || !dirty || belowFloor}
            className="inline-flex items-center gap-2 rounded-input bg-accent px-6 py-2.5 text-sm font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
