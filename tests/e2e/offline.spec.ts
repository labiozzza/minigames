import { expect, test } from '@playwright/test';
import { dismissTutorial, legalPour, mg, setSpeedInstant, waitForGame } from './helpers';

test('production PWA works fully offline after first load', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.app-title')).toBeVisible();
  // Let the service worker install and precache.
  await page.evaluate(() => navigator.serviceWorker?.ready.then(() => true).catch(() => false));
  await page.waitForTimeout(4000);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.app-title')).toContainText('MiniGames', { timeout: 20000 });

  // Full game offline: open, pour, persist across reload.
  await page.locator('.game-card .btn.primary').click();
  await waitForGame(page, 1);
  await dismissTutorial(page);
  await setSpeedInstant(page);
  await legalPour(page);
  expect((await mg(page)).historyLen).toBe(1);

  // Export works offline and produces a real download.
  await page.locator('.topbar .top-actions .icon-btn').nth(1).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('button', { name: /Сохранить прогресс|Back up progress/ }).click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();

  // Reload offline keeps the unfinished level (no lost moves).
  await page.reload();
  await expect(page.locator('.app-title')).toContainText('MiniGames', { timeout: 20000 });
  await page.locator('.game-card .btn.primary').click();
  await waitForGame(page, 1);
  await dismissTutorial(page);
  expect((await mg(page)).historyLen).toBe(1);
  await context.setOffline(false);
});
