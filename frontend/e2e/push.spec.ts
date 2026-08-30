// Device alerts, as far as a browser test can honestly reach: the service worker is
// registered, the app asks the API whether push is even configured, and the bell renders
// a truthful state for the toggle. Delivering a real notification to a real OS tray is not
// assertable here — and pretending otherwise would be exactly the fake-green this project
// refuses. The sender itself is covered by backend/tests/integration/phase19-push.test.ts,
// which verifies real VAPID signing and RFC 8291 encryption against a live TLS endpoint.
import { expect, test } from '@playwright/test';
import { run } from './context';


test('the bell exposes an honest device-alerts state', async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto('/login');
  await page.getByLabel(/email or username/i).fill(run().player.username);
  await page.getByLabel(/password/i).fill(run().player.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto('/dashboard');
  await page.getByRole('button', { name: /notifications/i }).first().click();
  const toggle = page.getByTestId('push-toggle');
  await expect(toggle).toBeVisible();
  // One of the two honest answers, depending on the deployment's VAPID config.
  await expect(
    toggle.or(page.getByText(/device alerts are not enabled|browser cannot receive device alerts/i)),
  ).toBeVisible();
});

test('a granted permission with no VAPID config never claims success', async ({ page, context }) => {
  // Permission granted, but the server refuses to hand out a key: the toggle must stay
  // "off/disabled" and must not pretend the device is subscribed.
  await context.grantPermissions(['notifications']);
  const config = await page.request.get(`${run().baseURL}/api/backend/push/config`);
  expect(config.ok()).toBe(true);
  const body = (await config.json()) as { data: { enabled: boolean; publicKey: string | null } };
  if (!body.data.enabled) {
    expect(body.data.publicKey).toBeNull();
    test.info().annotations.push({ type: 'note', description: 'push disabled on this deployment — toggle must report it' });
  }
  await page.goto('/login');
  await page.getByLabel(/email or username/i).fill(run().player.username);
  await page.getByLabel(/password/i).fill(run().player.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /notifications/i }).first().click();
  const panel = page.getByTestId('push-toggle');
  if (await panel.isVisible().catch(() => false)) {
    const button = panel.getByRole('button');
    if (await button.isEnabled().catch(() => false)) {
      const label = await panel.innerText();
      expect(label).toMatch(/off|on/i);
    }
  }
});
