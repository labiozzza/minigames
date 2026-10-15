import { expect, test } from '@playwright/test';
import { keyFor, mg, waitForGame } from './helpers';

interface TutDbg {
  mode: string;
  step: number;
  awaiting: string;
  expectTube: number | null;
  expectButton: string | null;
}

async function tut(page: import('@playwright/test').Page): Promise<TutDbg | null> {
  return page.evaluate(() => (window as unknown as { __MG: { dbg: () => { tut: TutDbg | null } } }).__MG.dbg().tut);
}

test('basic tutorial is completable by actions alone; wrong taps are blocked', async ({ page }) => {
  await page.goto('/');
  await page.locator('.game-card .btn.primary').click();
  await waitForGame(page, 1);

  // Spotlight UI is on screen, no text reading required.
  await page.waitForFunction(
    () => (window as unknown as { __MG: { dbg: () => { tut: unknown } } }).__MG.dbg().tut !== null,
    null,
    { timeout: 15000 },
  );
  await expect(page.locator('.tut-ring')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'evidence/screenshots/tutorial-tmp.png' });

  let t0 = await tut(page);
  expect(t0).not.toBe(null);
  expect(t0!.awaiting).toBe('select');

  // A wrong tap changes nothing and keeps the same step.
  const wrong = (t0!.expectTube! + 2) % (await mg(page)).tubeCount;
  const h0 = (await mg(page)).historyLen;
  await page.keyboard.press(keyFor(wrong));
  await page.waitForTimeout(400);
  expect((await mg(page)).historyLen).toBe(h0);
  expect((await tut(page))?.step).toBe(t0!.step);

  // Walk the whole tutorial by following the pointer only.
  for (let i = 0; i < 30; i++) {
    const cur = await tut(page);
    if (!cur) break;
    if (cur.awaiting === 'select' || cur.awaiting === 'pour') {
      await page.keyboard.press(keyFor(cur.expectTube!));
      await page.waitForTimeout(700);
    } else if (cur.awaiting === 'button') {
      const idx = cur.expectButton === 'undo' ? 0 : 2;
      await page.locator('.bottombar .action-btn').nth(idx).click();
      await page.waitForTimeout(700);
    } else {
      await page.locator('.tutorial-card .btn.primary').click();
      await page.waitForTimeout(500);
    }
  }
  expect(await tut(page)).toBe(null);
  expect(await page.locator('.tutorial').count()).toBe(0);
});

test('mystery tutorial reveals through a real scout pour', async ({ page }) => {
  await page.addInitScript(() => {
    const open = indexedDB.open('minigames', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onsuccess = () => {
      const save = {
        schemaVersion: 1,
        settings: {
          theme: 'system', lang: 'ru', music: false, musicVolume: 0.5,
          sfx: false, sfxVolume: 0.7, vibration: false, speed: 'instant',
          symbols: false, installDismissed: true,
        },
        games: {
          'water-sort': {
            maxLevel: 101,
            completed: Array.from({ length: 100 }, (_, i) => i + 1),
            active: null,
            tutorialBasic: true,
            tutorialMystery: false,
          },
        },
        lastPlayed: { gameId: 'water-sort', levelNumber: 101 },
        updatedAt: Date.now(),
      };
      const tx = open.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(JSON.stringify(save), 'save-v1');
    };
  });
  await page.goto('/');
  await page.locator('.game-card .btn.primary').click();
  await waitForGame(page, 101);
  await page.waitForFunction(
    () => (window as unknown as { __MG: { dbg: () => { tut: unknown } } }).__MG.dbg().tut !== null,
    null,
    { timeout: 15000 },
  );
  await expect(page.locator('.tut-ring')).toBeVisible({ timeout: 10000 });

  const before = (await mg(page)).knownCount;
  for (let i = 0; i < 12; i++) {
    const cur = await tut(page);
    if (!cur) break;
    if (cur.awaiting === 'select' || cur.awaiting === 'pour') {
      await page.keyboard.press(keyFor(cur.expectTube!));
      await page.waitForTimeout(600);
    } else if (cur.awaiting === 'button') {
      await page.locator('.bottombar .action-btn').nth(0).click();
      await page.waitForTimeout(600);
    } else {
      await page.locator('.tutorial-card .btn.primary').click();
      await page.waitForTimeout(400);
    }
    if ((await mg(page)).knownCount > before) break;
  }
  expect((await mg(page)).knownCount).toBeGreaterThan(before);
});
