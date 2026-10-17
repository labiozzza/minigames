// Solver proof statuses (TZ v1.2 §6.2): exhaustive small-grid proofs report
// OPTIMAL_PROVEN; large grids honestly report SOLVABLE_WITH_WITNESS /
// OPTIMAL_NOT_PROVEN / UNKNOWN_TIMEOUT and are never called UNSOLVABLE due to a
// search limit.
import { describe, expect, it } from 'vitest';
import { generateLevel, type Family } from '../../src/games/plumber/domain/generator';
import { createRuntime, runToEnd, applyCommand, totalVolume, type LevelDefinition } from '../../src/games/plumber/domain/model';
import { diagnose } from '../../src/games/plumber/domain/solver';

function replay(def: LevelDefinition, cmds: readonly { type: string }[]): void {
  const s = createRuntime(def);
  for (const c of cmds) expect(applyCommand(s, c as Parameters<typeof applyCommand>[1])).toBe(true);
  expect(applyCommand(s, { type: 'start' })).toBe(true);
  expect(runToEnd(s)).toBe('WON');
  expect(totalVolume(s).ok).toBe(true);
}

const VALID: string[] = ['OPTIMAL_PROVEN', 'SOLVABLE_WITH_WITNESS', 'OPTIMAL_NOT_PROVEN', 'UNKNOWN_TIMEOUT', 'UNSOLVABLE_PROVEN'];

describe('diagnose: proof statuses', () => {
  it('exhaustively proves optimal cost when it can, and every status replays', () => {
    let optimal = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const def = generateLevel(`diag-child-${seed}`, seed, { mode: 'child' });
      const d = diagnose(def);
      expect(VALID).toContain(d.status);
      if (d.status === 'OPTIMAL_PROVEN') {
        optimal += 1;
        expect(d.exhaustive).toBe(true);
        expect(d.minRotations).not.toBeNull();
        expect(d.checkedStates).toBeGreaterThan(0);
        replay(def, d.solution ?? []);
      }
      if (d.status === 'SOLVABLE_WITH_WITNESS') expect(d.solvable).toBe(true);
    }
    expect(optimal).toBeGreaterThan(0);
  });

  it('never reports UNSOLVABLE because of a budget on larger grids', { timeout: 30000 }, () => {
    const families: Family[] = ['path', 'leakfix', 'valve', 'filter', 'mixer', 'program', 'carry', 'multiflow', 'exact'];
    for (const family of families) {
      for (let seed = 200; seed < 209; seed++) {
        const def = generateLevel(`diag-large-${family}-${seed}`, seed, { mode: 'expert', family });
        const d = diagnose(def);
        expect(VALID).toContain(d.status);
        expect(d.status).not.toBe('UNSOLVABLE_PROVEN');
        if (d.status === 'OPTIMAL_PROVEN') replay(def, d.solution ?? []);
      }
    }
  });

  it('honestly times out (not unsolvable) when the witness is unavailable and the grid is large', () => {
    let large: LevelDefinition | null = null;
    for (let seed = 300; seed < 340 && !large; seed++) {
      const def = generateLevel(`diag-nw-${seed}`, seed, { mode: 'expert' });
      const rotatable = def.cells.filter((c) => !c.locked).length;
      if (rotatable > 7) large = def;
    }
    expect(large).not.toBeNull();
    const stripped: LevelDefinition = { ...large!, solutionWitness: [] };
    const d = diagnose(stripped, 200);
    expect(['UNKNOWN_TIMEOUT', 'OPTIMAL_NOT_PROVEN']).toContain(d.status);
    expect(d.status).not.toBe('UNSOLVABLE_PROVEN');
  });

  it('is deterministic for a fixed level definition', () => {
    const def = generateLevel('diag-det', 7, { mode: 'child' });
    expect(diagnose(def)).toEqual(diagnose(def));
  });
});
