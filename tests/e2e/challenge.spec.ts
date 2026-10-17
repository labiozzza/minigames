import { expect, test, type Page } from '@playwright/test';

// §10 daily/weekly challenges. We fake ONLY Date (not timers) so the Phaser
// loop keeps running while the game sees a controllable UTC clock.
const SUNDAY = '2026-03-01T23:50:00.000Z'; // week of Mon 2026-02-23
const MONDAY = '2026-03-02T00:05:00.000Z';

async function installClock(page: Page): Promise<void> {
  await page.addInitScript({
    content: `(function(){
      try { window.__FAKE_NOW__ = parseInt(localStorage.getItem('__FAKE_NOW__') || '0', 10) || 0; } catch (e) { window.__FAKE_NOW__ = 0; }
      var Real = Date;
      var handler = {
        construct: function (_t, args) {
          if (args && args.length) { return new (Function.prototype.bind.apply(Real, [null].concat(args)))(); }
          return new Real(window.__FAKE_NOW__ || Real.now());
        },
        get: function (t, p) {
          if (p === 'now') { return function () { return window.__FAKE_NOW__ || Real.now(); }; }
          var v = Reflect.get(t, p);
          return typeof v === 'function' ? v.bind(t) : v;
        }
      };
      window.Date = new Proxy(Real, handler);
    })();`,
  });
}

async function setNow(page: Page, iso: string): Promise<void> {
  const ms = Date.parse(iso);
  await page.evaluate((t) => {
    localStorage.setItem('__FAKE_NOW__', String(t));
    (window as unknown as { __FAKE_NOW__: number }).__FAKE_NOW__ = t;
  }, ms);
}

async function call<T>(page: Page, m: string): Promise<T> {
  return page.evaluate((m) => (window as unknown as { __PLUMBER__: Record<string, () => unknown> }).__PLUMBER__[m]() as T, m);
}

async function plumber(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__ !== undefined, null, { timeout: 30000 });
}

// The hook survives between games, so wait for the NEW instance's puzzle id.
async function waitPuzzle(page: Page, prefix: string): Promise<void> {
  await page.waitForFunction(
    (p) => ((window as unknown as { __PLUMBER__?: { puzzleId: () => string } }).__PLUMBER__?.puzzleId() ?? '').startsWith(p),
    prefix,
    { timeout: 15000 },
  );
}

async function save(page: Page): Promise<{ games: Record<string, { dailies: Record<string, number>; weeklies: Record<string, number>; maxLevel: number; collections: string[] }> }> {
  return page.evaluate(() => (window as unknown as { __MG_TEST__: { save: () => unknown } }).__MG_TEST__.save() as never);
}

async function openChallenge(page: Page, which: 'Задание дня' | 'Нед. испытание'): Promise<void> {
  await page.locator('.bottombar .action-btn').nth(4).click();
  await page.locator('.modal-row .btn', { hasText: which }).click();
  const panel = page.locator('.modal-overlay.challenges');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.challenge-btn')).toHaveCount(3);
}

test('challenges: daily task is deterministic, archived at midnight, never touches campaign', async ({ page }) => {
  await installClock(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await setNow(page, SUNDAY);
  await page.reload();
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await plumber(page);

  await openChallenge(page, 'Задание дня');
  await page.locator('.modal-overlay.challenges .challenge-btn', { hasText: 'Обычный' }).click();
  await waitPuzzle(page, 'daily-2026-03-01');
  await call(page, 'solve');
  await call(page, 'runToEnd');
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { phase: () => string } }).__PLUMBER__?.phase() === 'WON', null, { timeout: 15000 });

  let s = await save(page);
  expect(s.games.plumber.dailies['2026-03-01']).toBeGreaterThanOrEqual(1);
  // Campaign progress and collections are untouched by a challenge win.
  expect(s.games.plumber.maxLevel).toBe(1);
  expect(s.games.plumber.collections).toEqual([]);

  // Double-reward protection: replaying the same day keeps a single best entry.
  await openChallenge(page, 'Задание дня');
  await page.locator('.modal-overlay.challenges .challenge-btn', { hasText: 'Обычный' }).click();
  await waitPuzzle(page, 'daily-2026-03-01');
  await call(page, 'solve');
  await call(page, 'runToEnd');
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { phase: () => string } }).__PLUMBER__?.phase() === 'WON', null, { timeout: 15000 });
  s = await save(page);
  expect(Object.keys(s.games.plumber.dailies)).toEqual(['2026-03-01']);

  // Past UTC midnight the archive shows the finished day; current task rolls.
  await setNow(page, MONDAY);
  await page.reload();
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await plumber(page);
  await openChallenge(page, 'Задание дня');
  await expect(page.locator('.modal-overlay.challenges .challenge-archive')).toContainText('2026-03-01');
  await page.locator('.modal-overlay.challenges .challenge-btn', { hasText: 'Обычный' }).click();
  await waitPuzzle(page, 'daily-2026-03-02');
});

test('challenges: weekly rolls on Monday, offline still lists cached tasks', async ({ page }) => {
  await installClock(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await setNow(page, MONDAY);
  await page.reload();
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await plumber(page);

  await openChallenge(page, 'Нед. испытание');
  await page.locator('.modal-overlay.challenges .challenge-btn', { hasText: 'Экспертный' }).click();
  await waitPuzzle(page, 'weekly-2026-03-02');
  await call(page, 'solve');
  await call(page, 'runToEnd');
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { phase: () => string } }).__PLUMBER__?.phase() === 'WON', null, { timeout: 15000 });
  const s = await save(page);
  expect(s.games.plumber.weeklies['2026-03-02']).toBeGreaterThanOrEqual(1);

  // Offline: tasks come from the pre-cached deterministic manifest.
  await page.context().setOffline(true);
  await page.reload();
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await plumber(page);
  await openChallenge(page, 'Задание дня');
  await expect(page.locator('.modal-overlay.challenges .challenge-offline')).toBeVisible();
  await expect(page.locator('.modal-overlay.challenges .challenge-btn')).toHaveCount(3);
  await page.context().setOffline(false);
});
