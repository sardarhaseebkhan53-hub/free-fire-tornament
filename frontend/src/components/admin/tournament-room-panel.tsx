'use client';
// Admin Panel → Room management (spec requirement 4 + 5): add the Room ID / password,
// update either one, hide the room, cancel it — and see exactly when players will see it.
//
// Why this panel exists at all: the timing rule is a *derived* state (it depends on the
// event's start time, which moves), so an admin reading "Room Available" needs the row to
// be as honest as the player's view. Every number here comes from the same resolver the
// player endpoint uses — `GET /api/admin/tournaments/:id/room` — so the panel and a player's
// card cannot disagree, and neither one decides anything on its own.
//
// Two things this panel never does:
//   • it does not treat a password as a log line. The API returns it because an admin has to
//     be able to read it back; it is never printed into the activity log (see room.service).
//   • it does not "delete" a room. Clearing both halves is refused server-side, because a
//     room that a seat holder can no longer reach is worse than a room with a wrong password,
//     and the admin who wants it gone means Cancel — which is a different, audited verb.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Copy, Eye, EyeOff, KeyRound, Loader2, Lock, Save, ShieldOff, Unlock } from 'lucide-react';
import { Modal } from '@/components/admin/kit';
import { RoomPill } from '@/components/room-status';
import { api, ApiClientError } from '@/lib/client-api';
import { deferLoad } from '@/lib/session';
import { useNow } from '@/lib/client-time';
import { dateTime, msToCountdown } from '@/lib/format';
import type { AdminRoom, AdminRoomDetail } from '@/lib/types';
import { roomFormWarning, roomPatch, toLocalInput, cleanRoomCredential } from '@/lib/room-form';

const inputCls =
  'w-full rounded-input border border-line bg-white/[4%] px-3.5 py-2.5 text-sm font-semibold text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent disabled:opacity-50';

type Props = {
  tournamentId: string;
  onClose: () => void;
  /** lets the list behind the modal refresh, so its status pill is not stale */
  onChanged?: () => void;
};

