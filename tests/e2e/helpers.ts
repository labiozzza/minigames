import { expect, type Page } from '@playwright/test';
import { generatePuzzle } from '../../src/games/water-sort/generation/generator';

export interface MGState {
  level: number;
  tubes: string[][];
  knownCount: number;
  historyLen: number;
  selected: number | null;
  animating: boolean;
  win: boolean;
  tubeCount: number;
  webgl: boolean;
}

export async function mg(page: Page): Promise<MGState> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __MG: {
        level: number;
        tubes: () => string[][];
        knownCount: () => number;
        historyLen: () => number;
        selected: () => number | null;
        animating: () => boolean;
        win: () => boolean;
        tubeCount: () => number;
        webgl: () => boolean;
      };
    }).__MG;
    return {
      level: g.level,
      tubes: g.tubes(),
      knownCount: g.knownCount(),
      historyLen: g.historyLen(),
      selected: g.selected(),
      animating: g.animating(),
      win: g.win(),
      tubeCount: g.tubeCount(),
      webgl: g.webgl(),
    };
  });
}

export function keyFor(i: number): string {
  if (i < 10) return '1234567890'[i];
  return 'qwer'[i - 10];
}

export async function waitForGame(page: Page, level: number): Promise<void> {
  await page.waitForFunction((lv) => (window as unknown as { __MG?: { level: number } }).__MG?.level === lv, level, { timeout: 30000 });
  const st = await mg(page);
  expect(st.webgl).toBe(true);
}

export async function dismissTutorial(page: Page): Promise<void> {
  const skip = page.locator('.tutorial-card .btn').first();
  if (await skip.isVisible({ timeout: 5000 }).catch(() => false)) {
    await skip.click();
  }
}

export async function pour(page: Page, from: number, to: number): Promise<void> {
  const before = (await mg(page)).historyLen;
  await page.keyboard.press(keyFor(from));
  await page.keyboard.press(keyFor(to));
  await expect
    .poll(async () => (await mg(page)).historyLen, { timeout: 15000 })
    .toBe(before + 1);
}

/** First pour that is legal under public information (capacity 4). */
export async function legalPour(page: Page): Promise<{ f: number; t: number }> {
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
        if (t === f) continue;
        if (tubes[t].length >= 4) continue;
        const dt = top(t);
        if (dt && dt !== c) continue;
        return { f, t };
      }
    }
    return null;
  });
  if (!cand) throw new Error('no legal pour found');
  await pour(page, cand.f, cand.t);
  return cand;
}

export async function solveLevel(page: Page, level: number, maxMoves = 200): Promise<void> {
  const cert = generatePuzzle(level).solution.slice(0, maxMoves);
  for (const m of cert) {
    if ((await mg(page)).win) break;
    await pour(page, m.from, m.to);
  }
  await expect.poll(async () => (await mg(page)).win, { timeout: 30000 }).toBe(true);
}

export async function setSpeedInstant(page: Page): Promise<void> {
  await page.locator('.topbar .top-actions .icon-btn').nth(1).click();
  await page.locator('.settings-form select').nth(2).selectOption('instant');
  await page.locator('.modal-row .btn.primary').last().click();
}
