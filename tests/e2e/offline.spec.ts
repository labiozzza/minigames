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
  await page.locator('.game-card', { hasText: 'Water Sort' }).locator('.btn.primary').click();
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
  await page.locator('.game-card', { hasText: 'Water Sort' }).locator('.btn.primary').click();
  await waitForGame(page, 1);
  await dismissTutorial(page);
  expect((await mg(page)).historyLen).toBe(1);
  await context.setOffline(false);
});

// §13 versioning / PWA: per-game offline bundle, cache cleanup, deferred updates.
test('§13 plumber downloads its own bundle; freeing it keeps the save', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.app-title')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker?.ready.then(() => true).catch(() => false));
  // Play once online so there is real progress to protect.
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__ !== undefined, null, { timeout: 30000 });
  await page.evaluate(() => (window as unknown as { __PLUMBER__: { solve: () => void; runToEnd: () => void } }).__PLUMBER__.solve());
  await page.evaluate(() => (window as unknown as { __PLUMBER__: { runToEnd: () => void } }).__PLUMBER__.runToEnd());
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { phase: () => string } }).__PLUMBER__?.phase() === 'WON', null, { timeout: 15000 });
  await page.locator('.topbar .back-btn').click();
  const maxBefore = (await page.evaluate(() => (window as unknown as { __MG_TEST__: { save: () => { games: Record<string, { maxLevel: number }> } } }).__MG_TEST__.save())).games['plumber'].maxLevel;

  const st = await page.evaluate(() => (window as unknown as { __MG_TEST__: { precacheGame: (id: string) => Promise<{ ready: boolean } | null> } }).__MG_TEST__.precacheGame('plumber'));
  expect(st?.ready).toBe(true);
  const removed = await page.evaluate(() => (window as unknown as { __MG_TEST__: { deleteGameCache: (id: string) => Promise<string[]> } }).__MG_TEST__.deleteGameCache('plumber'));
  expect(removed.length).toBeGreaterThan(0);
  const after = await page.evaluate(() => (window as unknown as { __MG_TEST__: { offlineStatus: (id: string) => Promise<{ ready: boolean } | null> } }).__MG_TEST__.offlineStatus('plumber'));
  expect(after?.ready).toBe(false);
  // The IndexedDB save is untouched by freeing the asset cache.
  await page.reload();
  const maxAfter = (await page.evaluate(() => (window as unknown as { __MG_TEST__: { save: () => { games: Record<string, { maxLevel: number }> } } }).__MG_TEST__.save())).games['plumber'].maxLevel;
  expect(maxAfter).toBe(maxBefore);
  await context.setOffline(false);
});

test('§13 an SW update is deferred: never applied mid-trial', async ({ page }) => {
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__ !== undefined, null, { timeout: 30000 });
  const idBefore = await page.evaluate(() => (window as unknown as { __PLUMBER__: { puzzleId: () => string } }).__PLUMBER__.puzzleId());
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mg:sw-update')));
  await expect(page.locator('.banner.update')).toBeVisible();
  // The active trial is untouched (no reload, same puzzle keeps ticking).
  await page.waitForTimeout(700);
  const idAfter = await page.evaluate(() => (window as unknown as { __PLUMBER__: { puzzleId: () => string } }).__PLUMBER__.puzzleId());
  expect(idAfter).toBe(idBefore);
});