export function TournamentRoomPanel({ tournamentId, onClose, onChanged }: Props) {
  const [data, setData] = useState<AdminRoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  // Guard against duplicate submissions before React re-renders the disabled button.
  // A double click (or a click that lands while `saving` is still false) must never
  // put two identical PUT/POST requests on the wire.
  const saveInFlight = useRef(false);
  const actionInFlight = useRef(false);

  const [form, setForm] = useState({ roomId: '', roomPassword: '', note: '', lead: '', pin: '' });
  const setField = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<AdminRoomDetail>(`/admin/tournaments/${tournamentId}/room`);
      setData(d);
      setForm({
        roomId: d.room.roomId ?? '',
        roomPassword: d.room.roomPassword ?? '',
        note: d.room.note ?? '',
        // The box shows the event's OWN lead, not the effective one: pre-filling a platform
        // default as if the event had set it would write that number onto the row the first
        // time the admin pressed Save without changing anything.
        lead: d.room.releaseSource === 'EVENT' ? String(d.room.releaseMinutes) : '',
        pin: d.room.releaseSource === 'PINNED' ? toLocalInput(d.room.releaseAt) : '',
      });
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not load the room.');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    // deferLoad, not a direct call: the fetch's own loading state must not be set in the
    // effect body (that is a second render before the browser has painted the first).
    deferLoad(() => load());
  }, [load]);

  // Only what changed goes on the wire (see lib/room-form for why that is the rule, and
  // the empty box versus missing key that makes it load-bearing).
  const patch = useMemo(() => roomPatch(data?.room ?? null, form), [data, form]);
  const dirty = Object.keys(patch).length > 0;
  const warning = roomFormWarning(form);

  async function save() {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setError(null);
    setSavedNote(null);
    try {
      const res = await api<{ releasedImmediately: boolean; releaseAt: string; room: AdminRoom }>(
        `/admin/tournaments/${tournamentId}/room`,
        // Pass the object, not JSON.stringify(): the api helper already serialises it.
        // Double-serialising was producing `req.body` as a JSON string, which the
        // backend rejects with 400 before this service ever runs.
        { method: 'PUT', body: patch },
      );
      await load();
      onChanged?.();
      setSavedNote(
        res.releasedImmediately
          ? // In-window credentials are live the moment they are saved — the admin must hear
            // that in the same breath as "saved", or they assume players have to wait.
            `Saved. This event is already inside its release window, so players can see the new values right now.`
          : `Saved. Players will see them ${new Date(res.releaseAt) > new Date() ? `at ${dateTime(res.releaseAt)}` : 'as soon as the window opens'}.`,
      );
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'The room could not be saved.');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  async function act(action: 'HIDE' | 'SHOW' | 'CANCEL' | 'REACTIVATE') {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setSaving(true);
    setError(null);
    setSavedNote(null);
    try {
      const res = await api<{ message: string }>(`/admin/tournaments/${tournamentId}/room/status`, {
        method: 'POST',
        body: { action, ...(action === 'CANCEL' ? { reason: cancelReason.trim() } : {}) },
      });
      setSavedNote(res.message);
      if (action === 'CANCEL') setCancelReason('');
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'That action did not go through.');
    } finally {
      actionInFlight.current = false;
      setSaving(false);
    }
  }

  // The clock is only read through useNow (see lib/client-time) so the server render and
  // the first client paint agree; before the first sample the hint is simply not shown.
  const now = useNow(30_000);
  const room = data?.room ?? null;
  const startingSoon = room ? room.releaseInMs <= 0 && room.status === 'AVAILABLE' : false;
  const startsInsideWindow =
    now !== null && data !== null && room !== null && new Date(data.tournament.startTime).getTime() - now <= room.releaseMinutes * 60_000;

  return (
    <Modal title="Tournament room" onClose={onClose} wide>
      {loading ? (
        <p className="flex items-center gap-2 py-6 text-sm text-fg-3">
          <Loader2 size={14} className="animate-spin" /> Loading the room…
        </p>
      ) : !data || !room ? (
        <div className="space-y-3 py-2">
          <p className="text-sm text-danger">{error ?? 'Nothing to show.'}</p>
          <button type="button" onClick={() => void load()} className="text-xs font-semibold text-accent hover:underline">
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Where this room stands, in the same words the player's card uses. */}
          <div className="rounded-card border border-line bg-white/[3%] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-base font-bold text-fg">{data.tournament.title}</p>
                <p className="mt-0.5 text-xs text-fg-2">
                  Starts {dateTime(data.tournament.startTime)} · {data.tournament.confirmedSeats} confirmed seat
                  {data.tournament.confirmedSeats === 1 ? '' : 's'}
                </p>
              </div>
              <RoomPill status={room.status} label={room.label} />
            </div>

            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-fg-3">Releases</dt>
                <dd className="mt-0.5 font-semibold text-fg">{dateTime(room.releaseAt)}</dd>
              </div>
              <div>
                <dt className="text-fg-3">{room.releaseInMs > 0 ? 'In' : 'Open for'}</dt>
                <dd className="tabular mt-0.5 font-semibold text-fg">{msToCountdown(Math.abs(room.releaseInMs))}</dd>
              </div>
              <div>
                <dt className="text-fg-3">Lead</dt>
                <dd className="mt-0.5 font-semibold text-fg">
                  {room.releaseMinutes} min
                  <span className="ml-1 text-fg-3">
                    ({room.releaseSource === 'PINNED' ? 'pinned time' : room.releaseSource === 'EVENT' ? 'this event' : `platform default`})
                  </span>
                </dd>
              </div>
            </dl>

            {room.note ? <p className="mt-2 text-xs text-fg-2">Note: {room.note}</p> : null}
            {room.cancelReason ? <p className="mt-2 text-xs text-danger">Cancelled: {room.cancelReason}</p> : null}
            {room.releasedAt ? (
              <p className="mt-2 text-[11px] text-fg-3">
                First served to players at {dateTime(room.releasedAt)}
                {room.updatedAt && new Date(room.updatedAt) > new Date(room.releasedAt) ? ' — newer than the last credential change, so it has been announced' : ''}.
              </p>
            ) : null}
            {startingSoon ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle size={13} /> Credentials are visible to seat holders right now.
              </p>
            ) : null}
            {startsInsideWindow && !startingSoon ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle size={13} /> This event starts inside its own {room.releaseMinutes}-minute window — anything you save is published immediately.
              </p>
            ) : null}
          </div>

          {/* Credentials */}
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.12em] text-fg">
              <KeyRound size={14} className="text-accent" /> Credentials
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-fg-3">Room ID — numbers only</span>
                <input
                  value={form.roomId}
                  onChange={(e) => setField({ roomId: cleanRoomCredential(e.target.value, 20) })}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="123456789"
                  autoComplete="off"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-fg-3">Room password — numbers only</span>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={form.roomPassword}
                    onChange={(e) => setField({ roomPassword: cleanRoomCredential(e.target.value, 30) })}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="123456"
                    autoComplete="off"
                    className={`${inputCls} pr-16`}
                  />
                  <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? 'Hide the password' : 'Show the password'}
                      className="rounded-pill p-1.5 text-fg-3 hover:bg-white/10 hover:text-fg"
                    >
                      {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    {form.roomPassword.trim() ? (
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard?.writeText(form.roomPassword.trim())}
                        aria-label="Copy the password"
                        className="rounded-pill p-1.5 text-fg-3 hover:bg-white/10 hover:text-fg"
                      >
                        <Copy size={13} />
                      </button>
                    ) : null}
                  </span>
                </div>

              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-fg-3">
                  Minutes before start ({data.config.globalReleaseMinutes} = platform)
                </span>
                <input
                  value={form.lead}
                  onChange={(e) => setField({ lead: e.target.value })}
                  inputMode="numeric"
                  placeholder={String(data.config.globalReleaseMinutes)}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-fg-3">Or pin an exact time</span>
                <input type="datetime-local" value={form.pin} onChange={(e) => setField({ pin: e.target.value })} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-fg-3">Internal note</span>
                <input value={form.note} onChange={(e) => setField({ note: e.target.value })} placeholder="never shown to players" className={inputCls} />
              </label>
            </div>

            {warning ? <p className="text-xs font-semibold text-warning">{warning}</p> : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="inline-flex items-center gap-2 rounded-pill bg-accent px-4 py-2 text-sm font-bold text-base transition-opacity disabled:opacity-40"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {dirty ? 'Save room' : 'Nothing to save'}
              </button>
              {room.hidden ? (
                <button
                  type="button"
                  onClick={() => void act('SHOW')}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-pill border border-success/40 px-4 py-2 text-sm font-bold text-success hover:bg-success/10 disabled:opacity-40"
                >
                  <Unlock size={14} /> Make visible again
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void act('HIDE')}
                  disabled={saving || !room.hasRoomId && !room.hasRoomPassword}
                  title="Hides the values from players but keeps them — nothing is retyped to undo this."
                  className="inline-flex items-center gap-2 rounded-pill border border-line px-4 py-2 text-sm font-bold text-fg-2 hover:bg-white/5 disabled:opacity-40"
                >
                  <Lock size={14} /> Hide from players
                </button>
              )}
              {savedNote ? <p className="text-xs font-semibold text-success">{savedNote}</p> : null}
              {error ? <p className="text-xs font-semibold text-danger">{error}</p> : null}
            </div>
          </div>

          {/* The destructive verb, kept apart from the ordinary edits on purpose. */}
          <div className="rounded-card border border-danger/25 bg-danger/[4%] p-4">
            <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.12em] text-danger">
              <ShieldOff size={14} /> Cancel the room
            </h3>
            <p className="mt-1 text-xs text-fg-2">
              Credentials disappear from every player immediately, the status becomes <strong>Room Cancelled</strong>, a notification goes out to
              seat holders, and this is written to the audit log. The values stay on the record so you can re-activate without retyping them.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason (required) — shown to players"
                className={`${inputCls} max-w-xs`}
              />
              <button
                type="button"
                onClick={() => void act('CANCEL')}
                disabled={saving || room.status === 'CANCELLED' || cancelReason.trim() === ''}
                className="rounded-pill bg-danger px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                Cancel room
              </button>
              {room.status === 'CANCELLED' ? (
                <button
                  type="button"
                  onClick={() => void act('REACTIVATE')}
                  disabled={saving}
                  className="rounded-pill border border-line px-4 py-2 text-sm font-bold text-fg-2 hover:bg-white/5 disabled:opacity-40"
                >
                  Re-activate
                </button>
              ) : null}
            </div>
          </div>

          {data.matchRooms.length > 0 ? (
            <p className="text-[11px] text-fg-3">
              This event also has {data.matchRooms.length} per-match room{data.matchRooms.length === 1 ? '' : 's'} (
              {data.matchRooms.filter((m) => m.hasCredentials).length} with credentials), released on their own schedule from the Matches screen —
              this panel is only the event-level room.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
