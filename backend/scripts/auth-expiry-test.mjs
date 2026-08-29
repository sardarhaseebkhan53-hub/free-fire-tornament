/* Full expiry simulation: login → wait for access-token expiry → the app's
   refresh flow must keep the user authenticated. Uses BASE=4002 (1m TTL). */
const BASE = process.env.BASE ?? 'http://localhost:4002';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Fresh user to avoid seeded teams/conflicts.
  const uname = `expiry_${Date.now().toString(36)}`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-clutchnex-client': 'web' },
    body: JSON.stringify({
      fullName: 'Expiry Tester', username: uname, email: `${uname}@example.com`,
      password: 'Player@123', confirmPassword: 'Player@123', freeFireUID: String(1000000000 + Math.floor(Math.random() * 9e8)),
    }),
  });
  console.log('register:', (await reg.json()).message);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-clutchnex-client': 'web' },
    body: JSON.stringify({ identifier: uname, password: 'Player@123' }),
  });
  const loginJson = await login.json();
  let cookie = login.headers.getSetCookie?.()[0]?.split(';')[0];
  let access = loginJson.data.accessToken;
  console.log('login OK — access token issued (TTL 1m)');

  // Immediately authed call works.
  let me = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${access}` } });
  console.log('protected call (fresh token):', me.status);

  // Wait past expiry.
  console.log('waiting 70s for access-token expiry…');
  await sleep(70_000);

  me = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${access}` } });
  console.log('protected call (expired token):', me.status, me.status === 401 ? '→ 401 as expected' : '⚠ unexpected');

  // The app's refresh flow: POST /auth/refresh with the cookie.
  const ref = await fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'x-clutchnex-client': 'web', cookie },
  });
  const refJson = await ref.json();
  console.log('refresh after expiry:', ref.status, ref.ok ? '→ new access token issued' : `→ ${refJson.message}`);
  if (!ref.ok) { console.log('❌ USER WOULD BE LOGGED OUT'); process.exitCode = 1; return; }

  access = refJson.data.accessToken;
  // A real client always swaps in the rotated cookie from the response.
  cookie = ref.headers.getSetCookie?.()[0]?.split(';')[0] ?? cookie;
  me = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${access}` } });
  console.log('protected call (refreshed token):', me.status, me.status === 200 ? '→ STILL AUTHENTICATED ✅' : '❌');

  // Manual logout must still work.
  const out = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST', headers: { 'x-clutchnex-client': 'web', cookie },
  });
  console.log('manual logout:', out.status, out.status === 200 ? 'OK ✅' : '⚠');
  const ref2 = await fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST', headers: { 'x-clutchnex-client': 'web', cookie },
  });
  console.log('refresh after logout:', ref2.status, ref2.status === 401 ? '→ correctly rejected (session ended) ✅' : '⚠');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
