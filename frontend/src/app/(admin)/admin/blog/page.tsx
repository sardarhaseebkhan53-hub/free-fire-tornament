'use client';
// Blog CMS — design 36: post list, markdown composer, publish toggle.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Modal, Pager, Pill, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api } from '@/lib/client-api';

interface Row { id: string; title: string; slug: string; category: string; status: string; author: string; createdAt: string }
interface Page { items: Row[]; total: number; page: number; pageSize: number }

export default function AdminBlogPage() {
  const [page, setPage] = useState(1);
  const { data, loading, setData } = useAdminList<Page>(`/admin/blog?page=${page}&pageSize=12`, [page]);
  const [creating, setCreating] = useState(false);

  async function toggle(id: string, publish: boolean) {
    try {
      await api(`/admin/blog/${id}/status`, { method: 'POST', body: { publish } });
      const fresh = await fetch(`/api/backend/admin/blog?page=${page}&pageSize=12`, { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } }).then((r) => r.json());
      if (fresh.success) setData(fresh.data);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Toggle failed');
    }
  }

  return (
    <div>
      <AdminPageTitle title="Blog" sub="News, guides and announcements — markdown, SEO-ready."
        action={<button onClick={() => setCreating(true)} className="rounded-input bg-accent px-4 py-2.5 text-sm font-bold text-white">+ New Post</button>} />

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <>
          <Table head={['Title', 'Category', 'Status', 'Author', 'Created', 'Actions']}>
            {data?.items.map((b) => (
              <Tr key={b.id}>
                <Td>
                  <p className="font-semibold text-fg">{b.title}</p>
                  <p className="text-[11px] text-fg-3">/blog/{b.slug}</p>
                </Td>
                <Td><span className="text-xs text-fg-2">{b.category}</span></Td>
                <Td><Pill status={b.status} /></Td>
                <Td className="text-xs text-fg-2">{b.author}</Td>
                <Td className="whitespace-nowrap text-xs text-fg-3">{new Date(b.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
                <Td>
                  <button onClick={() => toggle(b.id, b.status !== 'PUBLISHED')}
                    className={`rounded-input px-2.5 py-1 text-[11px] font-bold ${b.status === 'PUBLISHED' ? 'border border-warning/40 text-warning' : 'bg-success/15 text-success'}`}>
                    {b.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                  </button>
                </Td>
              </Tr>
            ))}
          </Table>
          {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
        </>
      )}

      {creating && <CreatePost onClose={() => setCreating(false)} onDone={async () => { setCreating(false); const f = await fetch('/api/backend/admin/blog?page=1&pageSize=12', { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } }).then((r) => r.json()); if (f.success) setData(f.data); }} />}
    </div>
  );
}

function CreatePost({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('NEWS');
  const [content, setContent] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(publish: boolean) {
    setBusy(true); setError(null);
    try {
      await api('/admin/blog', { method: 'POST', body: { title, category, content, publish, seoTitle, seoDescription } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Creation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New blog post" onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Post title" className={inputCls} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
          {['TOURNAMENTS','GUIDES','TIPS','NEWS','STRATEGY','ANNOUNCEMENTS'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10} placeholder="Markdown content… (min 20 chars)" className={inputCls} />
        <div className="rounded-card border border-line bg-white/[2%] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-fg-3">SEO (optional — falls back to title/excerpt)</p>
          <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={140} placeholder="SEO title — search-result headline" className={inputCls} />
          <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} rows={2} maxLength={320} placeholder="SEO description — the snippet under the headline in Google" className={`${inputCls} mt-2`} />
        </div>
      </div>
      {error && <p className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={() => submit(false)} disabled={busy} className="flex-1 rounded-input border border-line py-2.5 text-sm font-bold text-fg-2 disabled:opacity-50">Save draft</button>
        <button onClick={() => submit(true)} disabled={busy} className="flex-1 rounded-input bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-50">Publish now</button>
      </div>
    </Modal>
  );
}

const inputCls = 'w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent';
