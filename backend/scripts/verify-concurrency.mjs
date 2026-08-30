/* eslint-disable no-console */
// =============================================================================
// Concurrency / financial-integrity verification (dev only).
//
//   npm run verify:concurrency      (backend server + seeded database running)
//
// Fires realistic bursts of simultaneous requests at every money path and then
// asserts the invariants against the DATABASE rather than the HTTP statuses —
// the embedded single-writer dev PostgreSQL (PGlite) can surface a driver
// error after a successful commit, so the ledger is the source of truth for
// "how many operations actually went through".
//
// Proves:
//   1. No double spending — 5 concurrent withdrawals over one balance.
//   2. Idempotency — 5 retries with one key create ONE withdrawal.
//   3. Transfers are atomic and conserve money under concurrency.
//   4. Two admins cannot approve the same deposit twice.
//   5. The whole ledger chains correctly and never goes negative.
// =============================================================================
import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs';
const API='http://localhost:4000/api';
const DB='postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const S='dev-access-secret-0123456789abcdefghijklmnop';
let pass=0,fail=0;const ck=(n,c,x)=>{console.log(`${c?'✅':'❌'} ${n}${x?` — ${x}`:''}`);c?pass++:fail++;};
const tok=(id,u,r='USER')=>jwt.sign({sub:id,role:r,username:u},S,{expiresIn:'15m'});
async function api(p,{token,body,method}={}){const h={'content-type':'application/json','x-clutchnex-client':'web'};if(token)h.authorization=`Bearer ${token}`;
 const r=await fetch(API+p,{method:method??(body?'POST':'GET'),headers:h,body:body?JSON.stringify(body):undefined});return{s:r.status,b:await r.json().catch(()=>({}))};}
const db=new pg.Client({connectionString:DB});await db.connect();
const R=Date.now().toString(36);
async function mkUser(n,cash=0,win=0){const r=await db.query(`INSERT INTO users (id,username,email,"passwordHash",role,status,"isVerified","referralCode","createdAt","updatedAt") VALUES (gen_random_uuid()::text,$1,$1||'@example.com',$2,'USER','ACTIVE',true,'CC-'||substr(md5($1),1,6),now(),now()) RETURNING id`,[n,bcrypt.hashSync('Conc@12345',4)]);
 const id=r.rows[0].id;await db.query(`INSERT INTO wallets (id,"userId","cashBalance","winningBalance","createdAt","updatedAt") VALUES (gen_random_uuid()::text,$1,$2,$3,now(),now())`,[id,cash,win]);
 await db.query(`INSERT INTO user_profiles (id,"userId","fullName","freeFireUID","freeFireIGN","createdAt","updatedAt") VALUES (gen_random_uuid()::text,$1,$1,substr(md5($1),1,10),$1,now(),now())`,[id]);return id;}

console.log('\n— 1. Concurrent withdrawals (double-spend) —');
const w=await mkUser(`cc${R}w`,0,1000); const wt=tok(w,`cc${R}w`);
const wds=await Promise.all(Array.from({length:5},()=>api('/wallet/withdrawals',{token:wt,body:{amount:800,method:'EASYPAISA',accountName:'Test Holder',accountNumber:'03001234567'}})));
// Assert on the DATABASE, not the HTTP status: the embedded single-writer dev
// PostgreSQL (PGlite) can surface a driver error after a successful commit, so
// the ledger is the source of truth for "how many actually went through".
const wRows=Number((await db.query(`SELECT count(*) n FROM withdrawals WHERE "userId"=$1`,[w])).rows[0].n);
const wDeb=Number((await db.query(`SELECT COALESCE(SUM(amount),0) s FROM wallet_transactions WHERE "userId"=$1 AND type='WITHDRAWAL' AND direction='DEBIT'`,[w])).rows[0].s);
const bal=(await db.query(`SELECT "cashBalance"+"winningBalance" t FROM wallets WHERE "userId"=$1`,[w])).rows[0].t;
ck('5 concurrent 800-PKR withdrawals from a 1000 balance → exactly one wins',wRows===1&&wDeb===800,`withdrawals=${wRows} debited=${wDeb} statuses=${wds.map(r=>r.s).join(',')}`);
ck('balance never goes negative',Number(bal)>=0,`balance=${bal}`);

console.log('\n— 2. Idempotent withdrawal (double-click / retry) —');
const w2=await mkUser(`cc${R}i`,0,5000); const w2t=tok(w2,`cc${R}i`);
const key=`idem-${R}`;
const dbl=await Promise.all(Array.from({length:5},()=>api('/wallet/withdrawals',{token:w2t,body:{amount:500,method:'EASYPAISA',accountName:'Test Holder',accountNumber:'03001234567',requestId:key}})));
const rows=(await db.query(`SELECT count(*) n FROM withdrawals WHERE "userId"=$1`,[w2])).rows[0].n;
ck('5 retries with the same idempotency key → ONE withdrawal',Number(rows)===1,`rows=${rows} statuses=${dbl.map(r=>r.s).join(',')}`);
const debited=(await db.query(`SELECT COALESCE(SUM(amount),0) s FROM wallet_transactions WHERE "userId"=$1 AND type='WITHDRAWAL' AND direction='DEBIT'`,[w2])).rows[0].s;
ck('charged exactly once',Number(debited)===500,`debited=${debited}`);

