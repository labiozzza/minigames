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

export type ProofStatus =
  | 'OPTIMAL_PROVEN'
  | 'SOLVABLE_WITH_WITNESS'
  | 'OPTIMAL_NOT_PROVEN'
  | 'UNKNOWN_TIMEOUT'
  | 'UNSOLVABLE_PROVEN';

export interface Diagnosis {
  status: ProofStatus;
  solvable: boolean;
  /** Minimal rotation count when proven exhaustively, else null. */
  minRotations: number | null;
  solution: PlumberCommand[] | null;
  checkedStates: number;
  exhaustive: boolean;
}

const ROT_KINDS = ['straight', 'elbow', 't', 'cross', 'cap', 'valve', 'filter', 'mixer', 'distributor'];

function rotatableCells(def: LevelDefinition): number[] {
  const out: number[] = [];
  def.cells.forEach((c, i) => {
    if (!c.locked && ROT_KINDS.includes(c.kind)) out.push(i);
  });
  return out;
}

/** Replay a rotation assignment through the official model. */
function replayRots(def: LevelDefinition, rots: number[]): boolean {
  const s = createRuntime(def);
  s.rots = [...rots];
  if (!applyCommand(s, { type: 'start' })) return false;
  return runToEnd(s) === 'WON' && totalVolume(s).ok;
}

/**
 * Honest solver diagnosis. Grids with few rotatable cells (<=5) are enumerated
 * exhaustively in increasing rotation cost, proving optimality. Larger grids
 * fall back to witness existence or a bounded search: we never report
 * UNSOLVABLE because of a search limit — only UNKNOWN_TIMEOUT,
 * SOLVABLE_WITH_WITNESS or OPTIMAL_NOT_PROVEN.
 */
export function diagnose(def: LevelDefinition, budget = 200000): Diagnosis {
  const rotatable = rotatableCells(def);
  const k = rotatable.length;
  const base = def.cells.map((c) => c.rot);
  const witnessOk = certifySolvable(def);

  if (k <= 5) {
    // Enumerate assignments in order of increasing total rotation cost so the
    // FIRST winning assignment is provably optimal and we can stop early.
    const baseRots = [...base];
    let checked = 0;
    let found: { turns: number; cmds: PlumberCommand[] } | null = null;
    const turnsOf = new Array<number>(k).fill(0);
    const tryAll = (idx: number, remaining: number, soFar: number): boolean => {
      if (soFar > remaining) return false;
      if (idx === k) {
        if (soFar !== remaining) return false;
        const rots = [...baseRots];
        const cmds: PlumberCommand[] = [];
        for (let j = 0; j < k; j++) {
          const t = turnsOf[j];
          rots[rotatable[j]] = (rots[rotatable[j]] + t) % 4;
          for (let s = 0; s < t; s++) cmds.push({ type: 'rotate', index: rotatable[j] });
        }
        checked += 1;
        if (replayRots(def, rots)) {
          found = { turns: remaining, cmds };
          return true;
        }
        return false;
      }
      for (let t = 0; t <= 3 && t <= remaining - soFar; t++) {
        turnsOf[idx] = t;
        if (tryAll(idx + 1, remaining, soFar + t)) return true;
      }
      turnsOf[idx] = 0;
      return false;
    };
    for (let total = 0; total <= 3 * k; total++) {
      if (tryAll(0, total, 0)) break;
    }
    if (found) {
      const f = found as { turns: number; cmds: PlumberCommand[] };
      return { status: 'OPTIMAL_PROVEN', solvable: true, minRotations: f.turns, solution: f.cmds, checkedStates: checked, exhaustive: true };
    }
    if (witnessOk) {
      return { status: 'SOLVABLE_WITH_WITNESS', solvable: true, minRotations: null, solution: null, checkedStates: checked, exhaustive: false };
    }
    return { status: 'UNSOLVABLE_PROVEN', solvable: false, minRotations: null, solution: null, checkedStates: checked, exhaustive: true };
  }

  // Larger grid: witness gives existence; a bounded search cannot prove optimality.
  if (witnessOk) {
    return { status: 'SOLVABLE_WITH_WITNESS', solvable: true, minRotations: null, solution: null, checkedStates: 0, exhaustive: false };
  }
  let checked = 0;
  const limit = Math.min(Math.pow(4, k), budget);
  for (let combo = 0; combo < limit; combo++) {
    const rots = [...base];
    const cmds: PlumberCommand[] = [];
    let x = combo;
    for (let j = 0; j < k; j++) {
      const turns = x % 4;
      x = Math.floor(x / 4);
      rots[rotatable[j]] = (rots[rotatable[j]] + turns) % 4;
      for (let t = 0; t < turns; t++) cmds.push({ type: 'rotate', index: rotatable[j] });
    }
    checked += 1;
    if (replayRots(def, rots)) {
      return { status: 'OPTIMAL_NOT_PROVEN', solvable: true, minRotations: null, solution: cmds, checkedStates: checked, exhaustive: false };
    }
  }
  return { status: 'UNKNOWN_TIMEOUT', solvable: false, minRotations: null, solution: null, checkedStates: checked, exhaustive: false };
}

/** Hint from current runtime: first witness rotation still applicable, else null. */export function hintFromWitness(def: LevelDefinition, currentRots: number[]): PlumberCommand | null {
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
