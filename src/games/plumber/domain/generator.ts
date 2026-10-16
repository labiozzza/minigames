// Plumber Stage 1 generator: deterministic seed → certified solvable level.
// Strategy: carve a Manhattan path source(edge) → receiver(edge), lay
// straight/elbow tiles, add distractors, scramble by rotation, certify by
// replaying the witness through the official model (no separate rule copies).

import { mulberry32, seedFor } from './prng';
import {
  GENERATOR_VERSION,
  RULESET_VERSION,
  SCHEMA_VERSION,
  applyCommand,
  createRuntime,
  runToEnd,
  totalVolume,
  type CellDef,
  type LevelDefinition,
  type PlumberCommand,
} from './model';

export interface GenOptions {
  mode?: 'child' | 'normal' | 'expert';
  gridW?: number;
  gridH?: number;
}

function idx(x: number, y: number, w: number): number {
  return y * w + x;
}

type Dir = 'top' | 'right' | 'bottom' | 'left';

function rotForConnection(inSide: Dir, outSide: Dir): { kind: CellDef['kind']; rot: number } {
  if ((inSide === 'top' && outSide === 'bottom') || (inSide === 'bottom' && outSide === 'top')) {
    return { kind: 'straight', rot: 0 };
  }
  if ((inSide === 'left' && outSide === 'right') || (inSide === 'right' && outSide === 'left')) {
    return { kind: 'straight', rot: 1 };
  }
  const pair = [inSide, outSide].sort().join('+');
  const table: Record<string, number> = {
    'right+top': 0,
    'bottom+right': 1,
    'bottom+left': 2,
    'left+top': 3,
  };
  const rot = table[pair];
  if (rot === undefined) throw new Error(`no tile for ${pair}`);
  return { kind: 'elbow', rot };
}

export function generateLevel(puzzleId: string, seed: number, opts: GenOptions = {}): LevelDefinition {
  const mode = opts.mode ?? 'normal';
  const sizeByMode = mode === 'child' ? { w: 3, h: 3 } : mode === 'expert' ? { w: 6, h: 6 } : { w: 5, h: 5 };
  const w = opts.gridW ?? sizeByMode.w;
  const h = opts.gridH ?? sizeByMode.h;

  const rng = mulberry32((seed >>> 0) ^ seedFor(puzzleId, GENERATOR_VERSION));
  for (let attempt = 0; attempt < 32; attempt++) {
    const level = tryBuild(`${puzzleId}#${attempt}`, seed, w, h, mode, rng);
    if (level) return level;
  }
  return fallbackLevel(puzzleId, seed, mode);
}

