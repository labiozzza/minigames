import { expect, test } from '@playwright/test';
import { keyFor, mg, waitForGame } from './helpers';

test.use({ video: 'on' });

interface Dbg {
  selected: number | null;
  animating: boolean;
  historyLen: number;
  stage: string;
  stages: string[];
  audit: { srcVisible: boolean; srcInBounds: boolean; streamOn: boolean } | null;
}

async function dbg(page: import('@playwright/test').Page): Promise<Dbg> {
  return page.evaluate(() => {
    const g = (window as unknown as { __MG: { dbg: () => never } }).__MG;
    return (g.dbg as unknown as () => Dbg)();
  });
}

async function findPair(
  page: import('@playwright/test').Page,
  pred?: (f: number, t: number, tubes: string[][]) => boolean,
): Promise<{ f: number; t: number }> {
  const cand = await page.evaluate((wantSplit: boolean) => {
    const s = (window as unknown as { __MG: { tubes: () => string[][] } }).__MG;
    const tubes = s.tubes();
    const top = (i: number): string | null => {
      const t = tubes[i];
      return t.length ? t[t.length - 1] : null;
    };
    const runLen = (i: number): number => {
      const t = tubes[i];
      const c = t[t.length - 1];
      let n = 1;
      for (let k = t.length - 2; k >= 0 && t[k] === c; k--) n++;
      return n;
    };
    const out: Array<{ f: number; t: number; adj: boolean; split: boolean; run: number }> = [];
    for (let f = 0; f < tubes.length; f++) {
      const c = top(f);
      if (!c || c === '?') continue;
      for (let t = 0; t < tubes.length; t++) {
        if (t === f || tubes[t].length >= 4) continue;
        const dt = top(t);
        if (dt && dt !== c) continue;
        out.push({
          f,
          t,
          adj: Math.abs(f - t) === 1,
          split: (f < 5) !== (t < 5),
          run: Math.min(runLen(f), 4 - tubes[t].length),
        });
      }
    }
    if (wantSplit) {
      const s = out.find((o) => o.split) ?? out[0];
      return s ? { f: s.f, t: s.t } : null;
    }
    const a = out.find((o) => o.adj) ?? out[0];
    if (!a) return null;
    const multi = out.find((o) => o.run > 1);
    return { f: (multi ?? a).f, t: (multi ?? a).t, multi: !!multi };
  }, !!pred);
  if (!cand) throw new Error('no legal pour');
  return cand;
}

test('pour stages: lift, tilt, pour, return + visibility audit (desktop)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Water Sort' }).locator('.btn.primary').click();
  await waitForGame(page, 1);
  await page.locator('.tutorial-card .btn').first().click();

  const { f, t } = await findPair(page);
  // The scene records every stage transition itself (event-driven), so the
  // assertion never races requestAnimationFrame under load — no phase can be
  // skipped by a slow sampler.
  await page.keyboard.press(keyFor(f));
  await page.keyboard.press(keyFor(t));
  await expect.poll(async () => (await dbg(page)).animating, { timeout: 20000 }).toBe(false);
  const seen = (await dbg(page)).stages;
  // Required order through the flight phases (extra phases like move/settle allowed).
  const order = ['lift', 'tilt', 'pour', 'return'];
  const firstIdx = (s: string): number => seen.indexOf(s);
  for (const s of order) expect(firstIdx(s), `stage ${s} observed`).toBeGreaterThanOrEqual(0);
  expect(firstIdx('lift')).toBeLessThan(firstIdx('tilt'));
  expect(firstIdx('tilt')).toBeLessThan(firstIdx('pour'));
  expect(firstIdx('pour')).toBeLessThan(firstIdx('return'));
  const audit = (await dbg(page)).audit;
  expect(audit).not.toBe(null);
  expect(audit!.srcVisible).toBe(true);
  expect(audit!.srcInBounds).toBe(true);
  expect(audit!.streamOn).toBe(true);

  // Second pour, dedicated to intermediate frames (no sampling pressure).
  const p2 = await findPair(page);
  await page.keyboard.press(keyFor(p2.f));
  await page.keyboard.press(keyFor(p2.t));
  try {
    await page.waitForFunction(
      () => (window as unknown as { __MG: { dbg: () => { stage: string } } }).__MG.dbg().stage === 'tilt',
      null,
      { timeout: 15000 },
    );
    await page.screenshot({ path: 'evidence/stages/stage-tilt.png' });
  } catch {
    // Frame timing is best-effort; the stage order above is the real assertion.
  }
  try {
    await page.waitForFunction(
      () => (window as unknown as { __MG: { dbg: () => { stage: string } } }).__MG.dbg().stage === 'pour',
      null,
      { timeout: 15000 },
    );
    await page.screenshot({ path: 'evidence/stages/stage-pour.png' });
  } catch {
    // Best-effort frame.
  }
  await page.screenshot({ path: 'evidence/stages/stage-after.png' });
});

test('cross-row pour on narrow screen, fast speed (mobile matrix)', async ({ page }) => {
  await page.addInitScript(() => {
    const open = indexedDB.open('minigames', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onsuccess = () => {
      const save = {
        schemaVersion: 1,
        settings: {
          theme: 'system', lang: 'ru', music: false, musicVolume: 0.5,
          sfx: false, sfxVolume: 0.7, vibration: false, speed: 'fast',
          symbols: false, installDismissed: true,
        },
        games: {
          'water-sort': {
            maxLevel: 50, completed: Array.from({ length: 49 }, (_, i) => i + 1),
            active: null, tutorialBasic: true, tutorialMystery: true,
          },
        },
        lastPlayed: { gameId: 'water-sort', levelNumber: 50 },
        updatedAt: Date.now(),
      };
      const tx = open.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(JSON.stringify(save), 'save-v1');
    };
  });
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Water Sort' }).locator('.btn.primary').click();
  await waitForGame(page, 50);
  const { f, t } = await findPair(page, () => true);
  const h0 = (await mg(page)).historyLen;
  await page.keyboard.press(keyFor(f));
  await page.keyboard.press(keyFor(t));
  await expect.poll(async () => (await mg(page)).historyLen, { timeout: 15000 }).toBe(h0 + 1);
  await expect.poll(async () => (await dbg(page)).animating, { timeout: 15000 }).toBe(false);
  const a = (await dbg(page)).audit;
  expect(a).not.toBe(null);
  expect(a!.srcVisible).toBe(true);
  expect(a!.srcInBounds).toBe(true);
  expect(a!.streamOn).toBe(true);
});

test('instant speed: no stages, correct logic + undo', async ({ page }) => {
  await page.goto('/');
  await page.locator('.game-card', { hasText: 'Water Sort' }).locator('.btn.primary').click();
  await waitForGame(page, 1);
  await page.locator('.tutorial-card .btn').first().click();
  await page.locator('.topbar .top-actions .icon-btn').nth(1).click();
  await page.locator('.settings-form select').nth(2).selectOption('instant');
  await page.locator('.modal-row .btn.primary').last().click();
  const { f, t } = await findPair(page);
  const h0 = (await mg(page)).historyLen;
  await page.keyboard.press(keyFor(f));
  await page.keyboard.press(keyFor(t));
  await expect.poll(async () => (await mg(page)).historyLen, { timeout: 15000 }).toBe(h0 + 1);
  expect((await dbg(page)).stage).toBe('idle');
  await page.locator('.bottombar .action-btn').nth(0).click();
  await expect.poll(async () => (await mg(page)).historyLen, { timeout: 15000 }).toBe(h0);
});
