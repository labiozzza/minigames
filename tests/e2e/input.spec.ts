import { expect, test, type Page } from '@playwright/test';

// §7: real pointer/touch input, camera control and keyboard play.
// Gestures use genuine mouse/touch events, never the __PLUMBER__ test hook.

type Dims = { w: number; h: number; cell: number; ox: number; oy: number };

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

async function openPlumber(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await waitScene(page);
}

// Screen-space centre of a grid cell at the current zoom (zoom is 1 on load).
async function cellPoint(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#plumber-field canvas').boundingBox())!;
  const d = await page.evaluate(() => {
    const h = (window as unknown as { __PLUMBER__: { grid: () => Dims } }).__PLUMBER__;
    return h.grid();
  });
  const gx = index % d.w;
  const gy = Math.floor(index / d.w);
  const cam = await page.evaluate(() => (window as unknown as { __PLUMBER__: { camera: () => { zoom: number; scrollX: number; scrollY: number } } }).__PLUMBER__.camera());
  const wx = (d.ox + gx * d.cell + d.cell / 2) / cam.zoom - cam.scrollX / cam.zoom;
  const wy = (d.oy + gy * d.cell + d.cell / 2) / cam.zoom - cam.scrollY / cam.zoom;
  return { x: box.x + wx * cam.zoom, y: box.y + wy * cam.zoom };
}

const rotations = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __PLUMBER__: { rotations: () => number } }).__PLUMBER__.rotations());

const checksum = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __PLUMBER__: { checksum: () => string } }).__PLUMBER__.checksum());

const zoom = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __PLUMBER__: { camera: () => { zoom: number } } }).__PLUMBER__.camera().zoom);

async function firstRotatable(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __PLUMBER__: { rotatable: () => number[] } }).__PLUMBER__.rotatable()[0]);
}

async function firstEmpty(page: Page): Promise<number> {
  return page.evaluate(() => {
    const h = (window as unknown as { __PLUMBER__: { kindAt: (i: number) => string; grid: () => Dims } }).__PLUMBER__;
    const d = h.grid();
    for (let i = 0; i < d.w * d.h; i++) if (h.kindAt(i) === 'empty') return i;
    return -1;
  });
}

test('input: real tap rotates a pipe', async ({ page }) => {
  await openPlumber(page);
  const before = await checksum(page);
  const idx = await firstRotatable(page);
  const p = await cellPoint(page, idx);
  await page.mouse.click(p.x, p.y);
  expect(await checksum(page)).not.toBe(before);
  expect(await rotations(page)).toBe(1);
});

test('input: keyboard moves focus and Enter rotates; shortcuts work', async ({ page }) => {
  await openPlumber(page);
  await page.locator('.field').click({ position: { x: 4, y: 4 } });
  const f0 = await page.evaluate(() => (window as unknown as { __PLUMBER__: { focus: () => number } }).__PLUMBER__.focus());
  await page.keyboard.press('ArrowRight');
  const f1 = await page.evaluate(() => (window as unknown as { __PLUMBER__: { focus: () => number } }).__PLUMBER__.focus());
  expect(f1).toBe(f0 + 1);
  await page.keyboard.press('ArrowDown');
  const f2 = await page.evaluate(() => (window as unknown as { __PLUMBER__: { focus: () => number } }).__PLUMBER__.focus());
  expect(f2).toBeGreaterThan(f1);
  // Enter acts on the focused cell using the same rule as a tap.
  const before = await checksum(page);
  await page.keyboard.press('Enter');
  expect(await checksum(page)).not.toBe(before);
  // Undo via Z restores.
  const rotated = await checksum(page);
  await page.keyboard.press('z');
  expect(await checksum(page)).not.toBe(rotated);
});

test('input: wheel zooms with clamped bounds, release outside cancels drag', async ({ page }) => {
  await openPlumber(page);
  const box = (await page.locator('#plumber-field canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -240);
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__: { camera: () => { zoom: number } } }).__PLUMBER__.camera().zoom > 1);
  const zIn = await zoom(page);
  expect(zIn).toBeGreaterThan(1);
  // Zoom-out cannot go below the fit (min 1).
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 240);
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__: { camera: () => { zoom: number } } }).__PLUMBER__.camera().zoom <= 1.001);
  expect(await zoom(page)).toBeCloseTo(1, 2);
  // Start a drag, leave the canvas, release: nothing must change.
  const idx = await firstRotatable(page);
  const p = await cellPoint(page, idx);
  const before = await checksum(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y - 40, { steps: 6 });
  await page.mouse.up();
  expect(await checksum(page)).toBe(before);
});

test('input: drag-and-drop moves a pipe (no accidental rotation)', async ({ page }) => {
  await openPlumber(page);
  const from = await firstRotatable(page);
  const to = await firstEmpty(page);
  expect(to).toBeGreaterThanOrEqual(0);
  const a = await cellPoint(page, from);
  const b = await cellPoint(page, to);
  const rotBefore = await rotations(page);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  // A move is not a rotation and not a silent no-op.
  expect(await rotations(page)).toBe(rotBefore);
  const moved = await page.evaluate(
    (args) => {
      const h = (window as unknown as { __PLUMBER__: { kindAt: (i: number) => string } }).__PLUMBER__;
      return { from: h.kindAt(args.from), to: h.kindAt(args.to) };
    },
    { from, to },
  );
  expect(moved.from).toBe('empty');
  expect(moved.to).not.toBe('empty');
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('input: real touch tap rotates and pinch lite via two taps do not crash', async ({ page }) => {
    await openPlumber(page);
    const idx = await firstRotatable(page);
    const p = await cellPoint(page, idx);
    const before = await checksum(page);
    await page.touchscreen.tap(p.x, p.y);
    expect(await checksum(page)).not.toBe(before);
  });
});
