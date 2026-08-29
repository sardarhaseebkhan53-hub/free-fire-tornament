'use client';
// Admin — Teams (spec §14). DUO/SQUAD roster management view: members,
// captain, join code, registrations and winnings. Join codes can be rotated
// here (captain-only on the player side, this is the admin audit view).
import { useMemo, useState } from 'react';
import { Copy, Loader2, RefreshCcw, Search, Shield, Users } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Kpi, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api, apiGet } from '@/lib/client-api';

interface Row {
  id: string; name: string; tag: string; type: string; joinCode: string | null;
  captain: string; createdAt: string; members: number; registrations: number; winnings: number;
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

export default function AdminTeamsPage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [rotating, setRotating] = useState<string | null>(null);

  const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (q) qs.set('q', q);
  const { data, loading, setData } = useAdminList<Page>(`/admin/teams?${qs}`, [q, page]);

  const filtered = useMemo(() => (data?.items ?? []).filter((t) => !type || t.type === type), [data, type]);

  async function refresh() {
    const fresh = await apiGet<Page>(`/admin/teams?${qs}`);
    if (fresh) setData(fresh);
  }

  async function rotate(team: Row) {
    // Captain-only endpoint on the player side; admin rotates via the team of
    // the captain. Keep the audit trail clean by using the admin surface.
    if (!window.confirm(`Rotate the join code for ${team.name}? The old code stops working immediately.`)) return;
    setRotating(team.id);
    try {
      await api(`/admin/teams/${team.id}/join-code`, { method: 'POST', body: {} });
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Rotation failed');
    } finally {
      setRotating(null);
    }
  }

  const totalMembers = (data?.items ?? []).reduce((a, t) => a + t.members, 0);
  const totalWinnings = (data?.items ?? []).reduce((a, t) => a + t.winnings, 0);

  return (
    <div>
      <AdminPageTitle
        title="Teams"
        sub="DUO / SQUAD rosters — members, captains, join codes, registrations and prize winnings."
        action={
          <button onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-input border border-line px-4 py-2.5 text-xs font-bold text-fg-2 hover:text-fg">
            <RefreshCcw size={13} /> Refresh
          </button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi label="Teams shown" value={String(data?.total ?? 0)} icon={<Users size={16} />} />
        <Kpi label="Members (page)" value={String(totalMembers)} />
        <Kpi label="Prize winnings (page)" value={String(totalWinnings)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search team name or tag…"
            className="w-64 rounded-input border border-line bg-white/[3%] py-2 pl-9 pr-3 text-sm text-fg-2 outline-none placeholder:text-fg-3 focus:border-accent" />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)}
          className="rounded-input border border-line bg-white/[3%] px-3 py-2 text-sm text-fg-2 outline-none [color-scheme:dark]">
          <option value="">All modes</option>
          <option value="DUO">DUO</option>
          <option value="SQUAD">SQUAD</option>
        </select>
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['Team', 'Mode', 'Captain', 'Members', 'Join Code', 'Registrations', 'Winnings', 'Created']}>
            {filtered.map((t) => (
              <Tr key={t.id}>
                <Td><span className="font-semibold text-fg">{t.name}</span> <span className="ml-1 text-xs text-accent">[{t.tag}]</span></Td>
                <Td><Pill status={t.type} /></Td>
                <Td className="text-xs text-fg-2"><span className="inline-flex items-center gap-1"><Shield size={11} className="text-accent" />{t.captain}</span></Td>
                <Td className="tabular text-xs text-fg-2">{t.members}</Td>
                <Td className="text-xs text-fg-3">
                  <span className="font-mono">{t.joinCode ?? '—'}</span>
                  {t.joinCode && (
                    <>
                      <button onClick={() => void navigator.clipboard.writeText(t.joinCode!)}
                        className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-accent" title="Copy code">
                        <Copy size={10} /> Copy
                      </button>
                      <button onClick={() => void rotate(t)} disabled={rotating === t.id}
                        className="ml-1.5 text-[10px] font-bold text-warning disabled:opacity-40">
                        {rotating === t.id ? '…' : 'Rotate'}
                      </button>
                    </>
                  )}
                </Td>
                <Td className="tabular text-xs text-fg-2">{t.registrations}</Td>
                <Td className="tabular text-xs font-bold text-reward">{t.winnings}</Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(t.createdAt).toLocaleDateString('en-PK')}</Td>
              </Tr>
            ))}
            {filtered.length === 0 && <Tr><Td className="py-8 text-center text-fg-3">No teams yet.</Td></Tr>}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
