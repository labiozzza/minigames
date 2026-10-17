import { expect, test, type Page } from '@playwright/test';

// §9 collections & dioramas. Final art is BLOCKED_ASSET, so the album must show
// unique geometric prototypes (never emoji), 4 themed sets of 3, a locked
// silhouette state and a living composition for a completed set.
type Hook = Record<string, (...a: number[]) => unknown>;

async function call<T>(page: Page, m: string, a?: number): Promise<T> {
  return page.evaluate(
    ({ m, a }) => {
      const hook = (window as unknown as { __PLUMBER__: Hook }).__PLUMBER__;
      return (a === undefined ? hook[m]() : hook[m](a)) as T;
    },
    { m, a },
  );
}

async function waitPlumber(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__ !== undefined, null, { timeout: 30000 });
}

async function jump(page: Page, level: number, mode = 'normal'): Promise<void> {
  await page.evaluate(({ l, m }) => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: l, mode: m } })), { l: level, m: mode });
  await page.waitForFunction((l) => (window as unknown as { __PLUMBER__?: { level: () => number } }).__PLUMBER__?.level() === l, level, { timeout: 15000 });
  await page.waitForTimeout(200);
}

async function win(page: Page, level: number): Promise<void> {
  await jump(page, level);
  await call(page, 'solve');
  await call(page, 'runToEnd');
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { phase: () => string } }).__PLUMBER__?.phase() === 'WON', null, { timeout: 15000 });
}

async function openPlumber(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
}

test('collection: 12 unique prototypes in 4 themed sets; unlock flourish is skippable', async ({ page }) => {
  await openPlumber(page);

  // First win unlocks the garden watering-can and shows a non-textual flourish.
  await win(page, 1);
  const flourish = page.locator('.unlock-flourish');
  await expect(flourish).toBeVisible();
  await expect(flourish.locator('.unlock-card .project-svg[data-prototype="1"]')).toHaveCount(2);
  await flourish.locator('.unlock-skip').click({ force: true });
  await expect(flourish).toHaveCount(0);

  // Album: 4 sets x 3 = 12 unique cards, all with prototype SVGs, no emoji.
  await page.locator('.bottombar .action-btn').nth(5).click();
  const album = page.locator('.modal-overlay.album');
  await expect(album).toBeVisible();
  await expect(album.locator('.album-set')).toHaveCount(4);
  await expect(album.locator('.album-card')).toHaveCount(12);
  await expect(album.locator('.album-card .project-svg[data-prototype="1"]')).toHaveCount(12);
  expect(await album.locator('.album-emoji').count()).toBe(0);
  await expect(album.locator('.album-card.locked')).toHaveCount(10);
  const owned = album.locator('.album-card.owned');
  await expect(owned).toHaveCount(2);
  await expect(owned.locator('.project-svg.alive')).toHaveCount(2);
  await album.click({ position: { x: 8, y: 8 } });
  await expect(album).toHaveCount(0);
});

test('collection: a completed themed set opens a living diorama (no distortion at 390x844)', async ({ page }) => {
  await openPlumber(page);
  // garden set = wins>=1, wins>=2, and a multiflow family win.
  await win(page, 1);
  await win(page, 2);
  await win(page, 9);

  await page.locator('.bottombar .action-btn').nth(5).click();
  const album = page.locator('.modal-overlay.album');
  await expect(album).toBeVisible();
  const gardenSet = album.locator('.album-set').first();
  await expect(gardenSet.locator('.album-card.owned')).toHaveCount(3);
  await gardenSet.locator('.btn', { hasText: 'Живая диорама' }).click();

  const diorama = page.locator('.modal-overlay.diorama-full');
  await expect(diorama).toBeVisible();
  await expect(diorama.locator('.composition-svg[data-prototype="1"]')).toHaveCount(1);
  // Touch interaction toggles the alive animation without leaving the view.
  await diorama.locator('.diorama-stage').click({ position: { x: 10, y: 10 } });
  await expect(diorama.locator('.diorama-stage.sparkle')).toHaveCount(1);

  // No horizontal overflow / stretched art on the narrow viewport.
  const svg = await diorama.locator('.composition-svg').boundingBox();
  const vw = page.viewportSize()!.width;
  expect(svg!.width).toBeLessThanOrEqual(vw);
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflows).toBe(false);

  await diorama.locator('.btn.primary').click();
  await expect(diorama).toHaveCount(0);
});
