'use client';
// Payment Accounts management — the destinations players pay into on Add Money.
// Full admin control: create / edit / toggle / delete, all audited server-side.
import { useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { AdminPageTitle } from '@/components/admin/admin-shell';
import { Modal, Table, Td, Tr, useAdminList } from '@/components/admin/kit';
import { MethodBrand, type Method } from '@/components/wallet/bits';
import { api , apiGet } from '@/lib/client-api';

interface Row {
  id: string; method: Method; label: string; accountName: string; accountNumber: string;
  instructions: string | null; isActive: boolean; displayOrder: number;
  createdAt: string; updatedAt: string;
}

const METHOD_OPTIONS: Method[] = ['JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'NAYAPAY', 'SADAPAY'];

export default function AdminPaymentAccountsPage() {
  const { data, loading, setData } = useAdminList<Row[]>('/admin/payment-accounts');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);

  async function refresh() {
    const f = await apiGet<Row[]>(`/api/backend/admin/payment-accounts`);
    if (f) setData(f);
  }

  async function toggle(row: Row) {
    try {
      await api(`/admin/payment-accounts/${row.id}/toggle`, { method: 'POST', body: { isActive: !row.isActive } });
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Toggle failed');
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(`Delete the ${row.method} account "${row.label}"? Players can no longer select it.`)) return;
    try {
      await api(`/admin/payment-accounts/${row.id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div>
      <AdminPageTitle
        title="Payment Accounts"
        sub="The bank / wallet destinations shown on Add Money. Players can only pay into active accounts."
        action={<button onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-input bg-accent px-4 py-2.5 text-sm font-bold text-white"><Plus size={15} /> New Account</button>}
      />

      {loading && !data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <Table head={['Method', 'Label', 'Holder', 'Account', 'Order', 'State', 'Actions']}>
          {data?.map((a) => (
            <Tr key={a.id}>
              <Td><MethodBrand method={a.method} size={34} /></Td>
              <Td className="font-semibold text-fg">{a.label}</Td>
              <Td className="text-xs text-fg-2">{a.accountName}</Td>
              <Td className="font-mono text-xs text-fg-3">{a.accountNumber}</Td>
              <Td className="tabular text-fg-2">{a.displayOrder}</Td>
              <Td><span className={`text-xs font-bold ${a.isActive ? 'text-success' : 'text-fg-3'}`}>{a.isActive ? 'ACTIVE' : 'HIDDEN'}</span></Td>
              <Td>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setEditing(a)} className="rounded-input border border-line px-2.5 py-1 text-[11px] font-bold text-fg-2 hover:text-accent"><Pencil size={12} /></button>
                  <button onClick={() => toggle(a)} className={`rounded-input px-2.5 py-1 text-[11px] font-bold ${a.isActive ? 'border border-warning/40 text-warning' : 'bg-success/15 text-success'}`}>
                    {a.isActive ? 'Hide' : 'Activate'}
                  </button>
                  <button onClick={() => remove(a)} className="rounded-input border border-danger/30 px-2.5 py-1 text-[11px] font-bold text-danger"><Trash2 size={12} /></button>
                </div>
              </Td>
            </Tr>
          ))}
          {data?.length === 0 && <Tr><Td className="py-8 text-center text-fg-3">No payment accounts. Add one so players have somewhere to send money.</Td></Tr>}
        </Table>
      )}

      {editing && <AccountModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await refresh(); }} />}
    </div>
  );
}

function AccountModal({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<Method>(row?.method ?? 'JAZZCASH');
  const [label, setLabel] = useState(row?.label ?? '');
  const [accountName, setAccountName] = useState(row?.accountName ?? '');
  const [accountNumber, setAccountNumber] = useState(row?.accountNumber ?? '');
  const [instructions, setInstructions] = useState(row?.instructions ?? '');
  const [displayOrder, setDisplayOrder] = useState(String(row?.displayOrder ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const body = {
      method,
      label: label.trim(),
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      instructions: instructions.trim(),
      displayOrder: Number(displayOrder) || 0,
    };
    try {
      if (row) await api(`/admin/payment-accounts/${row.id}`, { method: 'PUT', body });
      else await api('/admin/payment-accounts', { method: 'POST', body });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={row ? 'Edit payment account' : 'New payment account'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-fg-2">Payment method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)} className={inputCls}>
            {METHOD_OPTIONS.map((m) => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. JazzCash — 0300 1234567" className={inputCls} />
        <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Account holder name" className={inputCls} />
        <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Account / wallet number" className={inputCls} />
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder="Payment instructions shown to players" className={inputCls} />
        <input value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value.replace(/[^\d]/g, ''))} placeholder="Display order" inputMode="numeric" className={inputCls} />
      </div>
      {error && <p className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
      <button onClick={submit} disabled={busy || label.trim().length < 2 || accountName.trim().length < 2 || accountNumber.trim().length < 4} className="mt-4 w-full rounded-input bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {busy ? <Loader2 size={15} className="inline animate-spin" /> : null} {row ? 'Save changes' : 'Create account'}
      </button>
    </Modal>
  );
}

const inputCls = 'w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent';
