// Plumber Stage 1 mass certification: deterministic batch across seeds/modes.
// Each level: witness replay reaches WON via official model, volume conserved,
// byte-identical regeneration, scrambled state is non-trivial.
import { describe, expect, it } from 'vitest';
import { createRuntime, totalVolume } from '../../src/games/plumber/domain/model';
import { generateLevel, certifySolvable, winsWithoutWitness } from '../../src/games/plumber/domain/generator';

const MODES = ['child', 'normal', 'expert'] as const;
const PER_MODE = 400; // 1200 total in this file; full 10k target tracked for Stage 6

describe('plumber mass certification', () => {
  it.each(MODES)('mode %s: %d seeds certify, regenerate identically, non-trivial', (mode, _n) => {
    void _n;
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
