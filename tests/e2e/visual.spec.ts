import { expect, test } from '@playwright/test';
import { dismissTutorial, setSpeedInstant, waitForGame } from './helpers';

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `evidence/screenshots/${name}.png` });
}

test('visual matrix: themes, languages, viewports', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'matrix runs on chromium project setup');
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.app-title')).toBeVisible();
  await shot(page, `catalog-${page.viewportSize()?.width === 390 ? 'mobile' : 'desktop'}`);

  // Game level, light RU.
  await page.locator('.game-card', { hasText: 'Water Sort' }).locator('.btn.primary').click();
  await waitForGame(page, 1);
  await dismissTutorial(page);
  await setSpeedInstant(page);
  await shot(page, `level-${page.viewportSize()?.width === 390 ? 'mobile' : 'desktop'}`);

  // Dark theme via settings.
  await page.locator('.topbar .top-actions .icon-btn').nth(1).click();
  await page.locator('.settings-form select').first().selectOption('dark');
  await page.locator('.modal-row .btn.primary').last().click();
  await shot(page, `level-dark-${page.viewportSize()?.width === 390 ? 'mobile' : 'desktop'}`);

  // English language (remounts the game, stays on the same level).
  await page.locator('.topbar .top-actions .icon-btn').nth(1).click();
  await page.locator('.settings-form select').nth(1).selectOption('en');
  await expect(page.locator('.app-title, .level-title').first()).toBeVisible({ timeout: 15000 });
  await shot(page, `level-en-${page.viewportSize()?.width === 390 ? 'mobile' : 'desktop'}`);
});
