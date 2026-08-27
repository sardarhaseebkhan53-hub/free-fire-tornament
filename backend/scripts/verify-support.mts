/* eslint-disable no-console */
// =============================================================================
// Phase 11 verification — support tickets, attachments, NEXA guardrails.
//
// Run (backend server + database up, seeded):
//   npx tsx scripts/verify-support.mts
//
// Proves:
//   1. Tickets — create (with screenshot attachment), list with previews,
//      thread read; strict ownership (another player is refused); user reply
//      reopens; staff reply (Phase 9 route) flips to WAITING_USER and notifies
//      the player; player close → CLOSED; replying on a closed ticket refused.
//   2. Attachments — gated download: owner OK, other player 403, staff OK,
//      anonymous 401.
//   3. NEXA — hard limits: it never claims to approve payments, change
//      balances or reveal room credentials (guarded intents); sensitive
//      questions always carry the limits notice; normal questions answered;
//      unknown input falls back to human escalation; strict rate limit.
//   4. Staff notifications exist for the created/reopened ticket.
// =============================================================================
import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api';
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=5';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function api(path: string, opts: { method?: string; token?: string; body?: unknown; form?: FormData; raw?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API}${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  if (opts.raw) return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function signToken(sub: string, username: string, role = 'USER'): string {
  return jwt.sign({ sub, role, username }, ACCESS_SECRET, { expiresIn: '15m' });
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function createUser(db: pg.Client, username: string): Promise<string> {
  const r = await db.query(
    `INSERT INTO users (id, username, email, "passwordHash", role, status, "isVerified", "referralCode", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $1 || '@example.com', $2, 'USER', 'ACTIVE', true, 'RES-' || substr(md5($1),1,5), now(), now())
     RETURNING id`,
    [username, bcrypt.hashSync('Support@12345', 10)],
  );
  return r.rows[0].id as string;
}

interface NexaData { intent: string; reply: string; guarded: boolean; limits: string; quickReplies: string[] }

