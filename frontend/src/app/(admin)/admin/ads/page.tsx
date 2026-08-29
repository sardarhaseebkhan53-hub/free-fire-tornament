'use client';
// Ad management — design 37: placements, toggles, impressions/clicks.
import { useEffect, useState } from 'react';
import { Loader2, Power } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Modal, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { api , apiGet } from '@/lib/client-api';

interface Row { id: string; placement: string; name: string; targetUrl: string | null; isActive: boolean; impressions: number; clicks: number }
interface SettingRow { key: string; value: unknown }

export default function AdminAdsPage() {
  const { data, loading, setData } = useAdminList<Row[]>('/admin/ads');
  const [creating, setCreating] = useState(false);
  const [adsEnabled, setAdsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    apiGet<SettingRow[]>('/admin/settings')
      .then((rows) => {
        const row = rows?.find((s) => s.key === 'ads.enabled');
        if (row) setAdsEnabled(row.value === true);
      })
      .catch(() => { /* best-effort; the toggle is also inferred from rows less important than the ads themselves */ });
  }, []);

  async function toggleGlobal(next: boolean) {
    try {
      await api(`/admin/settings`, { method: 'POST', body: { key: 'ads.enabled', value: next } });
      setAdsEnabled(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not toggle ads.');
    }
  }

  async function toggle(id: string, isActive: boolean) {
    try {
      await api(`/admin/ads/${id}/toggle`, { method: 'POST', body: { isActive } });
      const fresh = await apiGet<Row[]>(`/admin/ads`);
      if (fresh) setData(fresh);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Toggle failed');
    }
  }

  return (
    <div>
      <AdminPageTitle title="Advertisements" sub="Sponsored slots across the site — impressions and clicks are tracked."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {adsEnabled !== null && (
              <button
                onClick={() => void toggleGlobal(!adsEnabled)}
                className={`inline-flex items-center gap-1.5 rounded-input px-4 py-2.5 text-sm font-bold transition ${adsEnabled ? 'border border-warning/40 bg-warning/10 text-warning hover:bg-warning/20' : 'bg-success/15 text-success hover:bg-success/25'}`}
              >
                <Power size={14} /> Ads {adsEnabled ? 'ON' : 'OFF'}
              </button>
            )}
            <button onClick={() => setCreating(true)} className="rounded-input bg-accent px-4 py-2.5 text-sm font-bold text-white">+ New Ad</button>
          </div>
        }
      />

      {adsEnabled === false && (
        <p className="mb-4 rounded-input border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
          Ads are turned off site-wide. Activate them above or pause/unpause individual campaigns below.
        </p>
      )}

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <Table head={['Name', 'Placement', 'Target', 'Impressions', 'Clicks', 'State', 'Actions']}>
          {data?.map((a) => (
            <Tr key={a.id}>
              <Td className="font-semibold text-fg">{a.name}</Td>
              <Td><span className="text-xs text-fg-2">{a.placement.replaceAll('_', ' ')}</span></Td>
              <Td><span className="max-w-40 truncate text-xs text-fg-3">{a.targetUrl ?? '—'}</span></Td>
              <Td className="tabular text-fg-2">{a.impressions.toLocaleString('en-PK')}</Td>
              <Td className="tabular text-fg-2">{a.clicks.toLocaleString('en-PK')}</Td>
              <Td><span className={`text-xs font-bold ${a.isActive ? 'text-success' : 'text-fg-3'}`}>{a.isActive ? 'ACTIVE' : 'PAUSED'}</span></Td>
              <Td>
                <button onClick={() => toggle(a.id, !a.isActive)} className={`rounded-input px-2.5 py-1 text-[11px] font-bold ${a.isActive ? 'border border-warning/40 text-warning' : 'bg-success/15 text-success'}`}>
                  {a.isActive ? 'Pause' : 'Activate'}
                </button>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      {creating && <CreateAd onClose={async () => { setCreating(false); const f = await apiGet<Row[]>(`/admin/ads`); if (f) setData(f); }} />}
    </div>
  );
}

function CreateAd({ onClose }: { onClose: () => void }) {
  const [placement, setPlacement] = useState('SIDEBAR');
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [embedHtml, setEmbedHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api('/admin/ads', { method: 'POST', body: { placement, name, targetUrl, embedHtml } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Creation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New advertisement" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <select value={placement} onChange={(e) => setPlacement(e.target.value)} className={inputCls}>
          {['HEADER','TOURNAMENT_PAGE','SIDEBAR','BLOG','FOOTER','MOBILE','INTERSTITIAL'].map((p) => <option key={p}>{p}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" className={inputCls} />
        <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="Target URL (optional)" className={inputCls} />
        <textarea value={embedHtml} onChange={(e) => setEmbedHtml(e.target.value)} rows={4} placeholder="Embed HTML (optional)" className={inputCls} />
      </div>
      {error && <p className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
      <button onClick={submit} disabled={busy || name.trim().length < 2} className="mt-4 w-full rounded-input bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-50">Create ad</button>
    </Modal>
  );
}

const inputCls = 'w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent';