function tryBuild(
  puzzleId: string,
  seed: number,
  w: number,
  h: number,
  mode: 'child' | 'normal' | 'expert',
  rng: () => number,
): LevelDefinition | null {
  // Source on left edge, receiver on right edge (Stage 1: edges only, decision №9 first step).
  const sy = Math.floor(rng() * h);
  const ry = Math.floor(rng() * h);
  const sourceCell = idx(0, sy, w);
  const receiverCell = idx(w - 1, ry, w);

  // Manhattan path: move right across, with vertical jogs at random columns.
  const path: Array<[number, number]> = [];
  let x = 0;
  let y = sy;
  path.push([x, y]);
  const jogAt = new Set<number>();
  const jogCount = Math.min(w - 1, 1 + Math.floor(rng() * 2));
  while (jogAt.size < jogCount) jogAt.add(1 + Math.floor(rng() * (w - 1)));
  for (let step = 0; step < w - 1; step++) {
    const nx = x + 1;
    if (jogAt.has(nx) && y !== ry) {
      y += ry > y ? 1 : -1;
      if (y < 0 || y >= h) return null;
      path.push([x, y]);
    }
    x = nx;
    path.push([x, y]);
  }
  while (y !== ry) {
    y += ry > y ? 1 : -1;
    if (y < 0 || y >= h) return null;
    path.push([x, y]);
  }

  const dirOf = (a: [number, number], b: [number, number]): Dir => {
    if (b[0] === a[0] + 1) return 'right';
    if (b[0] === a[0] - 1) return 'left';
    if (b[1] === a[1] + 1) return 'bottom';
    return 'top';
  };
  const opp = (d: Dir): Dir => (d === 'top' ? 'bottom' : d === 'bottom' ? 'top' : d === 'left' ? 'right' : 'left');

  const cells: CellDef[] = Array.from({ length: w * h }, () => ({ kind: 'empty' as const, rot: 0 }));
  cells[sourceCell] = { kind: 'source', rot: 0 };
  cells[receiverCell] = { kind: 'receiver', rot: 0 };

  for (let i = 1; i < path.length - 1; i++) {
    const inSide = opp(dirOf(path[i - 1], path[i]));
    const outSide = dirOf(path[i], path[i + 1]);
    if (inSide === outSide) return null;
    const { kind, rot } = rotForConnection(inSide, outSide);
    cells[idx(path[i][0], path[i][1], w)] = { kind, rot };
  }

  // Distractors on non-path cells (never overwrite source/receiver).
  const pathSet = new Set(path.map(([px, py]) => idx(px, py, w)));
  for (let i = 0; i < w * h; i++) {
    if (pathSet.has(i)) continue;
    if (rng() < 0.45) cells[i] = { kind: rng() < 0.5 ? 'straight' : 'elbow', rot: Math.floor(rng() * 4) };
  }

  // Scramble interior path tiles (never 0 offset), record inverse witness.
  const witness: PlumberCommand[] = [];
  let rotatable = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const ci = idx(path[i][0], path[i][1], w);
    const offset = 1 + Math.floor(rng() * 3);
    cells[ci] = { ...cells[ci], rot: (cells[ci].rot + offset) % 4 };
    rotatable += 1;
    for (let k = 0; k < (4 - offset) % 4; k++) witness.push({ type: 'rotate', index: ci });
  }
  if (rotatable === 0) return null;

  const goal = mode === 'child' ? 3 : mode === 'expert' ? 8 : 5;
  const def: LevelDefinition = {
    schemaVersion: SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    generatorVersion: GENERATOR_VERSION,
    puzzleId,
    seed,
    mode,
    gridW: w,
    gridH: h,
    cells,
    sources: [{ cell: sourceCell, color: 'blue', portions: goal + 2 }],
    receivers: [{ cell: receiverCell, color: 'blue', goal }],
    solutionWitness: witness,
    difficultyEvidence: { pathLength: path.length, rotatable, branches: 0 },
  };

  if (!certifySolvable(def)) return null;
  if (winsWithoutWitness(def)) return null; // anti-trivial: scrambled must not already win
  return def;
}

/** Replay witness through the official model → must reach WON with conserved volume. */
export function certifySolvable(def: LevelDefinition): boolean {
  const s = createRuntime(def);
  for (const cmd of def.solutionWitness) {
    if (cmd.type !== 'rotate') return false;
    if (!applyCommand(s, cmd)) return false;
  }
  if (!applyCommand(s, { type: 'start' })) return false;
  const phase = runToEnd(s);
  if (phase !== 'WON') return false;
  return totalVolume(s).ok;
}

/** Scrambled state started directly must NOT win (otherwise puzzle is trivial). */
export function winsWithoutWitness(def: LevelDefinition): boolean {
  const s = createRuntime(def);
  if (!applyCommand(s, { type: 'start' })) return false;
  return runToEnd(s) === 'WON';
}

function fallbackLevel(puzzleId: string, seed: number, mode: 'child' | 'normal' | 'expert'): LevelDefinition {
  // Pre-verified 3-cell horizontal line, middle tile scrambled vertical→horizontal.
  const goal = 3;
  const cells: CellDef[] = [
    { kind: 'source', rot: 0 },
    { kind: 'straight', rot: 0 }, // vertical (wrong); witness rotates once → horizontal
    { kind: 'receiver', rot: 0 },
  ];
  const def: LevelDefinition = {
    schemaVersion: SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    generatorVersion: GENERATOR_VERSION,
    puzzleId: `${puzzleId}#fallback`,
    seed,
    mode,
    gridW: 3,
    gridH: 1,
    cells,
    sources: [{ cell: 0, color: 'blue', portions: goal + 2 }],
    receivers: [{ cell: 2, color: 'blue', goal }],
    solutionWitness: [{ type: 'rotate', index: 1 }],
    difficultyEvidence: { pathLength: 3, rotatable: 1, branches: 0 },
  };
  if (!certifySolvable(def)) throw new Error('fallback level does not certify');
  return def;
}
