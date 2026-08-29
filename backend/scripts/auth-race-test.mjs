/* Auth session race + rotation verification (dev only, no secrets logged). */
const BASE = process.env.BASE ?? 'http://localhost:4000';

function cookieOf(res) {
  const sc = res.headers.getSetCookie?.() ?? [];
  const c = sc.find((x) => x.startsWith('cn_refresh='));
  if (!c) return null;
  return c.split(';')[0]; // name=value
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-clutchnex-client': 'web' },
    body: JSON.stringify({ identifier: 'areeb_ff', password: 'Player@123' }),
  });
  const j = await res.json();
  return { access: j.data.accessToken, cookie: cookieOf(res) };
}

async function refresh(cookie) {
  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'x-clutchnex-client': 'web', cookie },
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, code: j.code, cookie: cookieOf(res), access: j.data?.accessToken };
}

async function me(access) {
  const res = await fetch(`${BASE}/api/auth/me`, {
    headers: { authorization: `Bearer ${access}` },
  });
  return res.status;
}

async function main() {
  const step = (name) => console.log(`\n▶ ${name}`);

  // 1. Normal refresh cycle
  step('1. login → refresh → new access token works (old JWT stays valid until its own expiry)');
  const s1 = await login();
  console.log('   login ok:', Boolean(s1.access && s1.cookie));
  const r1 = await refresh(s1.cookie);
  console.log('   refresh:', r1.ok ? 'OK (200)' : `FAILED ${r1.status} ${r1.code}`);
  const fresh = await refresh(r1.cookie);
  const freshMe = await me(fresh.access ?? '');
  console.log('   new access token works:', freshMe === 200 ? 'OK' : `unexpected ${freshMe}`);

  // 2. THE RACE — 8 parallel refreshes with the SAME cookie
  step('2. 8 parallel refreshes, same single-use cookie (the reported bug)');
  const s2 = await login();
  const results = await Promise.all(Array.from({ length: 8 }, () => refresh(s2.cookie)));
  const okCount = results.filter((r) => r.ok).length;
  console.log(`   parallel refresh results: ${okCount}/8 succeeded, statuses:`, results.map((r) => r.status).join(','));
  if (okCount === 0) {
    console.log('   ❌ ALL REFRESHES FAILED — session was nuked by the race');
    process.exitCode = 1;
    return;
  }
  // 3. The account must still be alive: use the LAST cookie from the race
  step('3. session survives — refresh with the final cookie works');
  const lastCookie = results.map((r) => r.cookie).filter(Boolean).pop();
  const r3 = await refresh(lastCookie);
  console.log('   refresh with final cookie:', r3.ok ? 'OK' : `FAILED ${r3.status} ${r3.code}`);
  if (!r3.ok) {
    console.log('   ❌ SESSION WAS KILLED BY THE RACE');
    process.exitCode = 1;
  }

  // 4. Old cookie from step 2 is now stale-but-benign: chain should still heal
  step('4. stale cookie (revoked in race) refreshes via grace-chaining');
  const r4 = await refresh(s2.cookie);
  console.log('   stale cookie refresh:', r4.ok ? 'OK (grace chain healed it)' : `FAILED ${r4.status} ${r4.code}`);
}

async function refresh2(cookie) {
  return refresh(cookie);
}

main().catch((e) => {
  console.error('script error:', e.message);
  process.exitCode = 1;
});
