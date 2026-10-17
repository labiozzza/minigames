// P2 generator redesign: task-conditioned candidate selection with measured
// difficulty evidence, rotation-invariant canonical structure, and a genuinely
// new "branch" topology (one source splits to two receivers).
import { describe, expect, it } from 'vitest';
import {
  analyzeLevel,
  canonicalFingerprint,
  certifySolvable,
  generateLevel,
  rotateLevelCW,
  structuralSimilarity,
  winsWithoutWitness,
} from '../../src/games/plumber/domain/generator';

describe('P2: branch topology (flow splitting)', () => {
  it('splits one source into two receivers and stays certified', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const def = generateLevel(`p2-branch-${seed}`, seed, { mode: 'normal', family: 'branch' });
      expect(def.family).toBe('branch');
      expect(def.receivers.length).toBe(2);
      expect(def.cells.some((c) => c.kind === 't')).toBe(true);
      expect(certifySolvable(def)).toBe(true);
      expect(winsWithoutWitness(def)).toBe(false);
    }
  });
});

describe('P2: measured difficulty evidence', () => {
  it('attaches the candidate score and matches analyzeLevel', () => {
    const def = generateLevel('p2-quality', 12345, { mode: 'expert' });
    const e = def.difficultyEvidence;
    expect(typeof e.score).toBe('number');
    expect(e.essentialLength).toBeGreaterThan(0);
    expect(e.meaningfulRatio).toBeGreaterThan(0);
    expect(e.decisions).toBeGreaterThanOrEqual(0);
    expect(e.interactions).toBeGreaterThanOrEqual(1);
    expect(analyzeLevel(def).score).toBe(e.score);
  });

  it('is deterministic for the same id + seed', () => {
    const a = generateLevel('p2-det', 99, { mode: 'normal' });
    const b = generateLevel('p2-det', 99, { mode: 'normal' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('P2: canonical structure (rotation-invariant)', () => {
  it('is invariant across quarter-turns and self-similarity is 1', () => {
    const def = generateLevel('p2-canon', 777, { mode: 'normal' });
    const base = canonicalFingerprint(def);
    for (let q = 0; q < 4; q++) {
      const rot = rotateLevelCW(def, q);
      expect(canonicalFingerprint(rot)).toBe(base);
      expect(structuralSimilarity(def, rot)).toBe(1);
    }
  });

  it('treats structurally different levels as distinct', () => {
    const a = generateLevel('p2-a', 1, { mode: 'expert' });
    const b = generateLevel('p2-b', 2, { mode: 'expert' });
    expect(canonicalFingerprint(a)).not.toBe(canonicalFingerprint(b));
    expect(structuralSimilarity(a, b)).toBeLessThan(1);
  });
});
