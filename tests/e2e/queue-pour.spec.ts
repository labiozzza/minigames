import { expect, test, type Page } from '@playwright/test';
import { keyFor, mg, waitForGame } from './helpers';

interface Dbg {
  selected: number | null;
  animating: boolean;
  stage: string;
  queued: { from: number; to: number } | null;
  audit: { srcVisible: boolean; srcInBounds: boolean; streamOn: boolean } | null;
}

async function dbg(page: Page): Promise<Dbg> {
  return page.evaluate(() => {
    const g = (window as unknown as { __MG: { dbg: () => never } }).__MG;
    return (g.dbg as unknown as () => Dbg)();
  });
}

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.game-card .btn.primary').click();
  await waitForGame(page, 1);
  await page.locator('.tutorial-card .btn').first().click();
}

interface Cand {
  f: number;
  t: number;
  run: number;
}

/** All currently legal pours with the moved-block count. */
async function legalPours(page: Page): Promise<Cand[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __MG: { tubes: () => string[][] } }).__MG;
    const tubes = s.tubes();
    const top = (i: number): string | null => (tubes[i].length ? tubes[i][tubes[i].length - 1] : null);
    const runLen = (i: number): number => {
      const t = tubes[i];
      const c = t[t.length - 1];
      let n = 1;
      for (let k = t.length - 2; k >= 0 && t[k] === c; k--) n++;
      return n;
    };
    const out: Cand[] = [];
    for (let f = 0; f < tubes.length; f++) {
      const c = top(f);
      if (!c || c === '?') continue;
      for (let t = 0; t < tubes.length; t++) {
        if (t === f || tubes[t].length >= 4) continue;
        const dt = top(t);
        if (dt && dt !== c) continue;
        out.push({ f, t, run: Math.min(runLen(f), 4 - tubes[t].length) });
      }
    }
    return out;
  });
}

async function nonEmpty(page: Page, exclude: number[]): Promise<number> {
  const tubes = (await mg(page)).tubes;
  const i = tubes.findIndex((t, k) => t.length > 0 && !exclude.includes(k));
  if (i < 0) throw new Error('no non-empty tube');
  return i;
}

test('tap during animation selects immediately, queued pour chains', async ({ page }) => {
  await setup(page);

  const startPour = async (): Promise<void> => {
    const c = (await legalPours(page))[0];
    await page.keyboard.press(keyFor(c.f));
    await page.keyboard.press(keyFor(c.t));
    await expect.poll(async () => (await dbg(page)).animating, { timeout: 8000 }).toBe(true);
  };

  await startPour();

  // 1. Selection applies mid-flight (no input swallowing).
  const x = await nonEmpty(page, []);
  await page.keyboard.press(keyFor(x));
  expect(await dbg(page).then((d) => d.selected)).toBe(x);

  // 2. A complete pair tapped mid-flight queues and executes after.
  // Ensure a live animation window (slow machines may have settled already).
  if (!(await dbg(page)).animating) await startPour();
  // Deselect if a stale selection survived, so the queued pair is unambiguous.
  const sel = (await dbg(page)).selected;
  if (sel !== null) {
    await page.keyboard.press(keyFor(sel));
    expect(await dbg(page).then((d) => d.selected)).toBe(null);
  }
  const snapshot = (await mg(page)).tubes;
  const h = (await mg(page)).historyLen;
  const p2 = (await legalPours(page))[0];
  await page.keyboard.press(keyFor(p2.f));
  await page.keyboard.press(keyFor(p2.t));
  // Either the pair queued mid-flight, or the flight had just ended and the
  // pair executed as a normal pour — both prove no tap is ever swallowed.
  await expect
    .poll(
      async () => {
        const d = await dbg(page);
        return d.queued !== null || (await mg(page)).historyLen === h + 1;
      },
      { timeout: 8000 },
    )
    .toBe(true);

  await expect.poll(async () => (await mg(page)).historyLen, { timeout: 20000 }).toBe(h + 1);
  await expect.poll(async () => (await mg(page)).animating, { timeout: 20000 }).toBe(false);

  // 3. The chained move is a real logic move: undo restores the exact tubes.
  await page.locator('.bottombar .action-btn').nth(0).click();
  await expect.poll(async () => (await mg(page)).historyLen, { timeout: 8000 }).toBe(h);
  expect((await mg(page)).tubes).toEqual(snapshot);
});

test('multi-block pour animates every block (no teleport)', async ({ page }) => {
  await setup(page);
  // Play a few opening moves until a multi-block pour becomes available.
  let multi: Cand | undefined;
  for (let i = 0; i < 6 && !multi; i++) {
    multi = (await legalPours(page)).find((c) => c.run > 1);
    if (!multi) {
      const c = (await legalPours(page))[0];
      await page.keyboard.press(keyFor(c.f));
      await page.keyboard.press(keyFor(c.t));
      await expect.poll(async () => (await mg(page)).animating, { timeout: 20000 }).toBe(false);
    }
  }
  expect(multi, 'a multi-block pour must appear within the opening').toBeDefined();
  const { f, t, run } = multi!;
  const srcBefore = (await mg(page)).tubes[f].length;
  const dstBefore = (await mg(page)).tubes[t].length;

  const timed = page.evaluate(
    () =>
      new Promise<{ stages: string[]; pourMs: number }>((resolve) => {
        const get = () => (window as unknown as { __MG: { dbg: () => { stage: string } } }).__MG.dbg().stage;
        const stages: string[] = [];
        let last = 'idle';
        let pourStart = 0;
        let pourMs = 0;
        const t0 = performance.now();
        const tick = () => {
          const s = get();
          if (s !== last) {
            stages.push(s);
            const now = performance.now();
            if (s === 'pour') pourStart = now;
            if (last === 'pour') pourMs += now - pourStart;
            last = s;
          }
          if ((s === 'idle' && stages.length > 0) || performance.now() - t0 > 15000) {
            resolve({ stages, pourMs });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.keyboard.press(keyFor(f));
  await page.keyboard.press(keyFor(t));
  const { stages, pourMs } = await timed;

  // Every block gets its own visible pour window (~unitMs each, min 160ms).
  expect(pourMs).toBeGreaterThanOrEqual(run * 140);
  expect(stages).toContain('pour');

  await expect.poll(async () => (await mg(page)).animating, { timeout: 20000 }).toBe(false);
  const after = (await mg(page)).tubes;
  expect(srcBefore - after[f].length).toBe(run);
  expect(after[t].length - dstBefore).toBe(run);
  const audit = (await dbg(page)).audit;
  expect(audit?.srcVisible).toBe(true);
});
