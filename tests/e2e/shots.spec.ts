import { expect, test } from '@playwright/test';
import { keyFor, legalPour, mg, waitForGame } from './helpers';

test('shot series: tutorial spotlight + mid-pour stream', async ({ page }) => {
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Water Sort' }).locator('.btn.primary').click();
  await waitForGame(page, 1);
  await page.waitForFunction(
    () => (window as unknown as { __MG: { dbg: () => { tut: unknown } } }).__MG.dbg().tut !== null,
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'evidence/screenshots/tutorial-basic.png' });

  // Skip the tutorial, set normal speed, catch the stream mid-flight.
  await page.locator('.tutorial-card .btn').first().click();
  const st = await mg(page);
  const cand = await page.evaluate(() => {
    const s = (window as unknown as { __MG: { tubes: () => string[][] } }).__MG;
    const tubes = s.tubes();
    const top = (i: number): string | null => {
      const t = tubes[i];
      return t.length ? t[t.length - 1] : null;
    };
    for (let f = 0; f < tubes.length; f++) {
      const c = top(f);
      if (!c || c === '?') continue;
      for (let t = 0; t < tubes.length; t++) {
        if (t === f || tubes[t].length >= 4) continue;
        const dt = top(t);
        if (dt && dt !== c) continue;
        return { f, t };
      }
    }
    return null;
  });
  expect(cand).not.toBe(null);
  await page.keyboard.press(keyFor(cand!.f));
  await page.waitForTimeout(200);
  await page.keyboard.press(keyFor(cand!.t));
  await page.waitForTimeout(550);
  await page.screenshot({ path: 'evidence/screenshots/pour-stream-1.png' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'evidence/screenshots/pour-stream-2.png' });
  expect(st.tubeCount).toBeGreaterThan(0);
  await expect.poll(async () => (await mg(page)).animating, { timeout: 15000 }).toBe(false);
  await legalPour(page);
});
