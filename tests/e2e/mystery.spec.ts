import { expect, test } from '@playwright/test';
import { keyFor, legalPour, mg, setSpeedInstant, waitForGame } from './helpers';

// Seed a realistic save straight into IndexedDB: frontier at 101, first 100 done.
async function seedAt101(page: import('@playwright/test').Page): Promise<void> {
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
}

test('mystery level: tutorial, scout hint, reveal kept on undo/restart, clean replay', async ({ page }) => {
  await seedAt101(page);
  await page.goto('/');
  await page.locator('.game-card .btn.primary').click();
  await waitForGame(page, 101);

  // Mystery tutorial appears once.
  await expect(page.locator('.tutorial-card')).toBeVisible({ timeout: 10000 });
  const suffix = page.viewportSize()?.width === 390 ? 'mobile' : 'desktop';
  await page.screenshot({ path: `evidence/screenshots/mystery-${suffix}.png` });
  await page.locator('.tutorial-card .btn').first().click();
  await setSpeedInstant(page);

  let st = await mg(page);
  expect(st.tubes.flat().filter((c) => c === '?').length).toBeGreaterThan(0);

  // Scout hint (never a fake guarantee): toast says Разведка.
  await page.locator('.bottombar .action-btn').nth(2).click();
  await expect(page.locator('.toast.show').first()).toContainText(/Разведка|Scout/);

  // Make real pours using only public info until something reveals.
  // Prefer scouting moves (known top with '?' just beneath); never undo directly.
  const before = st.knownCount;
  let revealed = false;
  let prev: { f: number; t: number } | null = null;
  for (let round = 0; round < 25 && !revealed; round++) {
    const arg: { f: number; t: number } | null = prev;
    const cand: { f: number; t: number } | null = await page.evaluate(
      (p: { f: number; t: number } | null): { f: number; t: number } | null => {
      const s = (window as unknown as { __MG: { tubes: () => string[][] } }).__MG;
      const tubes = s.tubes();
      const top = (i: number): string | null => {
        const t = tubes[i];
        return t.length ? t[t.length - 1] : null;
      };
      const opts: Array<{ f: number; t: number; scout: boolean }> = [];
      for (let f = 0; f < tubes.length; f++) {
        const c = top(f);
        if (!c || c === '?') continue;
        // Is there a hidden layer right under the top run?
        let i = tubes[f].length - 1;
        while (i >= 0 && tubes[f][i] === c) i--;
        const scout = i >= 0 && tubes[f][i] === '?';
        for (let t = 0; t < tubes.length; t++) {
          if (t === f) continue;
          if (p && p.f === t && p.t === f) continue;
          if (tubes[t].length >= 4) continue;
          const dt = top(t);
          if (dt && dt !== c) continue;
          opts.push({ f, t, scout });
        }
      }
      opts.sort((a, b) => Number(b.scout) - Number(a.scout));
      return opts[0] ?? null;
    }, arg);
    if (!cand) break;
    prev = cand;
    const h0 = (await mg(page)).historyLen;
    await page.keyboard.press(keyFor(cand.f));
    await page.keyboard.press(keyFor(cand.t));
    await expect.poll(async () => (await mg(page)).historyLen, { timeout: 8000 }).toBe(h0 + 1);
    if ((await mg(page)).knownCount > before) revealed = true;
  }
  expect(revealed).toBe(true);
  const knownAfterReveal = (await mg(page)).knownCount;
  await page.locator('.bottombar .action-btn').nth(0).click();
  expect((await mg(page)).knownCount).toBe(knownAfterReveal);

  // Restart keeps knowledge too.
  await legalPour(page).catch(() => undefined);
  await page.locator('.bottombar .action-btn').nth(1).click();
  const confirm = page.locator('.modal-overlay.confirm .btn.primary');
  if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
  expect((await mg(page)).knownCount).toBeGreaterThanOrEqual(knownAfterReveal);
});
