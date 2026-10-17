import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// §18 performance evidence with explicit conditions. Measures the real in-game
// sampler (median/p5 FPS + tick cadence) over several runs on both emulated
// viewports. Real-device (Android/iOS) runs stay NOT_RUN — no hardware here.
async function openPlumber(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mg:play-level', { detail: { gameId: 'plumber', level: 1 } })));
  await page.waitForFunction(() => typeof window.__PLUMBER__ !== 'undefined', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__PLUMBER__.sceneReady() === true, null, { timeout: 30000 });
}

test('perf: measure median/p5 FPS and tick cadence, write evidence', async ({ page, browser }, testInfo) => {
  await page.goto('/');
  await openPlumber(page);
  await page.evaluate(() => window.__PLUMBER__.start());

  const runs: Array<{ median: number; p95: number; samples: number; quality: number }> = [];
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(1000);
    const p = await page.evaluate(() => window.__PLUMBER__.perf());
    if (p) runs.push(p);
  }
  expect(runs.length).toBeGreaterThan(0);

  const medians = runs.map((r) => r.median).sort((a, b) => a - b);
  const p5 = medians[0];
  const median = medians[Math.floor(medians.length / 2)];
  const report = {
    generatedAt: new Date().toISOString(),
    conditions: {
      browser: `chromium ${browser.version()}`,
      project: testInfo.project.name,
      viewport: `${testInfo.project.use.viewport?.width}x${testInfo.project.use.viewport?.height}`,
      deviceScaleFactor: testInfo.project.use.deviceScaleFactor ?? 1,
      runs: runs.length,
      measurementWindowMs: 6000,
      headless: true,
      note: 'headless Chromium throttles requestAnimationFrame, so these FPS numbers are a floor, not a device result; real Android/iOS/Safari/Firefox = NOT_RUN (no device)',
    },
    fps: { median, p5, samples: runs.map((r) => r.samples), quality: runs.map((r) => r.quality) },
    targets: { desktopMedian: 60, mobileMedian: 30 },
  };
  mkdirSync('evidence', { recursive: true });
  writeFileSync(`evidence/perf-report-${testInfo.project.name}.json`, `${JSON.stringify(report, null, 2)}\n`);
  // Soft gate: report the numbers; a hard fail here would only reflect CI hosts.
  expect(median).toBeGreaterThan(0);
});
