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
// Overridable so the SAME proofs can run against a different target — most
// importantly a real PostgreSQL (npm run db:real + scripts/real-db.mjs) instead of
// the embedded single-writer dev engine. Defaults are the dev stack, unchanged.
const API=process.env.CONCURRENCY_API_URL ?? 'http://localhost:4000/api';
const DB=process.env.CONCURRENCY_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const S=process.env.CONCURRENCY_JWT_SECRET ?? 'dev-access-secret-0123456789abcdefghijklmnop';
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

console.log('\n— 6. 100-way join surge (capacity + no 5xx under a real burst) —');
// The tournament opens, 100 players press JOIN at the same moment for 10 seats.
// Three separate guarantees, all asserted on the database: capacity is exact,
// money is charged once per seat, and NOBODY gets a 5xx — a full event must
// answer the other 90 with a reason they can act on, not an internal error.
const FEE = 100, SEATS = 10, CROWD = 100;
const slugJ = `cc-${R}-surge`;
const tRow = (await db.query(
  `INSERT INTO tournaments (id,title,slug,type,status,"maxSlots","registeredSlots","minSlotsToStart","numWinners","entryFeePerPlayer","prizePool","platformFee","bonusPercent","refundPercent","pointsPerKill","bonusPoints","penaltyPoints","game","isVerified","isFeatured","startTime","registrationDeadline","createdAt","updatedAt")
   VALUES (gen_random_uuid()::text,$1,$2,'SOLO','REGISTRATION_OPEN',$3,0,1,4,$4,1000,0,0,100,1,0,0,'FREE_FIRE',true,false,now() + interval '2 hours',now() + interval '1 hour',now(),now())
   RETURNING id`,[`Surge Cup ${R}`,slugJ,SEATS,FEE])).rows[0];
const crowd = (await db.query(
  `WITH n AS (SELECT gen_random_uuid()::text AS id, 'cc${R}j'||i AS uname FROM generate_series(1,$1) i),
     u AS (INSERT INTO users (id,username,email,"passwordHash",role,status,"isVerified","referralCode","createdAt","updatedAt")
             SELECT id, uname, uname||'@example.com', $2, 'USER','ACTIVE',true,'CC-'||substr(md5(id),1,6),now(),now() FROM n RETURNING id, username),
     w AS (INSERT INTO wallets (id,"userId","cashBalance","winningBalance","createdAt","updatedAt")
             SELECT gen_random_uuid()::text, id, ${FEE * 2}, 0, now(), now() FROM u RETURNING 1),
     pr AS (INSERT INTO user_profiles (id,"userId","fullName","freeFireUID","freeFireIGN","createdAt","updatedAt")
             SELECT gen_random_uuid()::text, id, username, '9'||lpad((row_number() OVER (ORDER BY username))::text,9,'0'), username, now(), now() FROM u RETURNING 1)
   SELECT id, username FROM u`,[CROWD,bcrypt.hashSync('Conc@12345',4)])).rows;
// Each simulated player arrives from its own address, the way the Next.js proxy
// presents them — so no two players share a rate-limit bucket, and the burst
// tests the join engine rather than the limiter.
const surge = await Promise.all(crowd.map(async (u,i)=>{
  const h={'content-type':'application/json','x-clutchnex-client':'web',authorization:`Bearer ${tok(u.id,u.username)}`,'x-forwarded-for':`198.51.${(i>>8)&255}.${i&255}`};
  const r=await fetch(`${API}/tournaments/join`,{method:'POST',headers:h,body:JSON.stringify({tournamentSlug:slugJ})});
  return {s:r.status,b:await r.json().catch(()=>({}))};
}));
const regRows=await db.query(`SELECT count(*) n, count(DISTINCT "seatNumber") seats, min("seatNumber") mn, max("seatNumber") mx FROM tournament_registrations WHERE "tournamentId"=$1 AND status='CONFIRMED'`,[tRow.id]);
const rg=regRows.rows[0];
const slots=Number((await db.query(`SELECT "registeredSlots" n FROM tournaments WHERE id=$1`,[tRow.id])).rows[0].n);
ck(`${CROWD} concurrent joins for ${SEATS} seats → exactly ${SEATS} registered`,Number(rg.n)===SEATS&&Number(rg.seats)===SEATS&&Number(rg.mn)===1&&Number(rg.mx)===SEATS&&slots===SEATS,
  `registrations=${rg.n} seats=${rg.seats} range=${rg.mn}-${rg.mx} counter=${slots}`);
