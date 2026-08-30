'use client';
// Custom Room card on the public tournament page (spec requirement 3: players see
// `Room ID: Hidden` / `Room Password: Hidden` before release and the real values after).
//
// Two rules shape this component:
//
//  1. It never holds a secret of its own. The values arrive only from
//     `GET /api/tournaments/:slug/room`, which answers for a confirmed seat and 403s for
//     anyone else, and includes them only inside the release window. So "Hidden" here is a
//     rendering of an ABSENT field, not a masked one — there is no hidden value in this
//     component's state, in the network response, or in the HTML for an extension to read.
//  2. It asks, it does not assume. Eligibility and timing are re-resolved server-side on
//     every read, so a refund that happened after this card loaded cannot leave a stale
//     room on screen — the next fetch (including the scheduled one below) drops it.
//
// A player who leaves the tab open until the window opens gets the values without
// reloading: the card arms one timer for the remaining milliseconds. A tab that slept
// through the moment gets "Check again" instead, because a timer frozen in a background tab
// fires late on mobile Safari and no interval is honest about that.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Lock, ShieldAlert } from 'lucide-react';
import { ApiClientError, api } from '@/lib/client-api';
import { deferLoad, useHasSession } from '@/lib/session';
import { CountdownUntil } from '@/components/countdown';
import { RoomPill } from '@/components/room-status';
import { dateTime } from '@/lib/format';
import type { PlayerRoom } from '@/lib/types';

/** `gone` = the event itself no longer answers, so the card removes itself. */
type Result = { kind: 'loading' } | { kind: 'ready'; room: PlayerRoom } | { kind: 'seats-only' } | { kind: 'gone' };

export function TournamentRoomCard({ slug }: { slug: string }) {
  const signedIn = useHasSession();
  const [result, setResult] = useState<Result>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);
  const [pwVisible, setPwVisible] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setResult({ kind: 'ready', room: await api<PlayerRoom>(`/tournaments/${slug}/room`) });
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : null;
      // 403 is the eligibility answer. 404 means the event is not visible to this player at
      // all (draft, or unpublished) — which on a page that rendered can only be a race, so
      // the card gets out of the way instead of showing an error on a page that is fine.
      setResult({ kind: code === 'NOT_FOUND' ? 'gone' : 'seats-only' });
    }
  }, [slug]);

  useEffect(() => {
    if (signedIn === true) deferLoad(() => load());
  }, [signedIn, load, nonce]);

  useEffect(() => {
    if (result.kind !== 'ready' || result.room.status !== 'SCHEDULED') return;
    const ms = result.room.releaseInMs;
    if (ms === null || ms <= 0) return;
    // 2^31-1 overflows a 32-bit timer and fires immediately, which would poll a tournament
    // scheduled a year out; clamping to ~24 days and re-arming from the next read is safe.
    const id = setTimeout(() => setNonce((n) => n + 1), Math.min(ms + 400, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [result]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const room = result.kind === 'ready' ? result.room : null;

  const copy = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(label);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1400);
  };

  if (result.kind === 'gone') return null;

  // Two independent facts from the API: the status says the window is open, and the field is
  // only ever filled for a seat holder. Rendering on the status alone would print `null`, and
  // on the value alone would print something the server had not released — so a value is
  // shown only where the two agree, and every other row reads `Hidden`.
  const value = (which: 'roomId' | 'roomPassword') =>
    room && room.status === 'AVAILABLE' ? room[which] ?? null : null;

  return (
    <section className="glass rounded-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-fg">
            <KeyRound size={17} className="text-accent" /> Custom Room
          </h2>
          <p className="mt-1 text-xs text-fg-2">Room ID and password, released shortly before this match starts.</p>
        </div>
        {room ? <RoomPill status={room.status} label={room.label} /> : null}
      </div>

      {signedIn === false ? (
        <p className="mt-4 rounded-input border border-line bg-white/[3%] px-4 py-3 text-sm text-fg-2">
          <Link href="/login" className="font-semibold text-accent hover:underline">Log in</Link> to see the room for your seat.
        </p>
      ) : result.kind === 'loading' ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-fg-3">
          <Loader2 size={14} className="animate-spin" /> Checking your seat…
        </p>
      ) : result.kind === 'seats-only' ? (
        <p className="mt-4 rounded-input border border-line bg-white/[3%] px-4 py-3 text-sm text-fg-2">
          Room details appear here for players holding a confirmed seat in this tournament.
        </p>
      ) : room ? (
        <>
          <div className="mt-4 space-y-2.5">
            {(['roomId', 'roomPassword'] as const).map((which) => {
              const label = which === 'roomId' ? 'Room ID' : 'Room Password';
              const v = value(which);
              const shown = v !== null && (which === 'roomId' || pwVisible);
              return (
                <div key={which} className="flex items-center justify-between gap-3 rounded-input border border-line bg-white/[3%] px-4 py-3">
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-fg-3">{label}</span>
                  <span className="flex items-center gap-2">
                    {v !== null ? (
                      <>
                        <span className={`font-display text-base font-bold tracking-[0.08em] ${shown ? 'text-success' : 'text-fg-2'}`}>
                          {shown ? v : '••••••••'}
                        </span>
                        {which === 'roomPassword' ? (
                          <button
                            type="button"
                            aria-label={pwVisible ? 'Hide the password' : 'Show the password'}
                            aria-pressed={pwVisible}
                            onClick={() => setPwVisible((x) => !x)}
                            className="rounded-pill p-1.5 text-fg-2 transition-colors hover:bg-white/10 hover:text-fg"
                          >
                            {pwVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => copy(label, v)}
                          aria-label={`Copy the ${label.toLowerCase()}`}
                          className="rounded-pill p-1.5 text-fg-2 transition-colors hover:bg-white/10 hover:text-fg"
                        >
                          {copied === label ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                        </button>
                      </>
                    ) : (
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-fg-2">
                        <Lock size={13} /> Hidden
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {room.status === 'SCHEDULED' && room.releaseAt ? (
            <p className="mt-3 text-xs text-fg-2">
              {room.hidden ? 'An admin hid this room again — a new release time will be set. ' : 'Opens in '}
              {room.hidden || room.releaseInMs === null ? null : <CountdownUntil at={room.releaseAt} className="font-semibold text-warning" />}
              <span className="text-fg-3"> · {dateTime(room.releaseAt)}</span>
            </p>
          ) : null}

          {room.status === 'NOT_ADDED' ? (
            <p className="mt-3 text-xs text-fg-3">
              Not published yet — the organiser adds it a few minutes before the match. No need to refresh: this card updates itself.
            </p>
          ) : null}

          {room.status === 'CANCELLED' ? (
            <p className="mt-3 flex items-start gap-2 rounded-input border border-danger/30 bg-danger/[6%] px-3 py-2.5 text-xs text-danger">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                This room was cancelled and will not be opened.
                {room.cancelReason ? ` Reason: ${room.cancelReason}` : ''}
              </span>
            </p>
          ) : null}

          {room.status === 'AVAILABLE' && room.roomId === null ? (
            <p className="mt-3 text-xs text-fg-3">The window is open — reload to pull the values in.</p>
          ) : null}

          {room.status === 'AVAILABLE' && room.roomId !== null ? (
            <p className="mt-3 text-[11px] text-fg-3">Do not share these. Anyone with the Room ID and password can join the lobby.</p>
          ) : null}

          {room.status !== 'AVAILABLE' && room.status !== 'CANCELLED' ? (
            <button type="button" onClick={() => deferLoad(() => load())} className="mt-3 text-[11px] font-semibold text-accent hover:underline">
              Check again
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
