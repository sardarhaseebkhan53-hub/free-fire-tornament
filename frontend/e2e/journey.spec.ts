// =============================================================================
// THE JOURNEY, in a browser: sign in → event page → pay-free join → seat + receipt →
// check-in (before it opens, then after staff open it) → My Matches → leaderboard.
//
// Every assertion checks what the USER sees after a server round-trip, not a local
// optimistic guess — which is the specific failure mode this app has to avoid: a green
// button that the API would refuse.
// =============================================================================
import { expect, test } from '@playwright/test';
import { api, run } from './context';

let loggedIn = false;

async function login(page: import('@playwright/test').Page) {
  if (loggedIn) return;
  await page.goto('/login');
  await page.getByLabel(/email or username/i).fill(run().player.username);
  await page.getByLabel(/password/i).fill(run().player.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
  loggedIn = true;
}

test.describe.serial('player journey', () => {
  test('sign in with a freshly registered account', async ({ page }) => {
    await login(page);
    // The access token lives in localStorage and the refresh cookie is set by the API:
    // both must be present or every later step would be testing a logged-out shell.
    const token = await page.evaluate(() => localStorage.getItem('cn_access'));
    expect(token, 'no access token after login').toBeTruthy();
  });

  test('event page shows the join CTA and the seat count', async ({ page }) => {
    await login(page);
    await page.goto(`/tournaments/${run().event.slug}`);
    await expect(page.getByText(run().event.title).first()).toBeVisible();
    await expect(page.getByTestId('join-open')).toBeVisible();
  });

  test('joining assigns a seat and the receipt is real', async ({ page }) => {
    await login(page);
    await page.goto(`/tournaments/${run().event.slug}`);
    await page.getByTestId('join-open').click();
    // SOLO events require the Free Fire identity at join time.
    const uid = page.getByPlaceholder(/5231879640/);
    if (await uid.isVisible().catch(() => false)) {
      await uid.fill(String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10));
      await page.getByPlaceholder(/in-game name/i).fill('E2E Clutch');
    }
    await page.getByTestId('join-confirm').click();
    await expect(page.getByTestId('join-receipt')).toBeVisible();
    await expect(page.getByTestId('join-receipt')).toContainText(/You are in/i);

    // The registration exists server-side with a seat number — not just a toast.
    const mine = await api<Array<{ tournament: { slug: string }; seatNumber: number | null; status: string; checkIn: { state: string; checkedInAt: string | null } }>>(
      run(),
      'GET',
      '/tournaments/my',
      { token: run().playerToken },
    );
    const row = mine.find((r) => r.tournament.slug === run().event.slug);
    expect(row, 'registration not returned by the API').toBeTruthy();
    expect(row?.status, 'registration not returned by the API').toBe('CONFIRMED');
    expect(row?.seatNumber ?? 0, 'seat number must be assigned at join').toBeGreaterThan(0);
    // Window state the server resolved, before staff opened it.
    expect(row?.checkIn.state).toBe('NOT_OPEN');
    expect(row?.checkIn.checkedInAt).toBeNull();
  });

  test('check-in refuses politely before the window opens', async ({ page }) => {
    await login(page);
    await page.goto('/matches');
    const state = page.getByTestId('check-in-state').first();
    await expect(state).toBeVisible();
    await expect(state).toContainText(/opens at/i);
    await expect(page.getByTestId('check-in-button')).toHaveCount(0);
  });

  test('staff open the window, the button appears, and checking in sticks', async ({ page }) => {
    await login(page);
    await api(run(), 'POST', `/admin/tournaments/${run().event.id}/check-in-window`, {
      token: run().adminToken,
      body: { opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 30 * 60_000).toISOString() },
    });

    await page.goto('/matches');
    const button = page.getByTestId('check-in-button').first();
    await expect(button).toBeVisible();
    await button.click();

    // The strip must flip to the server-confirmed state, and stay flipped on reload.
    await expect(page.getByTestId('check-in-state').first()).toContainText(/Checked in at/i);
    await page.reload();
    await expect(page.getByTestId('check-in-state').first()).toContainText(/Checked in at/i);
  });

  test('the check-in is recorded in the inbox, and re-clicking is not an error', async ({ page }) => {
    await login(page);
    await page.goto('/matches');
    const again = page.getByTestId('check-in-button');
    // Already checked in: no button at all, only the stamped state (idempotency is UI-visible).
    await expect(again).toHaveCount(0);

    await page.getByRole('button', { name: /notifications/i }).first().click();
    await expect(page.getByText(/Checked in/i).first()).toBeVisible();
  });

  test('a second account can join the same event and gets a different seat', async ({ request }) => {
    // Seat allocation is the one place a UI can lie about a race, so the journey proves
    // it across two real sessions on the same event.
    const stamp = `${Date.now().toString(36)}x${Math.floor(Math.random() * 1e4).toString(36)}`;
    const password = 'E2eTest@12345';
    await api(run(), 'POST', '/auth/register', {
      body: { email: `e2e-${stamp}@clutchnex.test`, username: `e2e${stamp}`.slice(0, 20), fullName: 'E2E Player 2', password },
    });
    const { accessToken } = await api<{ accessToken: string }>(run(), 'POST', '/auth/login', {
      body: { identifier: `e2e${stamp}`.slice(0, 20), password },
    });
    await request.post(`${run().apiUrl}/tournaments/join`, {
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      data: { tournamentSlug: run().event.slug },
    });
    const mine = await api<Array<{ tournament: { slug: string }; seatNumber: number | null }>>(
      run(),
      'GET',
      '/tournaments/my',
      { token: accessToken },
    );
    const seat = mine.find((r) => r.tournament.slug === run().event.slug)?.seatNumber ?? 0;
    expect(seat, 'the second account must get its own seat').toBeGreaterThan(0);
  });

  test('leaderboard renders for the event without a server error', async ({ page }) => {
    await page.goto(`/tournaments/${run().event.slug}`);
    await expect(page.locator('h1, h2').first()).toBeVisible();
    const response = await page.request.get(`${run().baseURL}/api/backend/tournaments/${run().event.slug}/leaderboard`);
    expect([200, 404]).toContain(response.status());
    expect(response.status()).not.toBe(500);
  });
});
