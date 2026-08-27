'use client';
// Support Center — design 44 (Phase 11): my tickets + thread + new-ticket form
// with screenshot attachments. One UI for mobile (stacked) and PC (two columns).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Headphones, ImagePlus, Loader2, Lock, MessageSquare, Paperclip, Plus, Send, ShieldCheck, X,
} from 'lucide-react';
import { api, ApiClientError, getToken } from '@/lib/client-api';

// ---------------------------------------------------------------------------

const CATEGORY_TONE: Record<string, string> = {
  PAYMENT: 'border-info/40 bg-info/10 text-info',
  TOURNAMENT: 'border-accent/40 bg-accent/10 text-accent',
  WITHDRAWAL: 'border-reward/40 bg-reward/10 text-reward',
  ACCOUNT: 'border-success/40 bg-success/10 text-success',
  TEAM: 'border-info/40 bg-info/10 text-info',
  TECHNICAL: 'border-danger/40 bg-danger/10 text-danger',
  REPORT_PLAYER: 'border-warning/40 bg-warning/10 text-warning',
  OTHER: 'border-line bg-white/5 text-fg-2',
};

const STATUS_TONE: Record<string, string> = {
  OPEN: 'border-info/40 bg-info/10 text-info',
  IN_PROGRESS: 'border-accent/40 bg-accent/10 text-accent',
  WAITING_USER: 'border-warning/40 bg-warning/10 text-warning',
  RESOLVED: 'border-success/40 bg-success/10 text-success',
  CLOSED: 'border-line bg-white/5 text-fg-3',
};

const PRIORITY_TONE: Record<string, string> = {
  LOW: 'bg-fg-3',
  MEDIUM: 'bg-info',
  HIGH: 'bg-warning',
  URGENT: 'bg-danger',
};

