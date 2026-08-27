'use client';
// Support management — design 35: ticket queue with threads, reply and resolve.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { AuthedImage, Pill, useAdminList } from '@/components/admin/kit';
import { api } from '@/lib/client-api';

interface Ticket {
  id: string; category: string; subject: string; priority: string; status: string;
  createdAt: string; updatedAt: string;
  user: { username: string; email: string };
  messages: Array<{ id: string; body: string; fromStaff: boolean; sender: string; createdAt: string; attachment: string | null }>;
}
interface Page { items: Ticket[]; total: number }

const TABS = [['OPEN','Open'],['IN_PROGRESS','In Progress'],['WAITING_USER','Waiting User'],['RESOLVED','Resolved'],['CLOSED','Closed']] as const;

export default function AdminSupportPage() {
  const [tab, setTab] = useState('OPEN');
  const { data, loading, setData } = useAdminList<Page>(`/admin/tickets?status=${tab}&pageSize=25`, [tab]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(close: boolean) {
    if (!selected || reply.trim().length < 2) return;
    setBusy(true);
    try {
      await api(`/admin/tickets/${selected.id}/reply`, { method: 'POST', body: { body: reply.trim(), close } });
      setReply('');
      const fresh = await fetch(`/api/backend/admin/tickets?status=${tab}&pageSize=25`, { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } }).then((r) => r.json());
      if (fresh.success) {
        setData(fresh.data);
        const again = (fresh.data.items as Ticket[]).find((t) => t.id === selected.id);
        setSelected(again ?? null);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Reply failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <AdminPageTitle title="Support" sub="Player tickets — reply, resolve, keep the arena friendly." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => { setTab(key); setSelected(null); }}
            className={`rounded-input px-4 py-2 text-xs font-bold transition ${tab === key ? 'bg-accent text-white' : 'border border-line bg-white/[2%] text-fg-2 hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="glass max-h-[70vh] overflow-y-auto rounded-card p-3">
            {data?.items.map((t) => (
              <button key={t.id} onClick={() => setSelected(t)}
                className={`mb-2 w-full rounded-card border p-3 text-left transition ${selected?.id === t.id ? 'border-accent bg-accent/[8%]' : 'border-line bg-white/[2%] hover:border-fg-3/40'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold text-fg">{t.subject}</p>
                  <span className="shrink-0 text-[10px] text-fg-3">{new Date(t.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-fg-3">{t.user.username} · {t.category}</p>
                <div className="mt-1.5 flex gap-1.5"><Pill status={t.status} /><Pill status={t.priority} label={t.priority} /></div>
              </button>
            ))}
            {data?.items.length === 0 && <p className="px-1 py-6 text-center text-xs text-fg-3">No {tab.toLowerCase()} tickets.</p>}
          </div>

          <div className="glass rounded-card p-5">
            {!selected ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-fg-3">Select a ticket to read the thread.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-display text-base font-bold text-fg">{selected.subject}</p>
                    <p className="text-xs text-fg-3">{selected.user.username} · {selected.user.email}</p>
                  </div>
                  <Pill status={selected.status} />
                </div>
                <div className="mt-4 flex max-h-80 flex-col gap-2.5 overflow-y-auto pr-1">
                  {selected.messages.map((m) => (
                    <div key={m.id} className={`max-w-[85%] rounded-card px-3.5 py-2.5 text-sm ${m.fromStaff ? 'self-end bg-accent/15 text-fg' : 'self-start border border-line bg-white/[3%] text-fg-2'}`}>
                      <p>{m.body}</p>
                      {m.attachment && (
                        <span className="mt-1 block">
                          <AuthedImage src={`/api/backend${m.attachment}`} alt="Attachment" className="max-h-44 rounded-input border border-line" />
                        </span>
                      )}
                      <p className="mt-1 text-[10px] text-fg-3">{m.sender} · {new Date(m.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                    </div>
                  ))}
                </div>
                {selected.status !== 'RESOLVED' && selected.status !== 'CLOSED' && (
                  <>
                    <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Write a reply…"
                      className="mt-4 w-full resize-none rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent" />
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => send(false)} disabled={busy || reply.trim().length < 2}
                        className="flex-1 rounded-input bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-50">Send reply</button>
                      <button onClick={() => send(true)} disabled={busy || reply.trim().length < 2}
                        className="rounded-input border border-success/40 px-4 py-2.5 text-sm font-bold text-success disabled:opacity-50">Reply & resolve</button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
