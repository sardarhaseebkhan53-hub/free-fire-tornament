'use client';
// Notification bell + inbox panel. Used in the user app shell, the public
// navbar (signed-in visitors) and the admin topbar. The admin variant also
// plays a chime whenever NEW notifications arrive while the panel is open or
// in the background (polling), with a persistent mute toggle.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bell, CheckCheck, Gift, Headphones, Landmark, Loader2, ShieldCheck,
  Swords, Trophy, Upload, UserRound, Volume2, VolumeX, Wallet,
} from 'lucide-react';
import { BellRing, BellOff } from 'lucide-react';
import { primeSoundOnGesture, playDing, isSoundEnabled, setSoundEnabled } from '@/lib/sound';
import { disablePush, enablePush, getPushConfig, pushSupported } from '@/lib/push';
import { deferLoad } from '@/lib/session';
import { api, ApiClientError } from '@/lib/client-api';

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { slug?: string; area?: string; [k: string]: unknown } | null;
  readAt: string | null;
  createdAt: string;
}
interface ListResp { items: Notif[]; total: number; unread: number }

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  DEPOSIT_APPROVED: Wallet,
  DEPOSIT_REJECTED: Wallet,
  WITHDRAWAL_UPDATE: Upload,
  MATCH_STARTING: Swords,
  ROOM_CREDENTIALS: ShieldCheck,
  TOURNAMENT_JOINED: Trophy,
  TOURNAMENT_UPDATE: Trophy,
  TOURNAMENT_COMPLETED: Trophy,
  WINNING_CREDITED: Trophy,
  REFERRAL_REWARD: Gift,
  SUPPORT_REPLY: Headphones,
  ACCOUNT: UserRound,
};

const TONES: Record<string, string> = {
  DEPOSIT_APPROVED: 'bg-success/15 text-success',
  DEPOSIT_REJECTED: 'bg-danger/15 text-danger',
  WINNING_CREDITED: 'bg-reward/15 text-reward',
  REFERRAL_REWARD: 'bg-reward/15 text-reward',
  MATCH_STARTING: 'bg-danger/15 text-danger',
  TOURNAMENT_UPDATE: 'bg-accent/15 text-accent',
  WITHDRAWAL_UPDATE: 'bg-info/15 text-info',
};

function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

