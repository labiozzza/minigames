// Mass certification: >=10 000 deterministic level ids.
// For each: structural invariants, hidden-layer cap, visible tops,
// certificate replay with player rules to a win, byte-identical regeneration,
// regression fixtures for pinned levels.
import { describe, expect, it } from 'vitest';
import {
  applyPourToTubes,
  colorCounts,
  isTubeComplete,
  isWin,
  TUBE_CAPACITY,
  type LayerId,
} from '../../src/games/water-sort/domain/model';
import {
  checksumOf,
  generatePuzzle,
  normalizePuzzle,
} from '../../src/games/water-sort/generation/generator';
import {
  BALANCE_VERSION,
  GENERATOR_VERSION,
  HIDDEN_MAX_FRACTION,
} from '../../src/games/water-sort/config/balance';

const FIXTURES: Record<number, { checksum: string; sol: number; hidden: number }> = {
  1: { checksum: '94f8f604c624ff22', sol: 9, hidden: 0 },
  2: { checksum: '958854c6323c6182', sol: 9, hidden: 0 },
  100: { checksum: '621d9b423e8c3c32', sol: 26, hidden: 0 },
  101: { checksum: 'ee33c130efd32702', sol: 27, hidden: 1 },
  300: { checksum: 'e349a7a5bb6b2e41', sol: 24, hidden: 15 },
};

function checkPuzzle(level: number): void {
  const p = generatePuzzle(level);
  // Identity metadata.
  expect(p.levelNumber).toBe(level);
  expect(p.generatorVersion).toBe(GENERATOR_VERSION);
  expect(p.balanceVersion).toBe(BALANCE_VERSION);
  // Structural invariants.
  expect(p.tubes.length).toBeGreaterThanOrEqual(5);
  expect(p.tubes.length).toBeLessThanOrEqual(14);
  expect(p.tubes.length).toBe(p.colors.length + 2);
  for (const t of p.tubes) expect(t.layers.length).toBeLessThanOrEqual(TUBE_CAPACITY);
  const counts = colorCounts(p.tubes);
  expect(counts.size).toBe(p.colors.length);
  for (const c of p.colors) expect(counts.get(c)).toBe(TUBE_CAPACITY);
  const ids = new Set<LayerId>();
  for (const t of p.tubes)
    for (const l of t.layers) {
      expect(ids.has(l.id)).toBe(false);
      ids.add(l.id);
    }
  // Hidden-layer rules: cap 50%, tops always visible.
  const hidden = new Set(p.hiddenLayerIds);
  expect(hidden.size).toBe(p.hiddenLayerIds.length);
  expect(hidden.size).toBeLessThanOrEqual(Math.floor(p.colors.length * TUBE_CAPACITY * HIDDEN_MAX_FRACTION));
  for (const t of p.tubes) {
    const top = t.layers[t.layers.length - 1];
    if (top) expect(hidden.has(top.id)).toBe(false);
  }
  if (level < 101) expect(hidden.size).toBe(0);
  // Not already won; at least one tube incomplete-or-empty pressure exists.
  expect(isWin(p.tubes)).toBe(false);
  // Certificate replay with player rules only.
  const sim = p.tubes.map((t) => ({ id: t.id, layers: t.layers.slice() }));
  for (const m of p.solution) {
    expect(applyPourToTubes(sim, m.from, m.to)).not.toBe(null);
  }
  expect(isWin(sim)).toBe(true);
  // Determinism: regeneration is byte-identical.
  const p2 = generatePuzzle(level);
  expect(normalizePuzzle(p2)).toBe(normalizePuzzle(p));
  expect(p2.checksum).toBe(p.checksum);
  expect(checksumOf(normalizePuzzle(p))).toBe(p.checksum);
  // Fixtures for pinned levels.
  const f = FIXTURES[level];
  if (f) {
    expect(p.checksum).toBe(f.checksum);
    expect(p.solution.length).toBe(f.sol);
    expect(p.hiddenLayerIds.length).toBe(f.hidden);
  }
  void isTubeComplete;
}

describe('mass certification 1..10000', () => {
  it('all levels validate', () => {
    const t0 = Date.now();
    let fails = 0;
    for (let level = 1; level <= 10000; level++) {
      try {
        checkPuzzle(level);
      } catch (e) {
        fails++;
        if (fails <= 5) console.log(`LEVEL ${level} FAILED: ${(e as Error).message}`);
      }
    }
    console.log(`mass: 10000 levels, fails=${fails}, dt=${Date.now() - t0}ms`);
    expect(fails).toBe(0);
  }, 600000);
});

describe('threshold and high levels', () => {
  it.each([1, 2, 3, 99, 100, 101, 102, 299, 300, 301, 1000, 10000, 100000])('level %i validates', (level) => {
    checkPuzzle(level);
  }, 60000);
});
