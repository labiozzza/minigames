import { expect, test, type Page } from '@playwright/test';

// §12 accessibility, audio prefs, auto-quality and renderer fallback.
type Dims = { w: number; h: number; cell: number; ox: number; oy: number };

async function waitPlumber(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: unknown }).__PLUMBER__ !== undefined, null, { timeout: 30000 });
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('.head-actions .icon-btn').last().click({ force: true });
  await expect(page.locator('.settings-form')).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
  await page.locator('.modal-overlay.settings .modal-row .btn.primary').last().click({ force: true });
  await expect(page.locator('.settings-form')).toHaveCount(0);
}

async function setToggle(page: Page, label: string, on: boolean): Promise<void> {
  const box = page.locator('.setting-row', { hasText: label }).locator('input[type=checkbox]');
  if ((await box.isChecked()) !== on) await box.click({ force: true });
}

async function setSelect(page: Page, label: string, value: string): Promise<void> {
  await page.locator('.setting-row', { hasText: label }).locator('select').selectOption(value);
}

const hook = <T,>(page: Page, fn: string) =>
  page.evaluate((f) => (window as unknown as { __PLUMBER__: Record<string, () => unknown> }).__PLUMBER__[f]() as T, fn);

test('a11y settings persist and reflect onto the root as deterministic classes', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await setToggle(page, 'Высокий контраст', true);
  await setToggle(page, 'Крупный интерфейс', true);
  await setToggle(page, 'Уменьшить анимацию', true);
  await setToggle(page, 'Без вспышек', true);
  await closeSettings(page);
  const cls = await page.evaluate(() => [...document.documentElement.classList]);
  expect(cls).toEqual(expect.arrayContaining(['a11y-contrast', 'a11y-large', 'a11y-reduce-motion', 'a11y-flash-free']));
  await page.reload();
  expect(await page.evaluate(() => [...document.documentElement.classList])).toContain('a11y-contrast');
});

test('a11y: keyboard alone rotates without any drag, with a visible cursor', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await setToggle(page, 'Управление без перетаскивания', true);
  await closeSettings(page);
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await page.locator('#plumber-field').click({ position: { x: 5, y: 5 } });
  const idx = (await hook<number[]>(page, 'rotatable'))[0];
  const before = await hook<string>(page, 'checksum');
  const d = await hook<Dims>(page, 'grid');
  for (let i = 0; i < idx % d.w; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < Math.floor(idx / d.w); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const after = await hook<string>(page, 'checksum');
  expect(after).not.toBe(before);
  expect(await hook<number>(page, 'focus')).toBe(idx);
});

test('a11y: colour-independent symbols render in an atlas scene', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await setToggle(page, 'Показывать символы цветов', true);
  await closeSettings(page);
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await hook(page, 'solve');
  await hook(page, 'runToEnd');
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { phase: () => string } }).__PLUMBER__?.phase() === 'WON', null, { timeout: 15000 });
  expect(await hook<boolean | null>(page, 'usesFallback')).toBe(false);
});

test('quality: manual low pins the level; renderer fallback to canvas still renders', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await setSelect(page, 'Качество графики', 'low');
  await closeSettings(page);
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { renderer: () => string | null } }).__PLUMBER__?.renderer() !== null, null, { timeout: 15000 });
  expect(await hook<string | null>(page, 'renderer')).toBe('webgl');
  await page.waitForFunction(() => ((window as unknown as { __PLUMBER__?: { perf: () => { samples: number; quality: number } | null } }).__PLUMBER__?.perf()?.quality ?? -1) === 2, null, { timeout: 20000 });
  const perf = await hook<{ samples: number; quality: number; p95: number } | null>(page, 'perf');
  expect(perf).not.toBeNull();
  expect(perf!.samples).toBeGreaterThan(0);

  await page.goto('/?renderer=canvas');
  await page.locator('.game-card', { hasText: 'Водопроводчик' }).locator('.btn.primary').click();
  await waitPlumber(page);
  await page.waitForFunction(() => (window as unknown as { __PLUMBER__?: { renderer: () => string | null } }).__PLUMBER__?.renderer() === 'canvas', null, { timeout: 15000 });
  const box = await page.locator('#plumber-field canvas').boundingBox();
  expect(box!.width).toBeGreaterThan(100);
});
