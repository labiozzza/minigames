import { expect, test, type Page } from '@playwright/test';

// Regression coverage for the Round-3 control + empty-cell fixes. Every gesture
// here is a REAL input event (mouse/touchscreen) — never `__PLUMBER__.rotate()`,
// which bypasses the gesture recogniser and would hide exactly these bugs.
type HookFn = (...args: number[]) => unknown;

async function call<T>(page: Page, method: string, arg?: number): Promise<T> {
  return page.evaluate(
    ({ m, a }) => {
      const hook = (window as unknown as { __PLUMBER__: Record<string, HookFn> }).__PLUMBER__;
      return (a === undefined ? hook[m]() : hook[m](a)) as T;
    },
    { m: method, a: arg },
  );
}

const call0 = <T>(page: Page, method: string): Promise<T> => call<T>(page, method);
const call1 = <T>(page: Page, method: string, arg: number): Promise<T> => call<T>(page, method, arg);

async function openPlumber(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__ !== undefined, null, { timeout: 30000 });
  await page.waitForFunction(
    () => (window as unknown as { __PLUMBER__?: { sceneReady: () => boolean } }).__PLUMBER__?.sceneReady() === true,
    null,
    { timeout: 30000 },
  );
}

async function jumpTo(page: Page, level: number): Promise<void> {
  await page.evaluate((l) => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: l, mode: 'normal' } })), level);
  await page.waitForFunction(
    (l) => (window as unknown as { __PLUMBER__?: { level: () => number } }).__PLUMBER__?.level() === l,
    level,
    { timeout: 30000 },
  );
}

async function box(page: Page): Promise<{ x: number; y: number }> {
  const b = await page.locator('#plumber-field canvas').boundingBox();
  expect(b).not.toBe(null);
  return { x: b!.x, y: b!.y };
}

async function center(page: Page, i: number): Promise<{ x: number; y: number }> {
  const c = await call1<{ x: number; y: number } | null>(page, 'cellCenter', i);
  expect(c).not.toBe(null);
  return c!;
}

async function tap(page: Page, i: number): Promise<void> {
  const b = await box(page);
  const c = await center(page, i);
  await page.mouse.click(b.x + c.x, b.y + c.y);
}

async function longPress(page: Page, i: number): Promise<void> {
  const b = await box(page);
  const c = await center(page, i);
  await page.mouse.move(b.x + c.x, b.y + c.y);
  await page.mouse.down();
  await page.waitForTimeout(480);
  await page.mouse.up();
}

async function drag(page: Page, from: number, to: number): Promise<void> {
  const b = await box(page);
  const a = await center(page, from);
  const z = await center(page, to);
  await page.mouse.move(b.x + a.x, b.y + a.y);
  await page.mouse.down();
  await page.mouse.move(b.x + (a.x + z.x) / 2, b.y + (a.y + z.y) / 2, { steps: 6 });
  await page.mouse.move(b.x + z.x, b.y + z.y, { steps: 6 });
  await page.mouse.up();
}

async function empties(page: Page): Promise<number[]> {
  const grid = await call0<{ w: number; h: number }>(page, 'grid');
  const out: number[] = [];
  for (let i = 0; i < grid.w * grid.h; i++) {
    if ((await call1<string>(page, 'kindAt', i)) === 'empty') out.push(i);
  }
  return out;
}

test('plumber R3: no scenery on empty cells in any state (load/move/undo/restart)', async ({ page }) => {
  await openPlumber(page);
  await jumpTo(page, 7); // carry family: movable pipes + empty cells
  expect(await call0<number>(page, 'emptyArt')).toBe(0);

  const rotatable = await call0<number[]>(page, 'rotatable');
  expect(rotatable.length).toBeGreaterThan(0);
  await tap(page, rotatable[0]);
  expect(await call0<number>(page, 'emptyArt')).toBe(0);

  const empty = await empties(page);
  if (empty.length > 0) {
    await longPress(page, rotatable[0]);
    expect(await call0<number>(page, 'emptyArt')).toBe(0);
    await tap(page, empty[0]);
    expect(await call0<number>(page, 'emptyArt')).toBe(0);
  }

  await call0(page, 'undo');
  expect(await call0<number>(page, 'emptyArt')).toBe(0);
  await call0(page, 'restart');
  expect(await call0<number>(page, 'emptyArt')).toBe(0);
});

