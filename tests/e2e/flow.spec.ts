import { expect, test } from '@playwright/test';
import { dismissTutorial, legalPour, mg, setSpeedInstant, solveLevel, waitForGame } from './helpers';

test('catalog -> game -> pours -> hint -> undo -> restart -> win -> next -> catalog', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-title')).toContainText('MiniGames');
  const suffix = page.viewportSize()?.width === 390 ? 'mobile' : 'desktop';
  await page.screenshot({ path: `evidence/screenshots/catalog-${suffix}.png` });

  // Open Water Sort from the catalog card.
  await page.locator('.game-card .btn.primary').click();
  await waitForGame(page, 1);
  await dismissTutorial(page);
  await setSpeedInstant(page);

  const s0 = await mg(page);
  expect(s0.tubeCount).toBe(5);
  expect(s0.win).toBe(false);

  // Two taps select then pour: keyboard drives the same handler as canvas taps.
  await legalPour(page);
  let st = await mg(page);
  expect(st.historyLen).toBe(1);

  // Hint highlights two tubes and toasts a labeled suggestion.
  await page.locator('.bottombar .action-btn').nth(2).click();
  await expect(page.locator('.toast.show').first()).toContainText(/Подсказка|Hint/);

  // Undo reverts the pour.
  await page.locator('.bottombar .action-btn').nth(0).click();
  st = await mg(page);
  expect(st.historyLen).toBe(0);

  // Restart with confirmation on a dirty level.
  await legalPour(page);
  await page.locator('.bottombar .action-btn').nth(1).click();
  await page.locator('.modal-overlay.confirm .btn.primary').click();
  st = await mg(page);
  expect(st.historyLen).toBe(0);

  // Solve to a real win through the certified path.
  await solveLevel(page, 1);
  await expect(page.locator('.modal-overlay.win')).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: `evidence/screenshots/win-${suffix}.png` });

  // Next level loads fresh.
  await page.locator('.modal-overlay.win .btn.primary').click();
  await waitForGame(page, 2);
  await dismissTutorial(page);
  expect((await mg(page)).historyLen).toBe(0);

  // Back to catalog: Continue card appears.
  await page.locator('.topbar .back-wrap .icon-btn').click();
  await expect(page.locator('.continue-card')).toBeVisible();
});
