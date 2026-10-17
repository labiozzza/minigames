// §14 admin panel: real browser clicks. A normal player is refused (403);
// an admin edits a draft, sees a real certified preview, is blocked from
// publishing an invalid/under-certified config, publishes, and rolls back.
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/admin.html');
  await page.fill('#admin-email', email);
  await page.click('#admin-request');
  await expect(page.locator('.card .msg')).toContainText('Тестовый код');
  const msg = await page.locator('.card .msg').textContent();
  const code = /(\d{6})/.exec(msg ?? '')?.[1];
  expect(code, 'test build must expose the OTP code').toBeTruthy();
  await page.fill('#admin-code', code!);
  await page.click('#admin-verify');
}

test('§14 a normal player is refused the admin panel (403)', async ({ page }) => {
  await login(page, 'player@minigames.test');
  await expect(page.locator('.card .msg')).toContainText('403');
  await expect(page.locator('.panel')).toBeHidden();
});

test('§14 admin: draft -> certified preview -> publish -> rollback', async ({ page }) => {
  await login(page, 'admin@minigames.test');
  await expect(page.locator('.panel')).toBeVisible();
  const beforeRev = await page.evaluate(async () => {
    const res = await fetch('http://127.0.0.1:8787/games/plumber/config');
    return ((await res.json()) as { config: { revision: number } }).config.revision;
  });

  // Negative: an unknown field is rejected by the strict schema.
  await page.fill('#admin-draft', JSON.stringify({ generator: { families: ['path'] }, bogus: 1 }, null, 2));
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page.locator('#admin-errors')).toContainText('bogus');

  // Valid draft.
  const draft = {
    generator: { families: ['path', 'valve'], seedSalt: 3, difficulty: { child: 8, normal: 10, expert: 12 } },
    mechanics: { path: true, valve: true },
    collections: { enabled: ['pipe-straight', 'valve'] },
    challenges: { daily: 7, weekly: 2, modes: ['child', 'normal', 'expert'] },
    modules: { enabled: ['plumber', 'water-sort'] },
  };
  await page.fill('#admin-draft', JSON.stringify(draft, null, 2));
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page.locator('.panel .msg').last()).toContainText('Черновик сохранён');

  // Real preview certifies sample levels.
  await page.fill('#admin-seeds', '11,22,33');
  await page.getByRole('button', { name: 'Preview (сертификация)' }).click();
  await expect(page.locator('#admin-preview')).toContainText('certified 3/3');
  await expect(page.locator('#admin-preview tr.ok')).toHaveCount(3);

  // Publish refuses when the seed batch is below the required minimum.
  await page.fill('#admin-minseeds', '6');
  await page.fill('#admin-seeds', '11,22,33');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('#admin-errors')).toContainText('too-few-seeds');
  await expect(page.locator('.panel .msg').last()).toContainText('Publish заблокирован');

  // Publish succeeds with enough certified seeds and records a checksum.
  await page.fill('#admin-minseeds', '3');
  await page.getByRole('button', { name: 'Preview (сертификация)' }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('.panel .msg').last()).toContainText(`Опубликовано v${beforeRev + 1}`);
  await expect(page.locator('.panel .msg').last()).toContainText('fnv1a-');
  await expect(page.locator('#admin-history')).toContainText(`v${beforeRev} ·`);

  // Rollback re-publishes the previous snapshot as a new version.
  await page.getByRole('button', { name: 'Rollback' }).click();
  await expect(page.locator('.panel .msg').last()).toContainText(`Откат: v${beforeRev + 2}`);
  await expect(page.locator('#admin-audit')).toContainText('rollback');

  // The public config now advertises the pinned revision/checksum.
  const cfg = await page.evaluate(async () => {
    const res = await fetch('http://127.0.0.1:8787/games/plumber/config');
    return (await res.json()) as { config: { revision: number; checksum: string } };
  });
  expect(cfg.config.revision).toBe(beforeRev + 2);
  expect(cfg.config.checksum.startsWith('fnv1a-')).toBe(true);
});
