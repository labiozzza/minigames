// Plumber mass certification: deterministic batches across seeds/modes/families.
// Each level: witness replay reaches WON via official model, volume conserved,
// byte-identical regeneration, scrambled state is non-trivial.
import { describe, expect, it } from 'vitest';
import { createRuntime, runToEnd, applyCommand, totalVolume } from '../../src/games/plumber/domain/model';
import { generateLevel, certifySolvable, winsWithoutWitness, type Family } from '../../src/games/plumber/domain/generator';

const MODES = ['child', 'normal', 'expert'] as const;
const PER_MODE = 400;

describe('plumber mass certification', () => {
  it.each(MODES)('mode %s: 400 seeds certify, regenerate identically, non-trivial', (mode) => {
    for (let seed = 1; seed <= PER_MODE; seed++) {
      const id = `mass-${mode}-${seed}`;
      const a = generateLevel(id, seed, { mode });
      expect(certifySolvable(a)).toBe(true);
      expect(winsWithoutWitness(a)).toBe(false);
      expect(totalVolume(createRuntime(a)).ok).toBe(true);
      const b = generateLevel(id, seed, { mode });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});

const FAMILIES: Family[] = ['path', 'leakfix', 'valve', 'filter', 'mixer', 'program', 'carry', 'multiflow', 'exact'];
const PER_FAMILY = 60;

describe('plumber family certification', () => {
  it.each(FAMILIES)('family %s: 60 seeds certify + replay determinism', (family) => {
    for (let seed = 5000; seed < 5000 + PER_FAMILY; seed++) {
      const id = `massfam-${family}-${seed}`;
      const mode = family === 'mixer' || family === 'program' ? 'expert' : 'normal';
      const a = generateLevel(id, seed, { mode, family });
      expect(a.family).toBe(family);
      expect(certifySolvable(a)).toBe(true);
      expect(winsWithoutWitness(a)).toBe(false);
      // Independent replay with a fresh runtime matches the certified outcome.
      const s = createRuntime(a);
      for (const c of a.solutionWitness) expect(applyCommand(s, c)).toBe(true);
      expect(applyCommand(s, { type: 'start' })).toBe(true);
      expect(runToEnd(s)).toBe('WON');
      expect(totalVolume(s).ok).toBe(true);
    }
  });
});
