/* eslint-disable no-console */
// =============================================================================
// Phase 7 verification — wallet ledger + manual payments pipeline.
//
// Run (backend server + database up):
//   npx tsx scripts/verify-wallet.mts
//
// Proves:
//   1. Deposit submission — PENDING, never auto-credited, duplicate TID blocked.
//   2. Admin approve — credits the cash ledger exactly once; re-review refused.
//   3. Admin reject — no money moves, player notified.
//   4. Withdrawals — winning-only debit at request time, min amount enforced,
//      chain PENDING → APPROVED → PROCESSING → PAID, rejection reverses the
//      holding, player cancel releases a pending request.
//   5. Coin conversion — two ledger entries, one atomic transaction.
//   6. Transactions API — filters, totals (in/out/net), CSV export.
//   7. Permissions — screenshots owner-only, review endpoints admin-only.
//   8. Ledger integrity — chain arithmetic + no negative balances anywhere.
// =============================================================================
import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { png } from './lib/fixtures.js';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api';
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=5';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; form?: FormData; raw?: boolean } = {},
) {
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

// Phase 14: uploads are validated by their real bytes + dimensions, so the
// fixture is a genuine 64×64 PNG (the old 1×1 blob is now correctly refused).
const PNG = png(64);

async function createUser(db: pg.Client, username: string, cash: number, winning = 0): Promise<string> {
  const r = await db.query(
    `INSERT INTO users (id, username, email, "passwordHash", role, status, "isVerified", "referralCode", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $1 || '@example.com', $2, 'USER', 'ACTIVE', true, 'WLT-' || substr(md5($1),1,5), now(), now())
     RETURNING id`,
    [username, bcrypt.hashSync('Wallet@12345', 10)],
  );
  const id = r.rows[0].id as string;
  await db.query(
    `INSERT INTO wallets (id, "userId", "cashBalance", "winningBalance", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())`,
    [id, cash, winning],
  );
  return id;
}

async function main() {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();

  const admin = await db.query(`SELECT id, username FROM users WHERE email='admin@clutchnex.gg'`);
  if (!admin.rows[0]) throw new Error('Seed the database first (npm run db:seed) — admin user missing.');
  const adminId = admin.rows[0].id as string;
  const adminToken = signToken(adminId, 'admin', 'ADMIN');

  // Test actors: one rich player, one poor player, one attacker.
  await db.query(`DELETE FROM users WHERE username LIKE 'wtest_%'`);
  const richId = await createUser(db, 'wtest_rich', 500, 2000);
  const poorId = await createUser(db, 'wtest_poor', 20, 30);
  const otherId = await createUser(db, 'wtest_other', 0, 0);
  const richToken = signToken(richId, 'wtest_rich');
  const poorToken = signToken(poorId, 'wtest_poor');
  const otherToken = signToken(otherId, 'wtest_other');

  // ---- 1. WALLET OVERVIEW ----------------------------------------------------
  const overview = await api('/wallet', { token: richToken });
  check('wallet overview loads', overview.json.success === true && typeof overview.json.data.wallet.cashBalance === 'number');
  check('overview exposes payment settings', Number(overview.json.data.settings.minDeposit) >= 100 && Number(overview.json.data.settings.minWithdrawal) >= 100);

  const accounts = await api('/wallet/payment-accounts', { token: richToken });
  const methods = (accounts.json.data.accounts as Array<{ method: string }>).map((a) => a.method).sort();
  check('payment accounts seeded (JazzCash/EasyPaisa/Bank)', JSON.stringify(methods) === JSON.stringify(['BANK_TRANSFER', 'EASYPAISA', 'JAZZCASH']), methods.join(','));

  // ---- 2. DEPOSIT SUBMISSION -------------------------------------------------
  const form = new FormData();
  form.append('amount', '750');
  form.append('method', 'EASYPAISA');
  form.append('transactionId', 'WLT-TID-0001');
  form.append('senderName', 'Rich Tester');
  form.append('senderAccount', '03451234567');
  form.append('screenshot', new Blob([PNG], { type: 'image/png' }), 'proof.png');
  const dep1 = await api('/wallet/deposits', { token: richToken, form });
  check('deposit submitted → 201 PENDING', dep1.json.success === true && dep1.json.data.deposit.status === 'PENDING', JSON.stringify(dep1.json.code ?? ''));

  const balBefore = Number((await db.query(`SELECT "cashBalance" FROM wallets WHERE "userId"=$1`, [richId])).rows[0].cashBalance);
  check('deposit does NOT auto-credit', balBefore === 500, `cash=${balBefore}`);

  const dupForm = new FormData();
  dupForm.append('amount', '500');
  dupForm.append('method', 'JAZZCASH');
  dupForm.append('transactionId', 'WLT-TID-0001');
  dupForm.append('senderName', 'Rich Tester');
  dupForm.append('screenshot', new Blob([PNG], { type: 'image/png' }), 'proof.png');
  const dup = await api('/wallet/deposits', { token: poorToken, form: dupForm });
  check('duplicate TID blocked (even across users)', dup.status === 409 && dup.json.code === 'DUPLICATE_TRANSACTION', String(dup.json.code));

  const tinyForm = new FormData();
  tinyForm.append('amount', '10');
  tinyForm.append('method', 'JAZZCASH');
  tinyForm.append('transactionId', 'WLT-TID-0002');
  tinyForm.append('senderName', 'Rich Tester');
  tinyForm.append('screenshot', new Blob([PNG], { type: 'image/png' }), 'proof.png');
  const tiny = await api('/wallet/deposits', { token: richToken, form: tinyForm });
  check('below minimum deposit refused', tiny.status === 400, String(tiny.json.message));

  const noShot = new FormData();
  noShot.append('amount', '500');
  noShot.append('method', 'JAZZCASH');
  noShot.append('transactionId', 'WLT-TID-0009');
  noShot.append('senderName', 'Rich Tester');
  const noShotRes = await api('/wallet/deposits', { token: richToken, form: noShot });
  check('deposit without screenshot refused', noShotRes.status === 400);

  const dep1Id = dep1.json.data.deposit.id as string;

  // Second deposit for the reject path.
  const form2 = new FormData();
  form2.append('amount', '300');
  form2.append('method', 'JAZZCASH');
  form2.append('transactionId', 'WLT-TID-0003');
  form2.append('senderName', 'Rich Tester');
  form2.append('screenshot', new Blob([PNG], { type: 'image/png' }), 'proof2.png');
  const dep2 = await api('/wallet/deposits', { token: richToken, form: form2 });
  const dep2Id = dep2.json.data.deposit.id as string;

  // ---- 3. ADMIN REVIEW — APPROVE ---------------------------------------------
  const notAdmin = await api(`/admin/deposits/${dep1Id}/review`, { token: richToken, body: { action: 'APPROVE' } });
  check('review endpoint refused for players', notAdmin.status === 403, String(notAdmin.json.code));

  const approve = await api(`/admin/deposits/${dep1Id}/review`, { token: adminToken, body: { action: 'APPROVE' } });
  check('admin approve succeeds', approve.json.success === true && approve.json.data.status === 'APPROVED', JSON.stringify(approve.json.message ?? approve.json.code));

  const cashAfter = Number((await db.query(`SELECT "cashBalance" FROM wallets WHERE "userId"=$1`, [richId])).rows[0].cashBalance);
  check('approve credits cash ledger exactly the deposit', cashAfter === balBefore + 750, `cash=${cashAfter}`);

  const ledgerRow = await db.query(
    `SELECT type, "balanceAfter", amount FROM wallet_transactions WHERE "entityType"='Deposit' AND "entityId"=$1`,
    [dep1Id],
  );
  check('ledger DEPOSIT entry references the deposit', ledgerRow.rows[0]?.type === 'DEPOSIT' && Number(ledgerRow.rows[0].amount) === 750);

  const reReview = await api(`/admin/deposits/${dep1Id}/review`, { token: adminToken, body: { action: 'APPROVE' } });
  check('double approve refused (idempotency guard)', reReview.status === 409, String(reReview.json.code));

  const reject = await api(`/admin/deposits/${dep2Id}/review`, { token: adminToken, body: { action: 'REJECT', note: 'TID not found in our statement' } });
  check('admin reject succeeds', reject.json.success === true && reject.json.data.status === 'REJECTED');
  const cashAfterReject = Number((await db.query(`SELECT "cashBalance" FROM wallets WHERE "userId"=$1`, [richId])).rows[0].cashBalance);
  check('reject moves no money', cashAfterReject === cashAfter);

  const notes = await db.query(
    `SELECT type, count(*) n FROM notifications WHERE "userId"=$1 AND type IN ('DEPOSIT_APPROVED','DEPOSIT_REJECTED','SYSTEM') GROUP BY type`,
    [richId],
  );
  const noteMap = Object.fromEntries(notes.rows.map((r) => [r.type, Number(r.n)]));
  check('player notified about both reviews', (noteMap.DEPOSIT_APPROVED ?? 0) === 1 && (noteMap.DEPOSIT_REJECTED ?? 0) === 1, JSON.stringify(noteMap));

  // ---- 4. WITHDRAWALS ----------------------------------------------------------
  const tinyW = await api('/wallet/withdrawals', { token: richToken, body: { amount: 50, method: 'EASYPAISA', accountName: 'Rich Tester', accountNumber: '03451234567' } });
  check('below minimum withdrawal refused', tinyW.status === 400, String(tinyW.json.message));

  const badAcc = await api('/wallet/withdrawals', { token: richToken, body: { amount: 500, method: 'EASYPAISA', accountName: 'Rich Tester', accountNumber: '12345' } });
  check('invalid wallet number refused', badAcc.status === 400);

  const richWinning = Number((await db.query(`SELECT "winningBalance" FROM wallets WHERE "userId"=$1`, [richId])).rows[0].winningBalance);
  const overW = await api('/wallet/withdrawals', { token: poorToken, body: { amount: 100000, method: 'EASYPAISA', accountName: 'Poor Tester', accountNumber: '03457654321' } });
  check('withdrawal over winning balance refused', overW.status === 400 && overW.json.code === 'INSUFFICIENT_BALANCE', String(overW.json.code));

  const wd1 = await api('/wallet/withdrawals', { token: richToken, body: { amount: 800, method: 'EASYPAISA', accountName: 'Rich Tester', accountNumber: '0345 1234567' } });
  check('withdrawal request → PENDING', wd1.json.success === true && wd1.json.data.withdrawal.status === 'PENDING', JSON.stringify(wd1.json.message ?? wd1.json.code));
  const wd1Id = wd1.json.data.withdrawal.id as string;

  const winningNow = Number((await db.query(`SELECT "winningBalance" FROM wallets WHERE "userId"=$1`, [richId])).rows[0].winningBalance);
  check('withdrawal debited immediately (holding)', winningNow === richWinning - 800, `winning=${winningNow}`);

  const chainSkip = await api(`/admin/withdrawals/${wd1Id}/review`, { token: adminToken, body: { action: 'PAID', paidReference: 'PAY-1' } });
  check('cannot skip the approval chain', chainSkip.status === 409, String(chainSkip.json.code));

  await api(`/admin/withdrawals/${wd1Id}/review`, { token: adminToken, body: { action: 'APPROVE' } });
  const proc = await api(`/admin/withdrawals/${wd1Id}/review`, { token: adminToken, body: { action: 'PROCESS' } });
  check('chain PENDING → APPROVED → PROCESSING', proc.json.success === true && proc.json.data.status === 'PROCESSING');

  const paidNoRef = await api(`/admin/withdrawals/${wd1Id}/review`, { token: adminToken, body: { action: 'PAID' } });
  check('PAID requires a payout reference', paidNoRef.status === 400);

  const paid = await api(`/admin/withdrawals/${wd1Id}/review`, { token: adminToken, body: { action: 'PAID', paidReference: 'EWP-991199' } });
  check('chain completes → PAID', paid.json.success === true && paid.json.data.status === 'PAID');
  const winningAfterPaid = Number((await db.query(`SELECT "winningBalance" FROM wallets WHERE "userId"=$1`, [richId])).rows[0].winningBalance);
  check('PAID does not change balances again', winningAfterPaid === winningNow);

  // Reject path — reversal credited back.
  const wd2 = await api('/wallet/withdrawals', { token: richToken, body: { amount: 200, method: 'BANK_TRANSFER', accountName: 'Rich Tester', accountNumber: 'PK36MEZN0001234567890123' } });
  const wd2Id = wd2.json.data.withdrawal.id as string;
  const rej = await api(`/admin/withdrawals/${wd2Id}/review`, { token: adminToken, body: { action: 'REJECT', note: 'Name mismatch' } });
  const winningAfterRej = Number((await db.query(`SELECT "winningBalance" FROM wallets WHERE "userId"=$1`, [richId])).rows[0].winningBalance);
  check('rejected withdrawal reverses the holding', rej.json.success === true && winningAfterRej === winningAfterPaid, `winning=${winningAfterRej} (net of the 200 debit + reversal)`);
  const reversal = await db.query(
    `SELECT type FROM wallet_transactions WHERE "entityType"='Withdrawal' AND "entityId"=$1 AND type='WITHDRAWAL_REVERSAL'`,
    [wd2Id],
  );
  check('reversal ledger entry written', reversal.rows.length === 1);

  // Player cancel path.
  const wd3 = await api('/wallet/withdrawals', { token: richToken, body: { amount: 100, method: 'JAZZCASH', accountName: 'Rich Tester', accountNumber: '03001234567' } });
  const wd3Id = wd3.json.data.withdrawal.id as string;
  const cancel = await api(`/wallet/withdrawals/${wd3Id}/cancel`, { token: richToken, method: 'POST' });
  const winningAfterCancel = Number((await db.query(`SELECT "winningBalance" FROM wallets WHERE "userId"=$1`, [richId])).rows[0].winningBalance);
  check('player cancel releases pending withdrawal', cancel.json.success === true && winningAfterCancel === winningAfterRej, `winning=${winningAfterCancel} (net of the 100 debit + release)`);

  const cancelPaid = await api(`/wallet/withdrawals/${wd1Id}/cancel`, { token: richToken, method: 'POST' });
  check('cannot cancel a PAID withdrawal', cancelPaid.status === 400);

  // ---- 5. COIN CONVERSION -------------------------------------------------------
  const convert = await api('/wallet/coins/convert', { token: richToken, body: { amount: 100 } });
  check('coin conversion succeeds at seeded rate', convert.json.success === true && Number(convert.json.data.coinsCredited) === 100, JSON.stringify(convert.json.data ?? convert.json.code));
  const wNow = (await db.query(`SELECT "cashBalance", "coinBalance" FROM wallets WHERE "userId"=$1`, [richId])).rows[0];
  check('conversion moved cash→coins atomically', Number(wNow.cashBalance) === cashAfter - 100 && Number(wNow.coinBalance) === 100, `cash=${wNow.cashBalance} coins=${wNow.coinBalance}`);

  const overConvert = await api('/wallet/coins/convert', { token: poorToken, body: { amount: 999999 } });
  check('conversion cannot overdraw cash', overConvert.status === 400 && overConvert.json.code === 'INSUFFICIENT_BALANCE');

  // ---- 6. TRANSACTIONS API -------------------------------------------------------
  const txAll = await api('/wallet/transactions?pageSize=100', { token: richToken });
  const txData = txAll.json.data;
  check('transactions list returns ledger rows', txData.total >= 6, `total=${txData.total}`);
  const expectedIn = 750 + 200 + 100 + 100; // deposit + reject reversal + cancel reversal + coins credit
  const expectedOut = 800 + 200 + 100 + 100; // paid wd + rejected wd + cancelled wd + cash conversion leg
  check('totals: in/out/net computed over filter', Math.abs(txData.totalIn - expectedIn) < 0.01 && Math.abs(txData.totalOut - expectedOut) < 0.01 && Math.abs(txData.net - (expectedIn - expectedOut)) < 0.01, `in=${txData.totalIn} out=${txData.totalOut}`);

  const txDeposits = await api('/wallet/transactions?type=DEPOSIT', { token: richToken });
  check('type filter works', txDeposits.json.data.total === 1 && txDeposits.json.data.items[0].type === 'DEPOSIT');

  const csv = await api('/wallet/transactions?format=csv', { token: richToken, raw: true });
  check('CSV export with headers', csv.status === 200 && csv.type.includes('text/csv') && csv.text.startsWith('Date,Type,Bucket'));

  // ---- 7. OWNERSHIP + AUDIT -------------------------------------------------------
  const shot = await api(`/wallet/deposits/${dep1Id}/screenshot`, { token: richToken, raw: true });
  check('owner can fetch deposit screenshot', shot.status === 200 && shot.type.includes('image/png'));
  const shotOther = await api(`/wallet/deposits/${dep1Id}/screenshot`, { token: otherToken, raw: true });
  check('other players cannot fetch screenshot', shotOther.status === 403);
  const shotAdmin = await api(`/wallet/deposits/${dep1Id}/screenshot`, { token: adminToken, raw: true });
  check('admin can fetch screenshot for review', shotAdmin.status === 200);

  const audits = await db.query(
    `SELECT count(*) n FROM audit_logs WHERE action IN ('DEPOSIT_SUBMITTED','DEPOSIT_APPROVED','DEPOSIT_REJECTED','WITHDRAWAL_REQUESTED','WITHDRAWAL_PAID','WITHDRAWAL_REJECTED','WITHDRAWAL_CANCELLED')`,
  );
  check('every financial action audited', Number(audits.rows[0].n) >= 7, `rows=${audits.rows[0].n}`);

  // ---- 8. LEDGER INTEGRITY ---------------------------------------------------------
  const chain = await db.query(
    `SELECT count(*) bad FROM wallet_transactions
     WHERE ("direction"='CREDIT' AND "balanceAfter" <> "balanceBefore" + amount)
        OR ("direction"='DEBIT'  AND "balanceAfter" <> "balanceBefore" - amount)`,
  );
  const neg = await db.query(`SELECT count(*) n FROM wallet_transactions WHERE "balanceAfter" < 0`);
  check('ledger chain consistent across ALL rows', Number(chain.rows[0].bad) === 0);
  check('no negative balances anywhere', Number(neg.rows[0].n) === 0);

  const mirrorRow = (await db.query(
    `SELECT w."cashBalance", w."winningBalance", w."coinBalance" FROM wallets w WHERE w."userId"=$1`,
    [richId],
  )).rows[0];
  const lastOf = async (bucket: string) => Number((await db.query(
    `SELECT "balanceAfter" FROM wallet_transactions WHERE "userId"=$1 AND bucket=$2 ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
    [richId, bucket],
  )).rows[0]?.balanceAfter ?? 0);
  check('wallet mirrors match ledger finals (test user)',
    Number(mirrorRow.cashBalance) === (await lastOf('CASH')) &&
    Number(mirrorRow.winningBalance) === (await lastOf('WINNING')) &&
    Number(mirrorRow.coinBalance) === (await lastOf('COINS')),
    `cash=${mirrorRow.cashBalance}/${await lastOf('CASH')} winning=${mirrorRow.winningBalance}/${await lastOf('WINNING')}`);

  // ---- cleanup ------------------------------------------------------------------
  const depIds = await db.query(`SELECT id FROM deposits WHERE "userId"=ANY($1)`, [[richId, poorId]]);
  const wdIds = await db.query(`SELECT id FROM withdrawals WHERE "userId"=ANY($1)`, [[richId, poorId]]);
  await db.query(`DELETE FROM audit_logs WHERE ("entity"='Deposit' AND "entityId"=ANY($1)) OR ("entity"='Withdrawal' AND "entityId"=ANY($2)) OR ("actorId"=ANY($3) AND entity='Wallet')`, [depIds.rows.map((r) => r.id), wdIds.rows.map((r) => r.id), [richId, poorId, otherId]]);
  await db.query(`DELETE FROM users WHERE username LIKE 'wtest_%'`);
  await db.end();

  console.log(failures === 0 ? '\n🏆 All wallet & payment checks passed.' : `\n💥 ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