const CATEGORIES = ['PAYMENT', 'TOURNAMENT', 'WITHDRAWAL', 'ACCOUNT', 'TEAM', 'TECHNICAL', 'REPORT_PLAYER', 'OTHER'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const FILTERS = ['ALL', 'OPEN', 'WAITING_USER', 'RESOLVED', 'CLOSED'] as const;
type Filter = (typeof FILTERS)[number];

const timeAgo = (d: string) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

interface TicketRow {
  id: string; ref: string; category: string; subject: string; priority: string; status: string;
  createdAt: string; updatedAt: string; replies: number;
  lastMessage: { preview: string; isStaff: boolean; at: string } | null;
}

interface Thread {
  id: string; ref: string; category: string; subject: string; priority: string; status: string;
  createdAt: string;
  messages: Array<{ id: string; body: string; isStaff: boolean; sender: string; attachment: string | null; createdAt: string }>;
}

/** Authed attachment loader (owner-or-staff gated route). */
function Attachment({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    fetch(`/api/backend${url}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('x'))))
      .then((b) => {
        revoke = URL.createObjectURL(b);
        setSrc(revoke);
      })
      .catch(() => setSrc(null));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [url]);
  if (!src) return <span className="text-[11px] text-fg-3">attachment unavailable</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Ticket attachment" className="mt-1.5 max-h-44 rounded-input border border-line" />;
}

// ---------------------------------------------------------------------------

export default function SupportTicketsPage() {
  const [anon] = useState(() => typeof window !== 'undefined' && !getToken());
  const [filter, setFilter] = useState<Filter>('ALL');
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState('');

  // New-ticket form
  const [fCategory, setFCategory] = useState<(typeof CATEGORIES)[number]>('PAYMENT');
  const [fPriority, setFPriority] = useState<(typeof PRIORITIES)[number]>('MEDIUM');
  const [fSubject, setFSubject] = useState('');
  const [fMessage, setFMessage] = useState('');
  const [fFile, setFFile] = useState<File | null>(null);
  const [fBusy, setFBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const replyInput = useRef<HTMLInputElement | null>(null);

  const loadTickets = useCallback(async () => {
    try {
      const qs = filter === 'ALL' ? '' : `?status=${filter}`;
      const data = await api<{ tickets: TicketRow[] }>(`/support${qs}`);
      setTickets(data.tickets);
    } catch {
      setTickets([]);
    }
  }, [filter]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const openTicket = useCallback(async (id: string) => {
    setActive(id);
    setThreadLoading(true);
    setThread(null);
    setReply('');
    setReplyFile(null);
    try {
      setThread(await api<Thread>(`/support/${id}`));
    } catch {
      setThread(null);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  async function submitReply() {
    if (!active || !reply.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const fd = new FormData();
      fd.set('body', reply.trim());
      if (replyFile) fd.set('attachment', replyFile);
      const res = await fetch(`/api/backend/support/${active}/reply`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
        body: fd,
      });
      const j = (await res.json()) as { success: boolean; message?: string };
      if (!j.success) throw new Error(j.message ?? 'Could not send');
      setReply('');
      setReplyFile(null);
      await openTicket(active);
      await loadTickets();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setSending(false);
    }
  }

  async function createTicket() {
    if (fBusy) return;
    setError('');
    setFBusy(true);
    try {
      const fd = new FormData();
      fd.set('category', fCategory);
      fd.set('priority', fPriority);
      fd.set('subject', fSubject.trim());
      fd.set('message', fMessage.trim());
      if (fFile) fd.set('attachment', fFile);
      const res = await fetch('/api/backend/support', {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
        body: fd,
      });
      const j = (await res.json()) as { success: boolean; message?: string; errors?: Array<{ path: string; message: string }>; data?: { id: string } };
      if (!j.success) {
        const first = j.errors?.[0]?.message;
        throw new Error(first ?? j.message ?? 'Could not create ticket');
      }
      setModal(false);
      setFSubject('');
      setFMessage('');
      setFFile(null);
      await loadTickets();
      if (j.data?.id) await openTicket(j.data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create ticket');
    } finally {
      setFBusy(false);
    }
  }

  async function closeTicket() {
    if (!active) return;
    try {
      await api(`/support/${active}/close`, { method: 'POST' });
      await openTicket(active);
      await loadTickets();
    } catch (e) {
      if (e instanceof ApiClientError) setError(e.message);
    }
  }

  const closed = thread?.status === 'CLOSED';

  if (anon) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to view your tickets</h1>
        <p className="mt-2 text-sm text-fg-2">
          Your support conversations live in your account — open, track and resolve them here.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/login?next=/support/tickets" className="rounded-input bg-accent px-5 py-2.5 text-sm font-bold text-white">Sign In</Link>
          <Link href="/register" className="rounded-input border border-line px-5 py-2.5 text-sm font-semibold text-fg-2">Create Account</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 lg:px-8 lg:pt-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-fg">Support Center</h1>
          <p className="mt-1 text-sm text-fg-2">Stuck on a payment, match or account? Staff reply in-app, usually within 24h.</p>
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex w-full items-center justify-center gap-2 rounded-input bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_18px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong sm:w-auto"
        >
          <Plus size={16} /> New Ticket
        </button>
      </div>

      {/* Status filter pills */}
      <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setActive(null); setThread(null); }}
            className={`shrink-0 rounded-pill border px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
              filter === f ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line bg-white/[3%] text-fg-3 hover:text-fg-2'
            }`}
          >
            {f === 'WAITING_USER' ? 'Waiting you' : f === 'ALL' ? 'All tickets' : f}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Ticket list */}
        <div className="space-y-3">
          {tickets === null && (
            <div className="glass flex items-center justify-center rounded-card p-10"><Loader2 className="animate-spin text-accent" /></div>
          )}
          {tickets !== null && tickets.length === 0 && (
            <div className="glass rounded-card p-8 text-center">
              <Headphones size={28} className="mx-auto text-fg-3" />
              <p className="mt-3 text-sm font-semibold text-fg">No tickets here</p>
              <p className="mt-1 text-xs text-fg-3">Nothing with this status. Open a ticket and staff will jump in.</p>
            </div>
          )}
          {tickets?.map((t) => (
            <button
              key={t.id}
              onClick={() => openTicket(t.id)}
              className={`glass w-full rounded-card p-4 text-left transition hover:border-accent/40 ${
                active === t.id ? 'border-accent/50 shadow-[0_0_0_1px_rgba(139,92,246,0.35)]' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`rounded-pill border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${CATEGORY_TONE[t.category]}`}>
                  {t.category.replace('_', ' ')}
                </span>
                <span className={`rounded-pill border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${STATUS_TONE[t.status]}`}>
                  {t.status === 'WAITING_USER' ? 'Waiting you' : t.status.replace('_', ' ')}
                </span>
                <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${PRIORITY_TONE[t.priority]}`} title={`${t.priority} priority`} />
              </div>
              <p className="mt-2 truncate text-sm font-semibold text-fg">{t.subject}</p>
              {t.lastMessage && (
                <p className="mt-1 line-clamp-1 text-xs text-fg-3">
                  <span className={t.lastMessage.isStaff ? 'text-info' : ''}>{t.lastMessage.isStaff ? 'Staff: ' : 'You: '}</span>
                  {t.lastMessage.preview}
                </p>
              )}
              <p className="mt-1.5 text-[10px] uppercase tracking-wide text-fg-3">
                {t.ref} · {timeAgo(t.updatedAt)} {t.replies > 0 && `· ${t.replies} ${t.replies === 1 ? 'reply' : 'replies'}`}
              </p>
            </button>
          ))}
        </div>

        {/* Thread */}
        <div className="glass flex min-h-[420px] flex-col rounded-card">
          {!active && (
            <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
              <MessageSquare size={30} className="text-fg-3" />
              <p className="mt-3 text-sm font-semibold text-fg">Pick a ticket</p>
              <p className="mt-1 max-w-xs text-xs text-fg-3">
                Select a ticket on the left to read the conversation — or ask NEXA (bottom-right) for the quick stuff.
              </p>
            </div>
          )}
          {active && threadLoading && (
            <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
          )}
          {thread && (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-fg">{thread.subject}</p>
                  <p className="text-[10px] uppercase tracking-wide text-fg-3">{thread.ref} · opened {timeAgo(thread.createdAt)}</p>
                </div>
                <span className={`rounded-pill border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${CATEGORY_TONE[thread.category]}`}>
                  {thread.category.replace('_', ' ')}
                </span>
                <span className={`rounded-pill border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${STATUS_TONE[thread.status]}`}>
                  {thread.status === 'WAITING_USER' ? 'Waiting you' : thread.status.replace('_', ' ')}
                </span>
                {!closed && (
                  <button
                    onClick={closeTicket}
                    className="rounded-input border border-line px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-fg-3 transition hover:border-success/40 hover:text-success"
                  >
                    Close
                  </button>
                )}
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {thread.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.isStaff ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                        m.isStaff
                          ? 'rounded-bl-sm border border-line bg-white/[4%] text-fg-2'
                          : 'rounded-br-sm bg-accent/25 text-fg'
                      }`}
                    >
                      {m.isStaff && (
                        <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-info">
                          <ShieldCheck size={11} /> {m.sender} · staff
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      {m.attachment && <Attachment url={m.attachment} />}
                      <p className="mt-1 text-right text-[9px] text-fg-3">{timeAgo(m.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {closed ? (
                <div className="flex items-center justify-center gap-2 border-t border-line px-4 py-4 text-xs text-fg-3">
                  <Lock size={13} /> This ticket is closed — open a new one if you still need help.
                </div>
              ) : (
                <div className="border-t border-line px-4 py-3">
                  {error && <p className="mb-2 text-xs text-danger">{error}</p>}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      rows={2}
                      placeholder="Write a reply…"
                      maxLength={4000}
                      className="min-h-[44px] flex-1 resize-none rounded-input border border-line bg-white/[3%] px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent/50"
                    />
                    <input
                      ref={replyInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => setReplyFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      onClick={() => replyInput.current?.click()}
                      aria-label="Attach screenshot"
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-input border transition ${
                        replyFile ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line text-fg-3 hover:text-fg-2'
                      }`}
                    >
                      <Paperclip size={16} />
                    </button>
                    <button
                      onClick={submitReply}
                      disabled={sending || !reply.trim()}
                      aria-label="Send reply"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-input bg-accent text-white transition hover:bg-accent-strong disabled:opacity-40"
                    >
                      {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                  </div>
                  {replyFile && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-3">
                      <ImagePlus size={12} className="text-accent" /> {replyFile.name}
                      <button onClick={() => setReplyFile(null)} aria-label="Remove attachment" className="text-danger"><X size={12} /></button>
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* New Ticket modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setModal(false)}>
          <div
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-[20px] border border-line bg-surface p-6 shadow-2xl sm:max-w-lg sm:rounded-[20px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-fg">New Ticket</h2>
              <button onClick={() => setModal(false)} aria-label="Close" className="rounded-input border border-line p-1.5 text-fg-3 hover:text-fg"><X size={14} /></button>
            </div>

            {error && <p className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-fg-3">Category</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setFCategory(c)}
                  className={`rounded-pill border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
                    fCategory === c ? CATEGORY_TONE[c] : 'border-line bg-white/[3%] text-fg-3 hover:text-fg-2'
                  }`}
                >
                  {c.replace('_', ' ')}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-fg-3">Priority</label>
            <div className="mt-1.5 flex gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  onClick={() => setFPriority(p)}
                  className={`flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
                    fPriority === p ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line bg-white/[3%] text-fg-3 hover:text-fg-2'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_TONE[p]}`} /> {p}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-fg-3">Subject</label>
            <input
              value={fSubject}
              onChange={(e) => setFSubject(e.target.value)}
              placeholder="e.g. Deposit JC8492 not credited"
              maxLength={120}
              className="mt-1.5 w-full rounded-input border border-line bg-white/[3%] px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent/50"
            />

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-fg-3">What happened?</label>
            <textarea
              value={fMessage}
              onChange={(e) => setFMessage(e.target.value)}
              rows={4}
              placeholder="Give staff the details — transaction IDs, tournament names, times…"
              maxLength={4000}
              className="mt-1.5 w-full resize-none rounded-input border border-line bg-white/[3%] px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent/50"
            />

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-fg-3">Screenshot (optional)</label>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => setFFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileInput.current?.click()}
              className={`mt-1.5 flex w-full items-center justify-center gap-2 rounded-card border border-dashed px-4 py-5 text-xs transition ${
                fFile ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-fg-3 hover:border-accent/40 hover:text-fg-2'
              }`}
            >
              {fFile ? (
                <span className="flex items-center gap-2"><ImagePlus size={16} /> {fFile.name}</span>
              ) : (
                <span className="flex flex-col items-center gap-1.5">
                  <ImagePlus size={20} />
                  Attach a JPG / PNG / WebP screenshot
                </span>
              )}
            </button>

            <button
              onClick={createTicket}
              disabled={fBusy || fSubject.trim().length < 5 || fMessage.trim().length < 10}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white shadow-[0_4px_18px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong disabled:opacity-40"
            >
              {fBusy ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />} Submit Ticket
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