console.log('\n— 3. Concurrent transfers —');
const sA=await mkUser(`cc${R}a`,1000,0), sB=await mkUser(`cc${R}b`,0,0); // transfers move CASH
const at=tok(sA,`cc${R}a`);
const tr=await Promise.all(Array.from({length:5},()=>api('/wallet/transfers',{token:at,body:{recipientUsername:`cc${R}b`,amount:600,requestId:crypto.randomUUID()}})));
const ab=Number((await db.query(`SELECT "cashBalance"+"winningBalance" t FROM wallets WHERE "userId"=$1`,[sA])).rows[0].t);
const bb=Number((await db.query(`SELECT "cashBalance"+"winningBalance" t FROM wallets WHERE "userId"=$1`,[sB])).rows[0].t);
ck('sender+receiver conserve money (no minted PKR)',ab+bb===1000,`sender=${ab} receiver=${bb} statuses=${tr.map(r=>r.s).join(',')}`);
ck('sender never negative',ab>=0,`sender=${ab}`);
const trRows=Number((await db.query(`SELECT count(*) n FROM wallet_transfers WHERE "senderId"=$1`,[sA])).rows[0].n);
ck('at most one 600-PKR transfer clears from a 1000 balance',trRows===1&&bb===600,`transfers=${trRows} receiver=${bb}`);
// idempotency: same requestId five times
const sC=await mkUser(`cc${R}c`,5000,0), sD=await mkUser(`cc${R}e`,0,0);
const ct=tok(sC,`cc${R}c`); const ikey=crypto.randomUUID();
const idem=await Promise.all(Array.from({length:5},()=>api('/wallet/transfers',{token:ct,body:{recipientUsername:`cc${R}e`,amount:400,requestId:ikey}})));
const idemRows=Number((await db.query(`SELECT count(*) n FROM wallet_transfers WHERE "senderId"=$1`,[sC])).rows[0].n);
const dBal=Number((await db.query(`SELECT "cashBalance"+"winningBalance" t FROM wallets WHERE "userId"=$1`,[sD])).rows[0].t);
ck('5 transfer retries with one idempotency key → ONE transfer',idemRows===1&&dBal===400,`transfers=${idemRows} recipient=${dBal} statuses=${idem.map(r=>r.s).join(',')}`);

console.log('\n— 4. Double deposit approval —');
const dp=await mkUser(`cc${R}d`,0,0);
const admRow=(await db.query(`SELECT id,username FROM users WHERE role IN ('ADMIN','SUPER_ADMIN') AND status='ACTIVE' LIMIT 1`)).rows[0];
const admT=tok(admRow.id,admRow.username,'ADMIN');
const depId=(await db.query(`INSERT INTO deposits (id,"userId",amount,method,"transactionId",screenshot,"senderName","senderAccount",status,"createdAt","updatedAt") VALUES (gen_random_uuid()::text,$1,1000,'EASYPAISA',$2,'deposits/x.png','Test Sender','03001234567','PENDING',now(),now()) RETURNING id`,[dp,`TID${R}`])).rows[0].id;
const aps=await Promise.all(Array.from({length:8},()=>api(`/admin/deposits/${depId}/review`,{token:admT,body:{action:'APPROVE'}})));
const okA=aps.filter(r=>r.s===200).length;
const credited=Number((await db.query(`SELECT COALESCE(SUM(amount),0) s FROM wallet_transactions WHERE "userId"=$1 AND type='DEPOSIT' AND direction='CREDIT'`,[dp])).rows[0].s);
ck('8 admins approving the same deposit → approved once',okA===1,`ok=${okA} statuses=${aps.map(r=>r.s).join(',')}`);
ck('credited exactly PKR 1000 (no double credit)',credited===1000,`credited=${credited}`);

console.log('\n— 5. Ledger integrity —');
const badChain=(await db.query(`SELECT count(*) n FROM wallet_transactions WHERE (direction='CREDIT' AND "balanceAfter"<>"balanceBefore"+amount) OR (direction='DEBIT' AND "balanceAfter"<>"balanceBefore"-amount)`)).rows[0].n;
ck('every ledger row chains correctly',Number(badChain)===0,`bad=${badChain}`);
const negs=(await db.query(`SELECT count(*) n FROM wallet_transactions WHERE "balanceAfter"<0`)).rows[0].n;
ck('no negative balance anywhere in the ledger',Number(negs)===0,`neg=${negs}`);

await db.query(`DELETE FROM users WHERE username LIKE $1`,[`cc${R}%`]);
await db.end();
console.log(`\n${fail===0?'🏆':'💥'} ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
