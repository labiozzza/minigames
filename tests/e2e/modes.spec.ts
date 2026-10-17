import { expect, test, type Page } from '@playwright/test';

// §5 acceptance: three explicit difficulties with fully independent progress.
// Playwright cannot return functions from evaluate, so hook calls run in-page.

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

const modeOf = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __PLUMBER__: { mode: () => string } }).__PLUMBER__.mode());

const levelOf = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __PLUMBER__: { level: () => number } }).__PLUMBER__.level());

async function save(page: Page): Promise<plumberSave> {
  return page.evaluate(() => (window as unknown as { __MG_TEST__: { save: () => plumberSave } }).__MG_TEST__.save());
}

interface ModeProgress {
  maxLevel: number;
  completed: number[];
  active: { levelNumber: number; mode: string } | null;
}
interface plumberSave {
  games: { plumber: { modes: Record<string, ModeProgress>; selected: string } };
}

async function selectMode(page: Page, label: string): Promise<void> {
  await page.locator('.top-actions .mode-btn').click();
  await expect(page.locator('.modal-overlay.levels .mode-row')).toBeVisible();
  await page.locator('.modal-overlay.levels .mode-row button', { hasText: label }).click();
  await waitPlumber(page);
  await waitScene(page);
}

async function openPlumber(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await waitScene(page);
}

async function solve(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __PLUMBER__: { solve: () => void } }).__PLUMBER__.solve());
  await expect(page.locator('.plumber-banner')).toContainText('Уровень пройден');
}

test('plumber modes: independent progress, preserved on reload (desktop)', async ({ page }) => {
  await openPlumber(page);

  // Start in the child mode and clear one level.
  await selectMode(page, 'Детский');
  await waitPhase(page, 'PREPARING', 15000);
  expect(await modeOf(page)).toBe('child');
  expect(await levelOf(page)).toBe(1);
  await solve(page);
  // Advance within the child mode: its own level 2.
  await page.locator('.bottombar .btn.primary.big').click();
  await waitPlumber(page);
  await waitScene(page);
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__: { level: () => number } }).__PLUMBER__.level() === 2, null, { timeout: 30000 });

  // Switch to expert: it must start at its own level 1, not at level 2.
  await selectMode(page, 'Экспертный');
  await waitPhase(page, 'PREPARING', 15000);
  expect(await modeOf(page)).toBe('expert');
  expect(await levelOf(page)).toBe(1);
  await solve(page);

  const before = await save(page);
  expect(before.games.plumber.modes.child.completed).toEqual([1]);
  expect(before.games.plumber.modes.child.maxLevel).toBe(2);
  expect(before.games.plumber.modes.expert.completed).toEqual([1]);
  expect(before.games.plumber.modes.expert.maxLevel).toBe(2);
  expect(before.games.plumber.modes.normal.completed).toEqual([]);

  // Reload: the chosen mode and every mode's progress must survive.
  await openPlumber(page);
  expect(await modeOf(page)).toBe('expert');
  const after = await save(page);
  expect(after.games.plumber.selected).toBe('expert');
  expect(after.games.plumber.modes.child.completed).toEqual([1]);
  expect(after.games.plumber.modes.expert.completed).toEqual([1]);
  expect(after.games.plumber.modes.normal.completed).toEqual([]);
});

test('plumber modes: switching never destroys the other mode active session', async ({ page }) => {
  await openPlumber(page);

  // Leave an unfinished session in normal mode.
  await selectMode(page, 'Обычный');
  await waitPhase(page, 'PREPARING', 15000);
  await page.evaluate(() => {
    const h = (window as unknown as { __PLUMBER__: { rotatable: () => number[]; rotate: (i: number) => void } }).__PLUMBER__;
    const cells = h.rotatable();
    if (cells.length) h.rotate(cells[0]);
  });

  // Switch to child (persists normal), then back to normal: the unfinished
  // normal session must come back instead of being wiped by child progress.
  await selectMode(page, 'Детский');
  await waitPhase(page, 'PREPARING', 15000);
  await selectMode(page, 'Обычный');
  await waitPhase(page, 'PREPARING', 15000);

  const s = await save(page);
  const normal = s.games.plumber.modes.normal.active;
  expect(normal).not.toBeNull();
  expect(normal!.mode).toBe('normal');
  expect(normal!.levelNumber).toBe(1);
  expect(s.games.plumber.modes.child.active?.mode).toBe('child');
});

