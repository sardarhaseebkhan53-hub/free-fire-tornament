'use client';
// System settings — design 39: every admin-configurable value, edited + audited.
import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { useAdminList } from '@/components/admin/kit';
import { api } from '@/lib/client-api';

interface Row { key: string; value: unknown; description: string | null; updatedAt: string }

export default function AdminSettingsPage() {
  const { data, loading, setData } = useAdminList<Row[]>('/admin/settings');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function save(key: string) {
    setBusy(key);
    try {
      let value: unknown = draft;
      if (/^(\d+|true|false)$/.test(draft.trim())) {
        value = draft.trim() === 'true' ? true : draft.trim() === 'false' ? false : Number(draft);
      }
      await api('/admin/settings', { method: 'POST', body: { key, value } });
      setEditing(null);
      setSaved(key);
      const fresh = await fetch('/api/backend/admin/settings', { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } }).then((r) => r.json());
      if (fresh.success) setData(fresh.data);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  const groups = new Map<string, Row[]>();
  for (const s of data ?? []) {
    const g = s.key.split('.')[0] ?? 'other';
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }

  return (
    <div>
      <AdminPageTitle title="System Settings" sub="Wallet limits, currency, WhatsApp number, credentials timing — every change is audited." />
      {saved && <p className="mb-4 rounded-input border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">Saved: {saved}</p>}

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <div className="flex flex-col gap-5">
          {[...groups.entries()].map(([group, rows]) => (
            <div key={group} className="glass rounded-card p-5">
              <p className="mb-3 font-display text-base font-bold capitalize text-fg">{group}</p>
              <div className="flex flex-col divide-y divide-line/60">
                {rows.map((s) => (
                  <div key={s.key} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-semibold text-fg">{s.key}</p>
                      {s.description && <p className="text-[11px] text-fg-3">{s.description}</p>}
                    </div>
                    {editing === s.key ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          autoFocus
                          className="w-44 rounded-input border border-accent bg-white/[3%] px-3 py-1.5 text-xs text-fg outline-none"
                        />
                        <button onClick={() => save(s.key)} disabled={busy === s.key}
                          className="inline-flex items-center gap-1 rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">
                          {busy === s.key ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                        </button>
                        <button onClick={() => setEditing(null)} className="text-[11px] font-bold text-fg-3">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="tabular rounded-input border border-line bg-white/[3%] px-3 py-1.5 text-xs font-bold text-fg">
                          {typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}
                        </span>
                        <button
                          onClick={() => { setEditing(s.key); setDraft(typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)); }}
                          className="rounded-input border border-line px-2.5 py-1 text-[11px] font-bold text-fg-2 hover:text-accent"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
