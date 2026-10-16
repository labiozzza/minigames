// Plumber Stage 1 solver: independent certification + tiny-grid search.
// Uses ONLY the official model (applyCommand/runToEnd); never a copy of rules.

import {
  applyCommand,
  createRuntime,
  runToEnd,
  totalVolume,
  type LevelDefinition,
  type PlumberCommand,
} from './model';
import { certifySolvable } from './generator';

export interface SolveResult {
  solvable: boolean;
  /** Verified command sequence (replay reaches WON). */
  solution: PlumberCommand[] | null;
  checkedStates: number;
}

/** Verify the stored witness by independent replay (generator certification). */
export function verifyWitness(def: LevelDefinition): boolean {
  return certifySolvable(def);
}

/**
 * Brute-force search over rotations for tiny grids (≤7 rotatable cells).
 * Returns a verified solution or { solvable:false }. Bounded, never hangs.
 */
export function solveSmall(def: LevelDefinition, maxStates = 50000): SolveResult {
  const rotatable: number[] = [];
  const ROT_KINDS = ['straight', 'elbow', 't', 'cross', 'cap', 'valve', 'filter', 'mixer', 'distributor'];
  def.cells.forEach((c, i) => {
    if (!c.locked && ROT_KINDS.includes(c.kind)) {
      rotatable.push(i);
    }
  });
  if (rotatable.length > 7) return { solvable: false, solution: null, checkedStates: 0 };

  const tryCombo = (rots: number[]): boolean => {
    const s = createRuntime(def);
    s.rots = [...rots];
    if (!applyCommand(s, { type: 'start' })) return false;
    if (runToEnd(s) !== 'WON') return false;
    return totalVolume(s).ok;
  };

  // 0) Scrambled-as-is (detects trivial puzzles).
  const base = def.cells.map((c) => c.rot);
  let checked = 0;
  if (tryCombo(base)) {
    checked += 1;
    return { solvable: true, solution: [], checkedStates: checked };
  }
  checked += 1;

  // 1) BFS over single-rotation increments (each cell 0..3 extra turns).
  // Total combos 4^k; cap by maxStates.
  const k = rotatable.length;
  const total = Math.min(Math.pow(4, k), maxStates);
  for (let combo = 1; combo < total; combo++) {
    const rots = [...base];
    let x = combo;
    const cmds: PlumberCommand[] = [];
    for (let j = 0; j < k; j++) {
      const turns = x % 4;
      x = Math.floor(x / 4);
      for (let t = 0; t < turns; t++) cmds.push({ type: 'rotate', index: rotatable[j] });
      rots[rotatable[j]] = (rots[rotatable[j]] + turns) % 4;
    }
    checked += 1;
    if (tryCombo(rots)) return { solvable: true, solution: cmds, checkedStates: checked };
    if (x > 0) break; // combo exceeded enumeration (when capped)
  }
  return { solvable: false, solution: null, checkedStates: checked };
}

/** Hint from current runtime: first witness rotation still applicable, else null. */
export function hintFromWitness(def: LevelDefinition, currentRots: number[]): PlumberCommand | null {
  // Reconstruct solved rots by applying witness to the *initial* (scrambled) rots.
  const solved = def.cells.map((c) => c.rot);
  for (const cmd of def.solutionWitness) {
    if (cmd.type === 'rotate') solved[cmd.index] = (solved[cmd.index] + 1) % 4;
  }
  for (let i = 0; i < solved.length; i++) {
    if (currentRots[i] !== solved[i]) return { type: 'rotate', index: i };
  }
  return null;
}