test('plumber R3: a drag-drop completes and the next tap rotates again', async ({ page }) => {
  await openPlumber(page);
  await jumpTo(page, 7);

  const rotatable = await call0<number[]>(page, 'rotatable');
  const empty = await empties(page);
  expect(rotatable.length).toBeGreaterThan(0);
  expect(empty.length).toBeGreaterThan(0);

  await drag(page, rotatable[0], empty[0]);
  expect(await call0<string | null>(page, 'carried')).toBe(null);
  expect(await call0<boolean>(page, 'moveMode')).toBe(false);
  expect(await call0<boolean>(page, 'carryChip')).toBe(false);

  // The reported bug: after a move, the next tap must rotate, not re-enter move.
  const rot = await call0<number[]>(page, 'rotatable');
  expect(rot.length).toBeGreaterThan(0);
  const before = await call0<number>(page, 'rotations');
  await tap(page, rot[0]);
  await expect.poll(() => call0<number>(page, 'rotations'), { timeout: 5000 }).toBe(before + 1);
  expect(await call0<boolean>(page, 'moveMode')).toBe(false);
});

test('plumber R3: carry is visible and always resolves (place or cancel), never hidden', async ({ page }) => {
  await openPlumber(page);
  await jumpTo(page, 7);

  const rotatable = await call0<number[]>(page, 'rotatable');
  const empty = await empties(page);
  expect(empty.length).toBeGreaterThan(0);

  await longPress(page, rotatable[0]);
  expect(await call0<string | null>(page, 'carried')).not.toBe(null);
  expect(await call0<boolean>(page, 'moveMode')).toBe(true);
  expect(await call0<boolean>(page, 'carryChip')).toBe(true);
  const carried = await call0<string>(page, 'carried');

  // Placing finishes the action and drops back to normal control.
  await tap(page, empty[0]);
  expect(await call0<string | null>(page, 'carried')).toBe(null);
  expect(await call0<boolean>(page, 'moveMode')).toBe(false);
  expect(await call0<boolean>(page, 'carryChip')).toBe(false);
  expect(await call1<string>(page, 'kindAt', empty[0])).toBe(carried);

  // Cancel path: pick up again, then turn move mode off — the pipe must return.
  await longPress(page, empty[0]);
  expect(await call0<string | null>(page, 'carried')).not.toBe(null);
  await page.locator('.bottombar .action-btn.active').first().click();
  expect(await call0<string | null>(page, 'carried')).toBe(null);
  expect(await call0<boolean>(page, 'moveMode')).toBe(false);
  expect(await call0<boolean>(page, 'carryChip')).toBe(false);
  expect(await call1<string>(page, 'kindAt', empty[0])).toBe(carried);
});

test('plumber R3: focus ring is keyboard-only, never stuck after touch', async ({ page }) => {
  await openPlumber(page);
  await jumpTo(page, 7);

  const rotatable = await call0<number[]>(page, 'rotatable');
  await tap(page, rotatable[0]);
  expect(await call0<boolean>(page, 'focusRing')).toBe(false);

  await page.locator('#plumber-field canvas').press('ArrowRight');
  expect(await call0<boolean>(page, 'focusRing')).toBe(true);

  await tap(page, rotatable[0]);
  expect(await call0<boolean>(page, 'focusRing')).toBe(false);
});

test('plumber R3: a "rotate" tutorial step never turns a long press into a pickup', async ({ page }) => {
  await openPlumber(page);
  const guide = await call0<{ action: string; cell: number | null } | null>(page, 'guide');
  expect(guide?.action).toBe('rotate');
  expect(guide?.cell).not.toBe(null);

  await longPress(page, guide!.cell!);
  expect(await call0<string | null>(page, 'carried')).toBe(null);
  expect(await call0<boolean>(page, 'moveMode')).toBe(false);
});
