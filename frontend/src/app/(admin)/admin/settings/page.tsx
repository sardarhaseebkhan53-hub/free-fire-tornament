'use client';
// System settings — design 39: every admin-configurable value, edited + audited.
// Also hosts the Maintenance / Fresh-start danger zone (wipes demo data only).
import { useState } from 'react';
import { AlertTriangle, Loader2, Save, Trash2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { useAdminList } from '@/components/admin/kit';
import { api, apiGet } from '@/lib/client-api';
import { useToast } from '@/components/toast';

interface Row { key: string; value: unknown; description: string | null; updatedAt: string }

export default function AdminSettingsPage() {
  const { data, loading, setData } = useAdminList<Row[]>('/admin/settings');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { toast } = useToast();

  // Fresh-start danger zone
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  async function resetDemo() {
    if (resetConfirm.trim().toUpperCase() !== 'RESET') return;
    setResetBusy(true);
    try {
      const out = await api<{ playersDeleted: number }>('/admin/maintenance/reset-demo', { method: 'POST' });
      setResetConfirm('');
      toast({
        tone: 'success',
        title: 'Fresh start complete',
        description: `${out.playersDeleted} player accounts and all demo content removed. Admin accounts, settings and audit history kept.`,
      });
    } catch (e) {
      toast({
        tone: 'error',
        title: 'Reset failed',
        description: e instanceof Error ? e.message : 'Could not reset demo data.',
      });
    } finally {
      setResetBusy(false);
    }
  }

  async function save(key: string, original: Row) {
    setBusy(key);
    try {
      // Preserve each setting's real type. Never coerce an all-digit string to
      // a Number — that drops leading zeros (e.g. a WhatsApp number starting
      // with 0300 would become 300...) and silently breaks the setting.
      const trimmed = draft.trim();
      let value: unknown = draft;
      if (typeof original.value === 'number') {
        const n = Number(trimmed);
        value = Number.isFinite(n) ? n : draft;
      } else if (typeof original.value === 'boolean') {
        value = trimmed === 'true';
      } else if (original.value !== null && typeof original.value === 'object') {
        try { value = JSON.parse(trimmed); } catch { value = draft; }
      } else {
        value = trimmed === '' ? '' : draft;
      }
      await api('/admin/settings', { method: 'POST', body: { key, value } });
      setEditing(null);
      setSaved(key);
      const fresh = await apiGet<Row[]>(`/admin/settings`);
      if (fresh) setData(fresh);
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
                        <button onClick={() => save(s.key, s)} disabled={busy === s.key}
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

      {/* Maintenance — Fresh start (danger zone) */}
      <div className="mt-8 rounded-card border border-danger/30 bg-danger/[4%] p-5 sm:p-6">
        <p className="flex items-center gap-2 font-display text-base font-bold text-danger">
          <AlertTriangle size={17} /> Fresh Start — Wipe Demo Data
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-2">
          Removes <b className="text-fg">all player accounts, tournaments, registrations, teams, matches,
          results, prizes, wallets, deposits, withdrawals, transfers, notifications, blogs, FAQs, ads and
          support data</b> so the platform can go live clean.
        </p>
        <p className="mt-1.5 text-xs text-fg-3">
          <b className="text-success">Kept:</b> admin/staff accounts (you stay logged in), system settings,
          payment accounts, static pages, SEO config and the full audit trail (the reset itself is audited).
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={resetConfirm}
            onChange={(e) => setResetConfirm(e.target.value)}
            placeholder='Type RESET to confirm'
            aria-label="Type RESET to confirm"
            className="w-44 rounded-input border border-danger/40 bg-base/60 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide text-danger outline-none placeholder:normal-case placeholder:text-fg-3 focus:border-danger"
          />
          <button
            onClick={resetDemo}
            disabled={resetBusy || resetConfirm.trim().toUpperCase() !== 'RESET'}
            className="inline-flex items-center gap-2 rounded-input bg-danger px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {resetBusy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {resetBusy ? 'Wiping…' : 'Wipe demo data'}
          </button>
        </div>
      </div>
    </div>
  );
}