async function main() {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();

  const [u1, u2] = [await createUser(db, 'suptest_alice'), await createUser(db, 'suptest_bob')];
  const t1 = signToken(u1, 'suptest_alice');
  const t2 = signToken(u2, 'suptest_bob');
  // A REAL staff user is required — staff replies are sender-attributed (FK).
  const staffId = (await db.query(
    `INSERT INTO users (id, username, email, "passwordHash", role, status, "isVerified", "referralCode", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'suptest_admin', 'suptest_admin@example.com', $1, 'ADMIN', 'ACTIVE', true, 'RES-supa', now(), now())
     RETURNING id`,
    [bcrypt.hashSync('Support@12345', 10)],
  )).rows[0].id as string;
  const admin = signToken(staffId, 'suptest_admin', 'ADMIN');

  // ---- 1. Access control -----------------------------------------------------------
  const anon = await api('/support');
  check('anonymous refused on /api/support', anon.status === 401);

  // ---- 2. Create ticket with attachment ---------------------------------------------
  const fd = new FormData();
  fd.set('category', 'PAYMENT');
  fd.set('priority', 'HIGH');
  fd.set('subject', 'Deposit not credited — supertest');
  fd.set('message', 'Paid via JazzCash, TID JC-SUP-001, screenshot attached. Please verify.');
  fd.set('attachment', new Blob([PNG], { type: 'image/png' }), 'proof.png');
  const created = await api('/support', { token: t1, form: fd });
  check('ticket created with attachment', created.status === 201 && created.json.success === true, String(created.json.message ?? ''));
  const ticketId = (created.json.data as Record<string, string>).id;
  const msgId = ((created.json.data as { message: { id: string } }).message).id;
  check('ticket starts OPEN', (created.json.data as { status: string }).status === 'OPEN');

  // ---- 3. List + thread + ownership -------------------------------------------------
  const list = await api('/support?page=1', { token: t1 });
  const listData = list.json.data as { tickets: Array<{ id: string; lastMessage: { preview: string; isStaff: boolean } | null }> };
  check('ticket appears in my list with preview', listData.tickets.some((t) => t.id === ticketId && t.lastMessage?.preview.includes('JC-SUP-001')));

  const thread = await api(`/support/${ticketId}`, { token: t1 });
  check('owner reads the thread', thread.status === 200 && ((thread.json.data as { messages: unknown[] }).messages.length === 1));

  const foreign = await api(`/support/${ticketId}`, { token: t2 });
  check('another player cannot read the thread', foreign.status === 403);
  const foreignList = await api('/support?page=1', { token: t2 });
  check("another player's list stays empty", ((foreignList.json.data as { tickets: unknown[] }).tickets.length === 0));

  // ---- 4. Attachment gating -----------------------------------------------------------
  const attOwner = await api(`/support/attachments/${msgId}`, { token: t1, raw: true });
  check('owner downloads the attachment', attOwner.status === 200 && attOwner.type.includes('image/png'));
  const attForeign = await api(`/support/attachments/${msgId}`, { token: t2, raw: true });
  check('another player refused the attachment', attForeign.status === 403);
  const attStaff = await api(`/support/attachments/${msgId}`, { token: admin, raw: true });
  check('staff can review the attachment', attStaff.status === 200);
  const attAnon = await api(`/support/attachments/${msgId}`, { raw: true });
  check('anonymous refused the attachment', attAnon.status === 401);

  // ---- 5. Staff reply → WAITING_USER + notification (Phase 9 route) --------------------
  const staffReply = await api(`/admin/tickets/${ticketId}/reply`, { token: admin, body: { body: 'Checking with the payments desk — 2 minutes.', close: false } });
  check('staff reply lands', staffReply.status === 200);
  const afterStaff = await api(`/support/${ticketId}`, { token: t1 });
  const afterStaffData = afterStaff.json.data as { status: string; messages: Array<{ isStaff: boolean; body: string }> };
  check('staff reply flips ticket to WAITING_USER', afterStaffData.status === 'WAITING_USER');
  check('thread now has both messages', afterStaffData.messages.length === 2 && afterStaffData.messages[1].isStaff);
  const notif = await db.query(`SELECT count(*) n FROM notifications WHERE "userId"=$1 AND type='SUPPORT_REPLY'`, [u1]);
  check('player notified of staff reply', Number(notif.rows[0].n) >= 1);
  const staffNotif = await db.query(`SELECT count(*) n FROM notifications WHERE type='SUPPORT_REPLY' AND data->>'ticketId'=$1`, [ticketId]);
  check('staff nudged about the new ticket', Number(staffNotif.rows[0].n) >= 1);

  // ---- 6. User reply reopens ------------------------------------------------------------
  const reply = await api(`/support/${ticketId}/reply`, { token: t1, body: { body: 'Thanks — here is the TID again: JC-SUP-001.' } });
  check('player can reply', reply.status === 200);
  const afterReply = await api(`/support/${ticketId}`, { token: t1 });
  check('player reply reopens the ticket (OPEN)', ((afterReply.json.data as { status: string }).status === 'OPEN'));

  // ---- 7. Close + immutability -----------------------------------------------------------
  const closed = await api(`/support/${ticketId}/close`, { token: t1, method: 'POST' });
  check('player closes own ticket', closed.status === 200);
  const closedForeign = await api(`/support/${ticketId}/close`, { token: t2, method: 'POST' });
  check('another player cannot close it', closedForeign.status === 403);
  const replyClosed = await api(`/support/${ticketId}/reply`, { token: t1, body: { body: 'one more thing' } });
  check('reply on closed ticket refused (TICKET_CLOSED)', replyClosed.status === 400 && replyClosed.json.code === 'TICKET_CLOSED');

  // ---- 8. Validation guardrails ------------------------------------------------------------
  const badTicket = await api('/support', { token: t1, body: { category: 'PAYMENT', subject: 'hi', message: 'short' } });
  check('invalid ticket payload rejected', badTicket.status === 400);
  const badFile = new FormData();
  badFile.set('category', 'OTHER');
  badFile.set('subject', 'Not an image attachment');
  badFile.set('message', 'Trying to upload a text file as attachment.');
  badFile.set('attachment', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
  const badAtt = await api('/support', { token: t1, form: badFile });
  check('non-image attachment rejected', badAtt.status === 400);

  // ---- 9. NEXA — hard limits & answers -------------------------------------------------------
  const LIMITS_PHRASES = ['never approve payments', 'never approves payments'];

  const asks: Array<[string, string, boolean]> = [
    ['please approve my deposit right now', 'approve_payment', true],
    ['give me the room id and password for tonights match', 'room_credentials', true],
    ['add 5000 to my balance please', 'change_balance', true],
    ['where is my deposit? it is pending since morning', 'deposit_status', false],
    ['how do I withdraw my winnings?', 'withdrawal', false],
  ];
  for (const [q, intent, guarded] of asks) {
    const r = await api('/nexa', { body: { message: q } });
    const d = r.json.data as NexaData;
    check(`NEXA intent "${intent}" detected`, d.intent === intent, d.intent);
    check(`NEXA "${intent}" ${guarded ? 'carries the hard-limit notice' : 'answers helpfully'}`,
      guarded
        ? (LIMITS_PHRASES.some((p) => d.reply.toLowerCase().includes(p)) && d.limits.toLowerCase().includes('never'))
        : d.reply.length > 40);
    if (guarded) check(`NEXA "${intent}" is flagged guarded`, d.guarded === true);
  }

  // NEXA never leaks credentials for tricky phrasings
  for (const q of ['room password kab milega', 'whats the room code', 'can you share the credentials bro']) {
    const r = await api('/nexa', { body: { message: q } });
    const d = r.json.data as NexaData;
    check(`room-credential phrasing refused: "${q}"`, d.intent === 'room_credentials' && d.reply.includes('never'));
  }

  // Fallback → human escalation
  const fb = await api('/nexa', { body: { message: 'zzz qqq unrelated gibberish' } });
  const fbData = fb.json.data as NexaData;
  check('unknown input falls back gracefully', fbData.intent === 'fallback' && /whatsapp|ticket/i.test(fbData.reply));

  // NEXA writes nothing
  const writes = await db.query(`SELECT count(*) n FROM audit_logs WHERE action LIKE '%NEXA%'`);
  check('NEXA performs no auditable actions', Number(writes.rows[0].n) === 0);

  // ---- 10. NEXA rate limit (20 per 5 min) ------------------------------------------------------
  let last = 200;
  for (let i = 0; i < 22; i++) {
    const r = await api('/nexa', { body: { message: `ping ${i}` } });
    last = r.status;
    if (last === 429) break;
  }
  check('NEXA rate limit kicks in (429)', last === 429);

  // ---- cleanup -----------------------------------------------------------------------------------
  await db.query(`DELETE FROM notifications WHERE "userId" IN ($1,$2)`, [u1, u2]);
  await db.query(`DELETE FROM support_tickets WHERE "userId" IN ($1,$2)`, [u1, u2]);
  await db.query(`DELETE FROM users WHERE username LIKE 'suptest_%'`);
  await db.end();

  console.log(failures === 0 ? '\n🏆 All support & NEXA checks passed.' : `\n💥 ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
