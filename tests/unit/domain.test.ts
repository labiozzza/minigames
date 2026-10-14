import { describe, expect, it } from 'vitest';
import {
  TUBE_CAPACITY,
  applyPourToTubes,
  attemptPour,
  canPour,
  colorCounts,
  createSession,
  isTubeComplete,
  isWin,
  restartSession,
  topRun,
  undoSession,
  type Tube,
} from '../../src/games/water-sort/domain/model';

const L = (id: string, color: string) => ({ id, color });
function tube(id: string, colors: string[]): Tube {
  return { id, layers: colors.map((c, i) => L(`${id}:${i}`, c)) };
}

describe('pour rules', () => {
  it('rejects empty source, full target, mismatch, self', () => {
    const tubes = [tube('a', []), tube('b', ['r', 'r', 'r', 'r']), tube('c', ['g'])];
    expect(canPour(tubes, 0, 2)).toBe('empty-source');
    expect(canPour(tubes, 2, 1)).toBe('target-full');
    expect(canPour(tubes, 2, 2)).toBe('same-tube');
    expect(canPour(tubes, 1, 2)).toBe('color-mismatch');
    expect(attemptPour(createSession(tubes), 0, 2).ok).toBe(false);
  });
  it('moves min(top run, free space) and splits groups', () => {
    const s = createSession([tube('a', ['r', 'r', 'r']), tube('b', ['r'])]);
    const r = attemptPour(s, 0, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.move.count).toBe(3);
      expect(r.move.color).toBe('r');
    }
    expect(isTubeComplete(s.tubes[1])).toBe(true);
    expect(s.tubes[0].layers.length).toBe(0);
  });
  it('partial transfer when target has limited space', () => {
    const s = createSession([tube('a', ['b', 'r', 'r', 'r']), tube('b', ['g', 'g', 'r'])]);
    const r = attemptPour(s, 0, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.move.count).toBe(1);
    expect(s.tubes[0].layers.length).toBe(3);
    expect(s.tubes[1].layers.length).toBe(4);
  });
  it('win requires all non-empty tubes full and monochrome', () => {
    expect(isWin([tube('a', ['r', 'r', 'r', 'r']), tube('b', [])])).toBe(true);
    expect(isWin([tube('a', ['r', 'r', 'r']), tube('b', [])])).toBe(false);
    expect(isWin([tube('a', ['r', 'r', 'r', 'r']), tube('b', ['g'])])).toBe(false);
  });
  it('complete tube is not locked (can pour out of it)', () => {
    const tubes = [tube('a', ['r', 'r', 'r', 'r']), tube('b', [])];
    expect(isTubeComplete(tubes[0])).toBe(true);
    expect(canPour(tubes, 0, 1)).toBe(null);
  });
  it('invariants: color counts preserved by pour/undo/restart', () => {
    const before = new Map([['r', 4], ['g', 4], ['b', 4]]);
    const s = createSession([tube('a', ['r', 'g', 'b', 'r']), tube('b', ['g', 'b', 'g', 'r']), tube('c', ['b', 'r', 'b', 'g']), tube('d', [])]);
    const seq: Array<[number, number]> = [[0, 3], [1, 3], [2, 0], [1, 0]];
    for (const [f, t] of seq) attemptPour(s, f, t);
    const eq = (m: Map<string, number>) =>
      [...before.entries()].every(([k, v]) => m.get(k) === v) && m.size === before.size;
    expect(eq(colorCounts(s.tubes))).toBe(true);
    while (undoSession(s)) { /* drain */ }
    expect(eq(colorCounts(s.tubes))).toBe(true);
    expect(s.tubes.every((t) => t.layers.length <= TUBE_CAPACITY)).toBe(true);
    restartSession(s);
    expect(s.history.length).toBe(0);
    expect(eq(colorCounts(s.tubes))).toBe(true);
  });
  it('undo to start empties history; restart keeps knowledge', () => {
    const s = createSession([tube('a', ['r', 'g']), tube('b', [])]);
    attemptPour(s, 0, 1);
    expect(s.known.size).toBeGreaterThanOrEqual(2);
    const knownAfter = new Set(s.known);
    expect(undoSession(s)).toBe(true);
    expect(undoSession(s)).toBe(false);
    for (const k of knownAfter) expect(s.known.has(k)).toBe(true);
    attemptPour(s, 0, 1);
    restartSession(s);
    expect(s.history.length).toBe(0);
    for (const k of knownAfter) expect(s.known.has(k)).toBe(true);
  });
  it('topRun reads maximal upper group', () => {
    expect(topRun(tube('a', ['r', 'g', 'g']))).toEqual({ color: 'g', count: 2 });
    expect(topRun(tube('a', []))).toBe(null);
  });
  it('applyPourToTubes is atomic (null leaves state untouched)', () => {
    const tubes = [tube('a', ['r']), tube('b', ['g', 'g', 'g', 'g'])];
    const snap = JSON.stringify(tubes);
    expect(applyPourToTubes(tubes, 0, 1)).toBe(null);
    expect(JSON.stringify(tubes)).toBe(snap);
  });
});
