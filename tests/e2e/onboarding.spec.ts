import { expect, test, type Page } from '@playwright/test';

// §8 onboarding: a child who cannot read can finish levels by touching only the
// highlighted real cell / button. The guide follows the level witness, so we
// never script text here — we act on the guide and assert the real state moves.

type Guide = { action: string; cell: number | null; icon: string; mechanic: string };

async function call<T>(page: Page, m: string, a?: number): Promise<T> {
  return page.evaluate(
    ({ m, a }) => {
      const hook = (window as unknown as { __PLUMBER__: Record<string, (...x: number[]) => unknown> }).__PLUMBER__;
      return (a === undefined ? hook[m]() : hook[m](a)) as T;
    },
    { m, a },
  );
}

async function waitPlumber(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__ !== undefined, null, { timeout: 30000 });
}

async function startFresh(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { sceneReady: () => boolean } }).__PLUMBER__?.sceneReady() === true, null, { timeout: 30000 });
}

type Dims = { w: number; h: number; cell: number; ox: number; oy: number };

async function cellPoint(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#plumber-field canvas').boundingBox())!;
  const d = await call<Dims>(page, 'grid');
  const cam = await call<{ zoom: number; scrollX: number; scrollY: number }>(page, 'camera');
  const gx = index % d.w;
  const gy = Math.floor(index / d.w);
  const wx = (d.ox + gx * d.cell + d.cell / 2) / cam.zoom - cam.scrollX / cam.zoom;
  const wy = (d.oy + gy * d.cell + d.cell / 2) / cam.zoom - cam.scrollY / cam.zoom;
  return { x: box.x + wx * cam.zoom, y: box.y + wy * cam.zoom };
}

/** Follow the guide with real taps only; returns every guide step acted on. */
async function playByGuide(page: Page, maxSteps = 120): Promise<Guide[]> {
  const seen: Guide[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const phase = await call<string>(page, 'phase');
    if (phase === 'WON') return seen;
    if (phase === 'RUNNING') {
      await page.waitForTimeout(150);
      continue;
    }
    if (phase === 'PAUSED') {
      await page.locator('.bottombar .btn.primary.big').click({ force: true });
      continue;
    }
    const g = await call<Guide | null>(page, 'guide');
    if (!g) return seen;
    seen.push(g);
    if (g.action === 'start') {
      await page.locator('.bottombar .btn.primary.big').click({ force: true });
    } else if (g.cell !== null) {
      const c = await cellPoint(page, g.cell);
      await page.mouse.click(c.x, c.y);
    }
    await page.waitForTimeout(40);
  }
  return seen;
}

test('onboarding: first level is finished by touching only the highlighted cell (no reading)', async ({ page }) => {
  await startFresh(page);
  expect(await call<string>(page, 'mechanic')).toBe('rotate');
  const guide = await call<Guide | null>(page, 'guide');
  expect(guide).not.toBeNull();
  expect(['rotate', 'start']).toContain(guide!.action);

  const steps = await playByGuide(page);
  expect(steps.length).toBeGreaterThan(0);
  expect(steps.some((s) => s.action === 'start')).toBe(true);
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { phase: () => string } }).__PLUMBER__?.phase() === 'WON', null, { timeout: 15000 });

  // The introduced mechanic is recorded; the guide is then silent.
  expect(await call<string[]>(page, 'tutorial')).toContain('rotate');
  expect(await call<Guide | null>(page, 'guide')).toBeNull();
});

test('onboarding: skip hides the guide and stays skipped after reload', async ({ page }) => {
  await startFresh(page);
  await expect(page.locator('.guide-skip')).toBeVisible();
  await page.locator('.guide-skip').click();
  expect(await call<Guide | null>(page, 'guide')).toBeNull();
  await expect(page.locator('.guide-skip')).toBeHidden();

  await page.reload();
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await expect(page.locator('.guide-skip')).toBeHidden();
  expect(await call<Guide | null>(page, 'guide')).toBeNull();
});

test('onboarding: a newly unlocked mechanic (valve) is introduced on its level', async ({ page }) => {
  await startFresh(page);
  // Really clear the earlier normal levels so their mechanics are mastered.
  for (const lv of [1, 2, 3, 4]) {
    await page.evaluate((l) => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: l, mode: 'normal' } })), lv);
    await page.waitForFunction((l) => (window as unknown as { __PLUMBER__?: { level: () => number } }).__PLUMBER__?.level() === l, lv, { timeout: 15000 });
    await call(page, 'solve');
    await call(page, 'runToEnd');
  }
  await expect.poll(() => call<string[]>(page, 'tutorial')).toContain('leakfix');
  // Jump to the first valve level of the normal track.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: 5, mode: 'normal' } })));
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { level: () => number } }).__PLUMBER__?.level() === 5, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  expect(await call<string | null>(page, 'mechanic')).toBe('valve');

  const steps = await playByGuide(page);
  expect(steps.some((s) => s.mechanic === 'valve')).toBe(true);
});