// ---------------------------------------------------------------------------
// Device alerts (PHASE 19, Web Push). One row, three honest states: the browser
// cannot do it, the deployment has no VAPID keys, or you are (not) subscribed.
// Deliberately inside the bell rather than in settings: it is a notification
// preference, and a toggle the user finds only after a missed match is useless.
// ---------------------------------------------------------------------------
function PushAlertsToggle() {
  const [state, setState] = useState<'loading' | 'unsupported' | 'disabled' | 'off' | 'on'>('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!pushSupported()) return setState('unsupported');
    const config = await getPushConfig();
    if (!config.enabled) return setState('disabled');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg?.pushManager ? await reg.pushManager.getSubscription() : null;
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }, []);

  useEffect(() => { deferLoad(refresh); }, [refresh]);

  // The SW cannot re-subscribe by itself (it holds no auth token) — it asks a tab.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object' && (e.data as { type?: string }).type === 'push:resubscribe') {
        void enablePush().then((r) => { setNote(r.message); void refresh(); });
      }
    };
    navigator.serviceWorker?.addEventListener?.('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener?.('message', onMessage);
  }, [refresh]);

  async function toggle() {
    setBusy(true);
    setNote(null);
    try {
      const result = state === 'on' ? await disablePush() : await enablePush();
      setNote(result.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (state === 'unsupported' || state === 'disabled') {
    return (
      <div className="flex items-center gap-2 border-t border-line bg-white/[2%] px-4 py-2.5 text-[11px] text-fg-3">
        <BellOff size={12} />
        {state === 'unsupported'
          ? 'This browser cannot receive device alerts.'
          : 'Device alerts are not enabled on this deployment.'}
      </div>
    );
  }

  return (
    <div className="border-t border-line bg-white/[2%] px-4 py-2.5" data-testid="push-toggle">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] font-semibold text-fg-2">
          <BellRing size={12} className={state === 'on' ? 'text-success' : 'text-fg-3'} />
          Device alerts
          <span className={state === 'on' ? 'text-success' : 'text-fg-3'}>{state === 'on' ? '· on' : '· off'}</span>
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          data-testid="push-toggle-button"
          className="flex h-7 items-center gap-1 rounded-input border border-line px-2 text-[11px] font-bold text-fg-2 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null}
          {state === 'on' ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      {note && <p className="mt-1.5 text-[11px] leading-snug text-fg-3">{note}</p>}
      <p className="mt-1 text-[10px] leading-snug text-fg-3">
        Match-start and room-credential alerts. Your browser decides whether they show on the lock screen.
      </p>
    </div>
  );
}

export function NotificationsBell({ variant = 'user' }: { variant?: 'user' | 'admin' }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notif[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sound, setSound] = useState(true);
  const prevUnread = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    deferLoad(() => { setSound(isSoundEnabled()); primeSoundOnGesture(); });
  }, []);

  const pollUnread = useCallback(async () => {
    // Signed-out visitors never trigger an authenticated request — no 401 spam.
    if (!localStorage.getItem('cn_access')) return;
    try {
      const j = await api<{ unread: number }>('/notifications/unread-count');
      const n = j.unread;
      // First successful poll is the baseline (no sound for old items); after
      // that, any INCREASE means something new arrived → admin chime.
      if (variant === 'admin' && prevUnread.current !== null && n > prevUnread.current) playDing();
      prevUnread.current = n;
      setUnread(n);
    } catch (e) {
      // Session expired beyond refresh → stop poking the API. The bell just
      // stays quiet until the user signs in again.
      if (e instanceof ApiClientError && e.status === 401) setUnread(0);
    }
  }, [variant]);

  useEffect(() => {
    deferLoad(pollUnread);
    const id = setInterval(pollUnread, variant === 'admin' ? 15_000 : 30_000);
    return () => clearInterval(id);
  }, [pollUnread, variant]);

  const loadList = useCallback(async () => {
    if (!localStorage.getItem('cn_access')) return;
    setLoading(true);
    try {
      const j = await api<ListResp>('/notifications?pageSize=15');
      setItems(j.items);
    } catch { /* keep old items */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    deferLoad(loadList);
    const close = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, loadList]);

  async function markAll() {
    setUnread(0);
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev);
    try {
      await api('/notifications/read', { method: 'POST', body: { all: true } });
    } catch { /* optimistic */ }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white/[3%] text-fg-2 transition hover:text-fg active:scale-95"
      >
        <Bell size={variant === 'admin' ? 16 : 18} />
        {unread > 0 && (
          <span className="tabular absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-[0_0_10px_rgba(239,68,68,0.6)]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="animate-rise absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-line bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-display text-sm font-bold text-fg">
              {variant === 'admin' ? 'Admin alerts' : 'Notifications'}
              {unread > 0 && <span className="ml-2 text-xs font-semibold text-accent">{unread} new</span>}
            </p>
            <div className="flex items-center gap-1.5">
              {variant === 'admin' && (
                <button
                  onClick={() => { const next = !sound; setSound(next); setSoundEnabled(next); }}
                  aria-label={sound ? 'Mute notification sound' : 'Unmute notification sound'}
                  title={sound ? 'Sound on' : 'Sound muted'}
                  className={`flex h-8 w-8 items-center justify-center rounded-input border border-line transition ${sound ? 'text-accent' : 'text-fg-3'} hover:border-accent/40`}
                >
                  {sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
                </button>
              )}
              <button
                onClick={markAll}
                disabled={unread === 0}
                className="flex h-8 items-center gap-1 rounded-input border border-line px-2 text-[11px] font-bold text-fg-2 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && !items && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-3">
                <Loader2 size={15} className="animate-spin" /> Loading…
              </div>
            )}
            {items && items.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-fg-3">Nothing yet — you&apos;re all caught up.</p>
            )}
            {items?.map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              const tone = TONES[n.type] ?? 'bg-white/5 text-fg-2';
              const href =
                n.data?.area === 'tournaments' && n.data.slug ? `/tournaments/${n.data.slug}`
                : n.data?.area === 'matches' ? '/matches'
                : n.data?.area === 'deposits' || n.data?.area === 'wallet' ? '/wallet/transactions'
                : n.data?.area === 'withdrawals' ? '/wallet/withdraw'
                : n.data?.area === 'support' ? '/support/tickets'
                : variant === 'admin' ? '/admin' : '/dashboard';
              return (
                <Link
                  key={n.id}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`flex gap-3 border-b border-line/60 px-4 py-3 transition last:border-0 hover:bg-white/[3%] ${n.readAt ? '' : 'bg-accent/[4%]'}`}
                >
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}>
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`text-[13px] font-semibold leading-snug ${n.readAt ? 'text-fg-2' : 'text-fg'}`}>{n.title}</span>
                      <span className="shrink-0 text-[10px] text-fg-3">{relTime(n.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-fg-3">{n.body}</span>
                  </span>
                  {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="unread" />}
                </Link>
              );
            })}
          </div>

          <PushAlertsToggle />

          {variant === 'admin' && (
            <div className="flex items-center gap-2 border-t border-line bg-white/[2%] px-4 py-2.5 text-[11px] text-fg-3">
              <Landmark size={12} className="text-accent" />
              Deposits &amp; withdrawals alert you here — payments are still approved manually.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
