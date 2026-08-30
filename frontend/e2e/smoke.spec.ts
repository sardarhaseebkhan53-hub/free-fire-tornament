// Public pages must render and must not throw in the console. Cheap, and it catches the
// class of failure that unit tests and API suites cannot: a page that builds but crashes
// in the browser, or ships a broken asset/worker path.
import { expect, test } from '@playwright/test';
import { readContext } from './context';

test('home page renders with the live tournament rail', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByRole('link', { name: /tournaments/i }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('service worker is served with the right scope and MIME type', async ({ request }) => {
  const ctx = readContext();
  const res = await request.get(`${ctx.baseURL}/sw.js`);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toMatch(/javascript/i);
  const body = await res.text();
  // The push handlers are what make device alerts work at all; a lost handler means the
  // backend is signing payloads nobody will ever show.
  for (const hook of ["'push'", "'notificationclick'", "'pushsubscriptionchange'"]) {
    expect(body).toContain(hook);
  }
});

test('health of the API the UI talks to', async ({ request }) => {
  const ctx = readContext();
  const res = await request.get(`${ctx.baseURL}/api/backend/health`);
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ data: { database: 'up' } });
});
