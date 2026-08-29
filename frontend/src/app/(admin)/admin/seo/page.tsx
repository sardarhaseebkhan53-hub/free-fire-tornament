'use client';
// SEO management — design 38: per-page overrides for titles, descriptions, canonicals.
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api , apiGet } from '@/lib/client-api';

interface Row { id: string; pageSlug: string; title: string | null; description: string | null; canonicalUrl: string | null; keywords: string | null }

export default function AdminSeoPage() {
  const { data, loading, setData } = useAdminList<Row[]>('/admin/seo');
  const [editing, setEditing] = useState<Partial<Row> | null>(null);

  const PAGES = ['home', 'tournaments', 'leaderboard', 'winners', 'blog', 'support', 'login', 'register'];

  return (
    <div>
      <AdminPageTitle title="SEO Management" sub="Per-page metadata overrides — titles, descriptions, canonicals and keywords."
        action={<button onClick={() => setEditing({ pageSlug: 'home' })} className="inline-flex items-center gap-1.5 rounded-input bg-accent px-4 py-2.5 text-sm font-bold text-white"><Plus size={15} /> Add page</button>} />

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <Table head={['Page', 'Title', 'Description', 'Canonical', 'Actions']}>
          {data?.map((r) => (
            <Tr key={r.id}>
              <Td className="font-semibold text-fg">/{r.pageSlug}</Td>
              <Td className="max-w-56 truncate text-xs text-fg-2">{r.title ?? '—'}</Td>
              <Td className="max-w-64 truncate text-xs text-fg-3">{r.description ?? '—'}</Td>
              <Td className="max-w-40 truncate text-xs text-fg-3">{r.canonicalUrl ?? '—'}</Td>
              <Td><button onClick={() => setEditing(r)} className="rounded-input border border-line px-2.5 py-1 text-[11px] font-bold text-fg-2 hover:text-accent">Edit</button></Td>
            </Tr>
          ))}
          {data?.length === 0 && <Tr><Td className="py-8 text-center text-fg-3">No overrides — pages use their defaults.</Td></Tr>}
        </Table>
      )}

      {editing && <EditModal row={editing} pages={PAGES} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); const f = await apiGet<Row[]>(`/api/backend/admin/seo`); if (f) setData(f); }} />}
    </div>
  );
}

function EditModal({ row, pages, onClose, onDone }: { row: Partial<Row>; pages: string[]; onClose: () => void; onDone: () => void }) {
  const [pageSlug, setPageSlug] = useState(row.pageSlug ?? 'home');
  const [title, setTitle] = useState(row.title ?? '');
  const [description, setDescription] = useState(row.description ?? '');
  const [canonicalUrl, setCanonical] = useState(row.canonicalUrl ?? '');
  const [keywords, setKeywords] = useState(row.keywords ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api('/admin/seo', { method: 'POST', body: { pageSlug, title, description, canonicalUrl, keywords } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-[20px] border border-line bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold text-fg">SEO — /{row.pageSlug}</h2>
        <div className="mt-4 flex flex-col gap-3">
          <select value={pageSlug} onChange={(e) => setPageSlug(e.target.value)} className={inputCls}>
            {pages.map((p) => <option key={p}>{p}</option>)}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meta title" className={inputCls} />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Meta description" className={inputCls} />
          <input value={canonicalUrl} onChange={(e) => setCanonical(e.target.value)} placeholder="Canonical URL (optional)" className={inputCls} />
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Keywords (comma separated)" className={inputCls} />
        </div>
        {error && <p className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
        <button onClick={submit} disabled={busy} className="mt-4 w-full rounded-input bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-50">Save SEO settings</button>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent';
