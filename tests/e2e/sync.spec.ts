import { expect, test, type Page } from '@playwright/test';

type PlumberSave = { completed: number[]; maxLevel: number; stars: Record<string, number>; collections: string[] };

interface MgTest {
  save: () => { games: Record<string, PlumberSave>; conflicts?: Record<string, unknown> };
  status: () => { state: string; pending: number };
  conflicts: () => string[];
  syncNow: () => Promise<void>;
  logout: () => void;
  login: (email: string) => Promise<boolean>;
}

declare global {
  interface Window {
    __MG_TEST__: MgTest;
    __PLUMBER__: {
      phase: () => string;
      sceneReady: () => boolean;
      solve: () => void;
      rotatable: () => number[];
      rotate: (i: number) => void;
    };
  }
}

async function waitApp(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof window.__MG_TEST__ !== 'undefined', null, { timeout: 30000 });
}

async function openPlumber(page: Page, level = 1): Promise<void> {
  await page.evaluate((lv) => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: lv } })), level);
  await page.waitForFunction(() => typeof window.__PLUMBER__ !== 'undefined', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__PLUMBER__.sceneReady() === true, null, { timeout: 30000 });
}

async function winPlumber(page: Page): Promise<void> {
  await page.evaluate(() => window.__PLUMBER__.solve());
  await page.waitForFunction(() => window.__PLUMBER__.phase() === 'WON', null, { timeout: 60000 });
}

function plumber(page: Page, save: { games: Record<string, PlumberSave> }): PlumberSave {
  void page;
  return save.games['plumber'];
}

test('sync: guest offline progress links to account and merges across devices', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const email = `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;

  // A plays strictly offline first: progress must be kept locally and queued.
  await a.goto('/');
  await waitApp(a);
  await ctxA.setOffline(true);
  await openPlumber(a, 1);
  await winPlumber(a);
  const localA = await a.evaluate(() => window.__MG_TEST__.save());
  expect(plumber(a, localA).completed).toContain(1);
  const stOffline = await a.evaluate(() => window.__MG_TEST__.status());
  expect(stOffline.pending).toBeGreaterThan(0);
  expect(stOffline.state === 'guest' || stOffline.state === 'offline').toBe(true);

  // Back online, link the guest to an account: queued events flush + pull.
  await ctxA.setOffline(false);
  expect(await a.evaluate((e) => window.__MG_TEST__.login(e), email)).toBe(true);
  await a.evaluate(() => window.__MG_TEST__.syncNow());
  expect((await a.evaluate(() => window.__MG_TEST__.status())).pending).toBe(0);

  // Second device signs in with the same email: it receives device A's progress.
  await b.goto('/');
  await waitApp(b);
  expect(await b.evaluate((e) => window.__MG_TEST__.login(e), email)).toBe(true);
  const pulledB = await b.evaluate(() => window.__MG_TEST__.save());
  expect(plumber(b, pulledB).completed).toContain(1);

  // B advances further, then A syncs and sees B's new level; no duplicates.
  await openPlumber(b, 2);
  await winPlumber(b);
  await b.evaluate(() => window.__MG_TEST__.syncNow());
  await a.evaluate(() => window.__MG_TEST__.syncNow());

  const mergedA = await a.evaluate(() => window.__MG_TEST__.save());
  const completed = plumber(a, mergedA).completed;
  expect(completed).toEqual(expect.arrayContaining([1, 2]));
  expect(new Set(completed).size).toBe(completed.length);

  // Idempotent resend: syncing again changes nothing.
  await a.evaluate(() => window.__MG_TEST__.syncNow());
  const again = await a.evaluate(() => window.__MG_TEST__.save());
  expect(plumber(a, again).completed).toEqual(completed);

  await ctxA.close();
  await ctxB.close();
});

test('sync: conflicting unfinished puzzles keep BOTH versions', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const email = `e2e_c_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;

  await a.goto('/');
  await waitApp(a);
  await b.goto('/');
  await waitApp(b);

  // Both devices sign in BEFORE either advances, so B's base version goes stale.
  expect(await a.evaluate((e) => window.__MG_TEST__.login(e), email)).toBe(true);
  expect(await b.evaluate((e) => window.__MG_TEST__.login(e), email)).toBe(true);

  // A leaves an unfinished puzzle and publishes it.
  await openPlumber(a, 5);
  await a.evaluate(() => window.__PLUMBER__.rotate(window.__PLUMBER__.rotatable()[0]));
  await a.evaluate(() => window.__MG_TEST__.syncNow());

  // B has a different unfinished puzzle at the same level, then syncs (stale base).
  await openPlumber(b, 5);
  await b.evaluate(() => {
    const idx = window.__PLUMBER__.rotatable();
    window.__PLUMBER__.rotate(idx[0]);
    window.__PLUMBER__.rotate(idx[0]);
  });
  await b.evaluate(() => window.__MG_TEST__.syncNow());

  const conflicts = await b.evaluate(() => window.__MG_TEST__.conflicts());
  expect(conflicts).toContain('plumber');
  const saveB = await b.evaluate(() => window.__MG_TEST__.save());
  expect(saveB.conflicts?.plumber).toBeTruthy();

  await ctxA.close();
  await ctxB.close();
});
