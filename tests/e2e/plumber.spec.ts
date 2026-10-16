import { expect, test, type Page } from '@playwright/test';

// NOTE: Playwright cannot return functions from evaluate (structured clone
// drops them), so every hook call runs fully inside the page.
type HookFn = (...args: number[]) => unknown;

async function callHook<T>(page: Page, method: string, arg?: number): Promise<T> {
  return page.evaluate(
    ({ m, a }) => {
      const hook = (window as unknown as { __PLUMBER__: Record<string, HookFn> }).__PLUMBER__;
      return (a === undefined ? hook[m]() : hook[m](a)) as T;
    },
    { m: method, a: arg },
  );
}

const call0 = <T>(page: Page, method: string): Promise<T> => callHook<T>(page, method);
const call1 = <T>(page: Page, method: string, arg: number): Promise<T> => callHook<T>(page, method, arg);

async function waitPlumber(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__ !== undefined, null, { timeout: 30000 });
}

async function waitScene(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __PLUMBER__?: { sceneReady: () => boolean } }).__PLUMBER__?.sceneReady() === true,
    null,
    { timeout: 30000 },
  );
}

async function waitPhase(page: Page, phase: string, timeout: number): Promise<void> {
  await page.waitForFunction(
    (p) => (window as unknown as { __PLUMBER__?: { phase: () => string } }).__PLUMBER__?.phase() === p,
    phase,
    { timeout },
  );
}

test('plumber: catalog -> rotate -> hint -> run water -> win -> next', async ({ page }) => {
  const suffix = page.viewportSize()?.width === 390 ? 'mobile' : 'desktop';
  await page.goto('/');
  await expect(page.locator('.app-title')).toContainText('MiniGames');
  await page.screenshot({ path: `evidence/screenshots/plumber-catalog-${suffix}.png` });
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await waitScene(page);

  await expect(page.locator('.level-title')).toContainText('Водопроводчик');
  await expect(page.locator('.plumber-goal')).toContainText('0/3');
  await page.screenshot({ path: `evidence/screenshots/plumber-preparing-${suffix}.png` });

  // Levels overlay: grid + daily + share entries; pick level 1 to continue.
  await page.locator('.bottombar .action-btn').nth(4).click();
  await expect(page.locator('.modal-overlay.levels .level-grid')).toBeVisible();
  await page.locator('.modal-overlay.levels .level-btn').first().click();
  await waitPhase(page, 'PREPARING', 15000);

  // Album overlay: 12 collectible cards; close via backdrop.
  await page.locator('.bottombar .action-btn').nth(5).click();
  await expect(page.locator('.modal-overlay.album .album-grid')).toBeVisible();
  expect(await page.locator('.modal-overlay.album .album-card').count()).toBe(12);
  await page.locator('.modal-overlay.album').click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.modal-overlay.album')).toHaveCount(0);

  // Atlas sprites are used (no primitive fallback) on this build.
  expect(await call0<boolean | null>(page, 'usesFallback')).toBe(false);

  // Real canvas tap rotates a rotatable cell: model checksum changes.
  const before: string = await call0(page, 'checksum');
  const rotatable = await call0<number[]>(page, 'rotatable');
  expect(rotatable.length).toBeGreaterThan(0);
  const c = await call1<{ x: number; y: number } | null>(page, 'cellCenter', rotatable[0]);
  expect(c).not.toBe(null);
  const box = await page.locator('#plumber-field canvas').boundingBox();
  expect(box).not.toBe(null);
  await page.mouse.click(box!.x + c!.x, box!.y + c!.y);
  await expect.poll(() => call0<string>(page, 'checksum'), { timeout: 5000 }).not.toBe(before);

  // Undo restores the exact pre-tap state.
  await call0(page, 'undo');
  expect(await call0<string>(page, 'checksum')).toBe(before);
  await call0(page, 'restart');
  expect(await call0<string>(page, 'phase')).toBe('PREPARING');

  // Solve through the certified witness; water must be conserved mid-flight.
  await call0(page, 'solve');
  await waitPhase(page, 'RUNNING', 10000).catch(() => undefined);
  await page.waitForFunction(
    () => {
      const hook = (window as unknown as { __PLUMBER__?: { water: () => number[] } }).__PLUMBER__;
      return hook && hook.water().reduce((a, b) => a + b, 0) > 0;
    },
    null,
    { timeout: 10000 },
  );
  const water: number[] = await call0(page, 'water');
  expect(water.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  expect(await call0<boolean>(page, 'volumeOk')).toBe(true);
  await page.screenshot({ path: `evidence/screenshots/plumber-running-${suffix}.png` });
  await waitPhase(page, 'WON', 60000);
  const got: number[] = await call0(page, 'receiverGot');
  expect(got[0]).toBeGreaterThanOrEqual(3);
  expect(await call0<boolean>(page, 'volumeOk')).toBe(true);
  await expect(page.locator('.plumber-banner')).toContainText('Уровень пройден');
  await page.screenshot({ path: `evidence/screenshots/plumber-win-${suffix}.png` });

  // Next level mounts fresh.
  await page.locator('.bottombar .btn.primary.big').click();
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { level: () => number } }).__PLUMBER__?.level() === 2, null, { timeout: 30000 });
  expect(await call0<string>(page, 'phase')).toBe('PREPARING');
});

test('plumber: valve level solves through the certified witness', async ({ page }) => {
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await waitScene(page);
  // Jump to curriculum valve level.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: 5 } })));
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { level: () => number } }).__PLUMBER__?.level() === 5, null, { timeout: 30000 });
  await call0(page, 'solve');
  await waitPhase(page, 'WON', 60000);
  expect(await call0<boolean>(page, 'volumeOk')).toBe(true);
  await expect(page.locator('.plumber-banner')).toContainText('Уровень пройден');
});

test('plumber: works fully offline from precache', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await waitScene(page);
  expect(await call0<boolean | null>(page, 'usesFallback')).toBe(false);
  // Wait until the SW precache actually holds the atlas before cutting network.
  await page.waitForFunction(
    async () => {
      try {
        const m = await caches.match('assets/plumber/atlas.png');
        return m !== undefined;
      } catch {
        return false;
      }
    },
    null,
    { timeout: 60000 },
  );
  await context.setOffline(true);
  await page.reload();
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await waitScene(page);
  expect(await call0<boolean | null>(page, 'usesFallback')).toBe(false);
  expect(await call0<string>(page, 'phase')).toBe('PREPARING');
  await context.setOffline(false);
});
