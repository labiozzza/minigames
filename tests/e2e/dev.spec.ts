import { expect, test, type Page } from '@playwright/test';

// §16 dev/test-only diagnostics: the panel is present in test builds, a real
// session exports a versioned JSON and replays 1:1 in a fresh browser.
async function openPlumber(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: 1 } })));
  await page.waitForFunction(() => typeof window.__PLUMBER__ !== 'undefined', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__PLUMBER__.sceneReady() === true, null, { timeout: 30000 });
}

type DevHook = {
  dump: () => { schema: string; entries: unknown[]; final: { phase: string; checksum: string } };
  exportJson: () => string;
  importJson: (s: string) => { ok: boolean; steps: number; phase: string; checksum: string; reason?: string };
  batch: (n: number) => { total: number; approved: number; rejected: unknown[] };
  certify: () => { ok: boolean; reasons: string[] };
  panelVisible: () => boolean;
};

const dev = <T,>(page: Page, fn: (h: DevHook) => T) =>
  page.evaluate((f) => new Function('h', `return (${f})(h)`)((window as unknown as { __PLUMBER_DEV__: DevHook }).__PLUMBER_DEV__), fn.toString()) as Promise<T>;

test('dev panel exports a versioned dump and replays it 1:1 in a fresh browser', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto('/?devtools=1');
  await openPlumber(a);
  // Real session: solve and run to completion through the model.
  await a.evaluate(() => window.__PLUMBER__.solve());
  await a.evaluate(() => window.__PLUMBER__.runToEnd());
  await a.waitForFunction(() => window.__PLUMBER__.phase() === 'WON', null, { timeout: 30000 });

  expect(await dev(a, (h) => h.panelVisible())).toBe(true);
  const json = await a.evaluate(() => (window as unknown as { __PLUMBER_DEV__: DevHook }).__PLUMBER_DEV__.exportJson());
  const parsed = JSON.parse(json) as { schema: string; final: { phase: string; checksum: string } };
  expect(parsed.schema).toBe('plumber-diag/1');
  expect(parsed.final.phase).toBe('WON');

  // Fresh browser: re-import and replay; phases/outcome must match 100%.
  await b.goto('/');
  await openPlumber(b);
  const res = await b.evaluate((j) => (window as unknown as { __PLUMBER_DEV__: DevHook }).__PLUMBER_DEV__.importJson(j), json);
  expect(res.ok).toBe(true);
  expect(res.phase).toBe(parsed.final.phase);
  expect(res.checksum).toBe(parsed.final.checksum);

  // B is a different, pristine session, so its local checksum differs until it
  // replays — which is exactly what the import above proved.
  const pristine = await b.evaluate(() => window.__PLUMBER__.checksum());
  expect(pristine).not.toBe(res.checksum);

  await ctxA.close();
  await ctxB.close();
});

test('batch diagnostics and certify gate run for real', async ({ page }) => {
  await page.goto('/');
  await openPlumber(page);
  const batch = await page.evaluate(() => (window as unknown as { __PLUMBER_DEV__: DevHook }).__PLUMBER_DEV__.batch(8));
  expect(batch.total).toBe(8);
  expect(batch.approved).toBeGreaterThan(0);
  const cert = await dev(page, (h) => h.certify());
  expect(cert.ok).toBe(true);
});
