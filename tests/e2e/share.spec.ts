import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function openPlumber(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof window.__MG_TEST__ !== 'undefined', null, { timeout: 30000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: 1 } })));
  await page.waitForFunction(() => typeof window.__PLUMBER__ !== 'undefined' && window.__PLUMBER__.sceneReady() === true, null, { timeout: 30000 });
}

async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByRole('button', { name: /Уровни|Levels/ }).click();
  await page.getByRole('button', { name: /Открыть по коду|Enter code/ }).click();
  await page.locator('input.share-input').fill(code);
  await page.getByRole('button', { name: /^Открыть$|^Open$/ }).click();
  await page.waitForFunction(() => window.__PLUMBER__.mode() === 'expert', null, { timeout: 30000 });
}

test('share code P-E-N opens an identical expert level on another client', async ({ browser }) => {
  const ctxA: BrowserContext = await browser.newContext();
  const ctxB: BrowserContext = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto('/');
  await b.goto('/');
  await openPlumber(a);
  await openPlumber(b);

  await enterCode(a, 'P-E-12');
  const first = await a.evaluate(() => ({ mode: window.__PLUMBER__.mode(), level: window.__PLUMBER__.level(), id: window.__PLUMBER__.puzzleId(), sum: window.__PLUMBER__.checksum() }));
  expect(first.mode).toBe('expert');
  expect(first.level).toBe(12);

  await enterCode(b, 'P-E-12');
  const second = await b.evaluate(() => ({ mode: window.__PLUMBER__.mode(), level: window.__PLUMBER__.level(), id: window.__PLUMBER__.puzzleId(), sum: window.__PLUMBER__.checksum() }));
  expect(second).toEqual(first);

  // Opening a friend's shared level must not touch the player's own progress.
  const save = await a.evaluate(() => window.__MG_TEST__.save());
  expect(save.games['plumber'].completed).not.toContain(12);
  expect(save.games['plumber'].active?.levelNumber).toBe(1);

  await ctxA.close();
  await ctxB.close();
});

test('malformed and oversized codes are rejected without a crash', async ({ page }) => {
  await page.goto('/');
  await openPlumber(page);
  const before = await page.evaluate(() => ({ mode: window.__PLUMBER__.mode(), level: window.__PLUMBER__.level() }));
  await page.getByRole('button', { name: /Уровни|Levels/ }).click();
  await page.getByRole('button', { name: /Открыть по коду|Enter code/ }).click();
  await page.locator('input.share-input').fill('NOPE-'.repeat(200));
  await page.getByRole('button', { name: /^Открыть$|^Open$/ }).click();
  // Still on the same valid level, no exception thrown.
  const after = await page.evaluate(() => ({ mode: window.__PLUMBER__.mode(), level: window.__PLUMBER__.level() }));
  expect(after).toEqual(before);
});
