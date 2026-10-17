import { expect, test, type Page } from '@playwright/test';

// §15 privacy: telemetry is consent-gated, notifications never auto-prompt.
async function waitApp(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof window.__MG_TEST__ !== 'undefined', null, { timeout: 30000 });
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('.head-actions .icon-btn').last().click({ force: true });
  await expect(page.locator('.settings-form').first()).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
  await page.locator('.modal-overlay.settings .modal-row .btn.primary').last().click({ force: true });
  await expect(page.locator('.modal-overlay.settings')).toHaveCount(0);
}

async function setToggle(page: Page, label: string, on: boolean): Promise<void> {
  const box = page.locator('.setting-row', { hasText: label }).locator('input[type=checkbox]');
  if ((await box.isChecked()) !== on) await box.click({ force: true });
}

function telemetryBody(calls: string[]): Array<{ events: Array<Record<string, unknown>> }> {
  return calls.map((c) => JSON.parse(c) as { events: Array<Record<string, unknown>> });
}

test('analytics is off by default and only sent after explicit consent', async ({ page }) => {
  const posts: string[] = [];
  await page.route('**/telemetry', async (route) => {
    posts.push(route.request().postData() ?? '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  // Wrap Notification.requestPermission before any app script runs.
  await page.addInitScript(() => {
    (window as unknown as { __PERM__: number }).__PERM__ = 0;
    const N = (window as unknown as { Notification?: { requestPermission?: () => Promise<string> } }).Notification;
    if (N && N.requestPermission) {
      const orig = N.requestPermission.bind(N);
      N.requestPermission = () => {
        (window as unknown as { __PERM__: number }).__PERM__ += 1;
        return orig();
      };
    }
  });
  await page.goto('/');
  await waitApp(page);
  await page.waitForTimeout(2500);

  // No consent yet: nothing analytics-shaped was ever sent, and no permission prompt.
  expect(telemetryBody(posts).flatMap((b) => b.events).filter((e) => e.channel === 'analytics')).toHaveLength(0);
  expect(await page.evaluate(() => (window as unknown as { __PERM__: number }).__PERM__)).toBe(0);

  await openSettings(page);
  await setToggle(page, 'Анонимная аналитика', true);
  await closeSettings(page);

  // A subsequent game open produces a consent-tagged analytics event.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: 1 } })));
  await page.waitForFunction(() => typeof window.__PLUMBER__ !== 'undefined', null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const withConsent = telemetryBody(posts);
  const analytics = withConsent.flatMap((b) => b.events).filter((e) => e.channel === 'analytics');
  expect(analytics.length).toBeGreaterThan(0);
  expect(withConsent.some((b) => (b as unknown as { consent?: unknown }).consent !== undefined)).toBe(true);

  // Revoke: further game opens must not add analytics.
  const before = analytics.length;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mg:exit-catalog')));
  await openSettings(page);
  await setToggle(page, 'Анонимная аналитика', false);
  await closeSettings(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: 2 } })));
  await page.waitForTimeout(2500);
  const after = telemetryBody(posts).flatMap((b) => b.events).filter((e) => e.channel === 'analytics').length;
  expect(after).toBe(before);

  // Notifications still never prompted without an explicit button press.
  expect(await page.evaluate(() => (window as unknown as { __PERM__: number }).__PERM__)).toBe(0);
});

test('data rights buttons require a signed-in account', async ({ page }) => {
  await page.goto('/');
  await waitApp(page);
  await openSettings(page);
  const exportBtn = page.getByRole('button', { name: 'Выгрузить мои данные' });
  const eraseBtn = page.getByRole('button', { name: 'Удалить мои данные' });
  await expect(exportBtn).toBeVisible();
  await expect(exportBtn).toBeDisabled();
  await expect(eraseBtn).toBeDisabled();
  await expect(page.getByText('Войдите, чтобы управлять данными аккаунта')).toBeVisible();
});