// The join ledger rows point at the REGISTRATION, not the tournament, so scope by
// the surge crowd: 10 seats means exactly 10 entry-fee debits for these users.
const surgeIds=`(SELECT id FROM users WHERE username LIKE 'cc${R}j%')`;
const feeRows=(await db.query(`SELECT count(*) n, COALESCE(SUM(amount),0) s FROM wallet_transactions WHERE type='ENTRY_FEE' AND direction='DEBIT' AND \"userId\" IN ${surgeIds}`)).rows[0];
const perUser=(await db.query(`SELECT count(*) n FROM (SELECT \"userId\" FROM wallet_transactions WHERE type='ENTRY_FEE' AND direction='DEBIT' AND \"userId\" IN ${surgeIds} GROUP BY \"userId\" HAVING count(*)>1) d`)).rows[0].n;
ck('the entry fee was charged exactly once per seat',Number(feeRows.n)===SEATS&&Number(feeRows.s)===SEATS*FEE&&Number(perUser)===0,`debits=${feeRows.n} total=${feeRows.s} users-charged-twice=${perUser}`);
const cashLeft=Number((await db.query(`SELECT COALESCE(SUM(\"cashBalance\"),0) s FROM wallets WHERE \"userId\" IN ${surgeIds}`)).rows[0].s);
ck('no money was created or lost in the surge',cashLeft===CROWD*FEE*2-SEATS*FEE,`cash=${cashLeft} expected=${CROWD*FEE*2-SEATS*FEE}`);
const refused=surge.filter(r=>r.s!==201);
// 503 SERVICE_BUSY is the DESIGNED answer when the pool is saturated — it is
// retryable and carries Retry-After. What must never happen is a bare 500.
const hard5xx=surge.filter(r=>r.s>=500&&r.s!==503).length;
const busy=surge.filter(r=>r.s===503);
// A saturated pool must degrade, never break: every transient database failure in
// the family (torn socket, 08P01 protocol violation, P2023 "the row I got back
// belongs to another query", P2028 transaction closed, pool exhaustion) is mapped
// by fail() to 503 SERVICE_BUSY + Retry-After. A bare 500 here is always a bug, so
// it is asserted at full 100-way simultaneity, not just in the calm re-drive below.
ck(`a 100-way surge never answers with a bare 500 (${busy.length} requests got a retryable 503 instead)`,hard5xx===0,
  `bare-500=${hard5xx} 503=${busy.length} codes=${[...new Set(refused.map(r=>r.b?.code??String(r.s)))].join('/')}`);
// A client that obeys Retry-After must get in. Re-drive everyone the surge bounced,
// 25 at a time — the shape an opening actually arrives in — and require the SAME
// ten seats, no extra charge, and not one server error.
const bounced=crowd.filter((_,i)=>surge[i].s!==201);
async function storm(list,size){
  const out=new Array(list.length);
  let next=0;
  const worker=async()=>{
    for(;;){
      const i=next++; if(i>=list.length) return;
      const u=list[i];
      const h={'content-type':'application/json','x-clutchnex-client':'web',authorization:`Bearer ${tok(u.id,u.username)}`,'x-forwarded-for':`203.0.113.${(i>>8)&255}.${i&255}`};
      const r=await fetch(`${API}/tournaments/join`,{method:'POST',headers:h,body:JSON.stringify({tournamentSlug:slugJ})});
      out[i]={s:r.status,b:await r.json().catch(()=>({})),retryAfter:r.headers.get('retry-after')};
    }
  };
  await Promise.all(Array.from({length:size},worker));
  return out;
}
// "Obey Retry-After" is the whole point of the header: wait the advertised 2 s
// before re-entering, wave by wave — that is what a correct client does, and it is
// the shape under which the API must never produce a server error.
async function stormWithBackoff(list,size){
  const out=[];
  for(let i=0;i<list.length;i+=size){
    await new Promise((r)=>setTimeout(r,2000));
    out.push(...await storm(list.slice(i,i+size),size));
  }
  return out;
}
const redrive=await stormWithBackoff(bounced,25);
const regAfter=Number((await db.query(`SELECT count(*) n FROM tournament_registrations WHERE "tournamentId"=$1 AND status='CONFIRMED'`,[tRow.id])).rows[0].n);
const feesAfter=Number((await db.query(`SELECT count(*) n FROM wallet_transactions WHERE type='ENTRY_FEE' AND direction='DEBIT' AND "userId" IN ${surgeIds}`)).rows[0].n);
// 503 is the DESIGNED busy answer (asserted on its own below); a 500 is not.
const wave5xx=redrive.filter(r=>r.s>=500&&r.s!==503).length;
const waveBusy=redrive.filter(r=>r.s===503);
ck(`re-drive in waves of 25: still exactly ${SEATS} seats, ${SEATS} fees, zero bare 500s`,regAfter===SEATS&&feesAfter===SEATS&&wave5xx===0,
  `registrations=${regAfter} fees=${feesAfter} 5xx=${wave5xx} 503=${waveBusy.length}`);
ck('every 503 carried a Retry-After a client can obey',[...waveBusy].every(r=>r.retryAfter==='2'),
  `with-header=${waveBusy.filter(r=>r.retryAfter==='2').length}/${waveBusy.length}`);
const dupes=Number((await db.query(`SELECT count(*) n FROM (SELECT "userId" FROM tournament_registrations WHERE "tournamentId"=$1 GROUP BY "userId" HAVING count(*)>1) d`,[tRow.id])).rows[0].n);
ck('no player got a second seat by double-clicking',dupes===0,`dupes=${dupes}`);
await db.query(`DELETE FROM tournament_registrations WHERE "tournamentId"=$1`,[tRow.id]);
await db.query(`DELETE FROM tournaments WHERE id=$1`,[tRow.id]);

console.log('\n— 5. Ledger integrity —');
const badChain=(await db.query(`SELECT count(*) n FROM wallet_transactions WHERE (direction='CREDIT' AND "balanceAfter"<>"balanceBefore"+amount) OR (direction='DEBIT' AND "balanceAfter"<>"balanceBefore"-amount)`)).rows[0].n;
ck('every ledger row chains correctly',Number(badChain)===0,`bad=${badChain}`);
const negs=(await db.query(`SELECT count(*) n FROM wallet_transactions WHERE "balanceAfter"<0`)).rows[0].n;
ck('no negative balance anywhere in the ledger',Number(negs)===0,`neg=${negs}`);

await db.query(`DELETE FROM users WHERE username LIKE $1`,[`cc${R}%`]);
await db.end();
console.log(`\n${fail===0?'🏆':'💥'} ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
