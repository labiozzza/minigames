// Plumber generator v0.4: deterministic seed → task spec → several certified
// candidates → best kept (measured difficulty evidence).
// Families: path | leakfix | valve | filter | mixer | program | carry |
// multiflow | exact | branch. Certification replays the witness through the
// official model (no rule copies); scrambled state must NOT win (anti-trivial).
import { mulberry32, seedFor } from './prng';
import {
  GENERATOR_VERSION,
  RULESET_VERSION,
  SCHEMA_VERSION,
  applyCommand,
  createRuntime,
  neighborOf,
  OPPOSITE,
  PORT_ORDER,
  portsOf,
  runToEnd,
  totalVolume,
  type CellDef,
  type LevelDefinition,
  type PipeKind,
  type PlumberCommand,
  type Side,
} from './model';

export type Family = 'path' | 'leakfix' | 'valve' | 'filter' | 'mixer' | 'program' | 'carry' | 'multiflow' | 'exact' | 'branch';

/** How many certified candidates to build before picking the best (P2 §2.2). */
const CANDIDATE_COUNT = 3;


export interface GenOptions {
  mode?: 'child' | 'normal' | 'expert';
  gridW?: number;
  gridH?: number;
  family?: Family;
  lockedCount?: number;
  blockedCount?: number;
  /** Tight families (exact/leakfix): distractors are walls only, never pipes. */
  pipeDistractors?: boolean;
}

type Dir = 'top' | 'right' | 'bottom' | 'left';

function idx(x: number, y: number, w: number): number {
  return y * w + x;
}

const DIR_OF = (a: [number, number], b: [number, number]): Dir => {
  if (b[0] === a[0] + 1) return 'right';
  if (b[0] === a[0] - 1) return 'left';
  if (b[1] === a[1] + 1) return 'bottom';
  return 'top';
};
const OPP = (d: Dir): Dir => (d === 'top' ? 'bottom' : d === 'bottom' ? 'top' : d === 'left' ? 'right' : 'left');

function rotForConnection(inSide: Dir, outSide: Dir): { kind: CellDef['kind']; rot: number } {
  if ((inSide === 'top' && outSide === 'bottom') || (inSide === 'bottom' && outSide === 'top')) return { kind: 'straight', rot: 0 };
  if ((inSide === 'left' && outSide === 'right') || (inSide === 'right' && outSide === 'left')) return { kind: 'straight', rot: 1 };
  const pair = [inSide, outSide].sort().join('+');
  const table: Record<string, number> = { 'right+top': 0, 'bottom+right': 1, 'bottom+left': 2, 'left+top': 3 };
  const rot = table[pair];
  if (rot === undefined) throw new Error(`no tile for ${pair}`);
  return { kind: 'elbow', rot };
}

/** Rotation whose open-side set equals `sides` for the given tile kind (P2 branch). */
function rotForSides(kind: CellDef['kind'], sides: Side[]): number | null {
  const want = [...new Set(sides)].sort();
  for (let r = 0; r < 4; r++) {
    const p = portsOf({ kind, rot: r } as CellDef, r);
    const got = PORT_ORDER.filter((s) => p[s]).sort();
    if (got.length === want.length && got.every((s, i) => s === want[i])) return r;
  }
  return null;
}

type Edge = 'left' | 'right' | 'top' | 'bottom';
function edgeCell(edge: Edge, w: number, h: number, rng: () => number): [number, number] {
  if (edge === 'left') return [0, Math.floor(rng() * h)];
  if (edge === 'right') return [w - 1, Math.floor(rng() * h)];
  if (edge === 'top') return [Math.floor(rng() * w), 0];
  return [Math.floor(rng() * w), h - 1];
}

/**
 * Direction-varied route (§4 diversity): pick two different grid edges for the
 * source and receiver, then walk a randomized monotone staircase between them.
 * Monotone steps never revisit a cell, so the interior is distinct; the varied
 * source/receiver edges make routes flow left→right, right→left, top→bottom and
 * diagonally instead of always along the same axis.
 */
function routePath(w: number, h: number, rng: () => number): Array<[number, number]> | null {
  const edges: Edge[] = ['left', 'right', 'top', 'bottom'];
  const s = edges[Math.floor(rng() * edges.length)];
  const others = edges.filter((e) => e !== s);
  const r = others[Math.floor(rng() * others.length)];
  const [ax, ay] = edgeCell(s, w, h, rng);
  const [bx, by] = edgeCell(r, w, h, rng);
  if (ax === bx && ay === by) return null;
  const path: Array<[number, number]> = [[ax, ay]];
  let x = ax;
  let y = ay;
  let remX = bx - ax;
  let remY = by - ay;
  const sx = Math.sign(remX);
  const sy = Math.sign(remY);
  let guard = 0;
  while ((remX !== 0 || remY !== 0) && guard++ < w * h * 4) {
    const canX = remX !== 0;
    const canY = remY !== 0;
    const goX = canX && (!canY || rng() < 0.5);
    const run = 1 + Math.floor(rng() * 2);
    if (goX) {
      for (let k = 0; k < run && remX !== 0; k++) {
        x += sx;
        remX -= sx;
        path.push([x, y]);
      }
    } else {
      for (let k = 0; k < run && remY !== 0; k++) {
        y += sy;
        remY -= sy;
        path.push([x, y]);
      }
    }
  }
  return path.length >= 3 ? path : null;
}

interface Built {
  cells: CellDef[];
  pathSet: Set<number>;
  interior: number[];
}

function layPath(w: number, h: number, path: Array<[number, number]>): Built | null {
  const cells: CellDef[] = Array.from({ length: w * h }, () => ({ kind: 'empty' as const, rot: 0 }));
  for (let i = 1; i < path.length - 1; i++) {
    const inSide = OPP(DIR_OF(path[i - 1], path[i]));
    const outSide = DIR_OF(path[i], path[i + 1]);
    if (inSide === outSide) return null;
    try {
      const { kind, rot } = rotForConnection(inSide, outSide);
      cells[idx(path[i][0], path[i][1], w)] = { kind, rot };
    } catch {
      return null;
    }
  }
  const pathSet = new Set(path.map(([px, py]) => idx(px, py, w)));
  const interior = path.slice(1, -1).map(([px, py]) => idx(px, py, w));
  return { cells, pathSet, interior };
}

function addDistractors(cells: CellDef[], pathSet: Set<number>, rng: () => number, blockedCount: number, pipes = true): void {
  for (let i = 0; i < cells.length; i++) {
    if (pathSet.has(i) || cells[i].kind !== 'empty') continue;
    const r = rng();
    if (r < blockedCount / cells.length + 0.08) cells[i] = { kind: 'blocked', rot: 0 };
    else if (pipes && r < 0.45) cells[i] = { kind: rng() < 0.5 ? 'straight' : 'elbow', rot: Math.floor(rng() * 4) };
  }
}

/** Scramble interior tiles (skip locked), return witness rotations. */
function scramble(cells: CellDef[], interior: number[], rng: () => number, locked: Set<number>): PlumberCommand[] {
  const witness: PlumberCommand[] = [];
  for (const ci of interior) {
    if (locked.has(ci)) {
      cells[ci] = { ...cells[ci], locked: true };
      continue;
    }
    const offset = 1 + Math.floor(rng() * 3);
    cells[ci] = { ...cells[ci], rot: (cells[ci].rot + offset) % 4 };
    for (let k = 0; k < (4 - offset) % 4; k++) witness.push({ type: 'rotate', index: ci });
  }
  return witness;
}

function baseDef(puzzleId: string, seed: number, mode: 'child' | 'normal' | 'expert', family: Family, w: number, h: number): Omit<LevelDefinition, 'cells' | 'sources' | 'receivers' | 'solutionWitness' | 'difficultyEvidence'> {
  return {
    schemaVersion: SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    generatorVersion: GENERATOR_VERSION,
    puzzleId,
    seed,
    mode,
    family,
    gridW: w,
    gridH: h,
  };
}

function tryBuildFamily(family: Family, id: string, seed: number, w: number, h: number, mode: 'child' | 'normal' | 'expert', rng: () => number, opts: GenOptions): LevelDefinition | null {
  try {
    switch (family) {
      case 'path': return buildPath(id, seed, w, h, mode, rng, opts, 'blue', 'blue', 2, 'auto');
      case 'leakfix': return buildLeakfix(id, seed, w, h, mode, rng, opts);
      case 'valve': return buildValve(id, seed, w, h, mode, rng, opts);
      case 'filter': return buildFilter(id, seed, w, h, mode, rng, opts);
      case 'mixer': return buildMixer(id, seed, mode, rng);
      case 'program': return buildProgram(id, seed, w, h, mode, rng, opts);
      case 'carry': return buildCarry(id, seed, w, h, mode, rng, opts);
      case 'multiflow': return buildMultiflow(id, seed, w, h, mode, rng, opts);
      case 'branch': return buildBranch(id, seed, w, h, mode, rng, opts);
      case 'exact': return buildPath(id, seed, w, h, mode, rng, { ...opts, pipeDistractors: false, blockedCount: 3 }, 'blue', 'blue', 0, 'exact', 'exact');
    }
  } catch {
    return null;
  }
}

export interface AttemptOutcome {
  attempt: number;
  built: boolean;
  report: ReturnType<typeof certifyReport> | null;
}

/**
 * Generate with per-attempt diagnostics (dev/research; shares code with
 * generateLevel). P2 §2.2: build several certified candidates from the task
 * spec, rank them by a quality heuristic, and keep the best — so generation is
 * task-conditioned and structurally varied, not just a single lucky build.
 */
export function generateLevelReport(puzzleId: string, seed: number, opts: GenOptions = {}): { level: LevelDefinition; attempts: AttemptOutcome[] } {
  const mode = opts.mode ?? 'normal';
  const sizeByMode = mode === 'child' ? { w: 3, h: 3 } : mode === 'expert' ? { w: 6, h: 6 } : { w: 5, h: 5 };
  const w = opts.gridW ?? sizeByMode.w;
  const h = opts.gridH ?? sizeByMode.h;
  const rng = mulberry32((seed >>> 0) ^ seedFor(puzzleId, GENERATOR_VERSION));
  const family = opts.family ?? pickFamily(mode, [], rng);
  const attempts: AttemptOutcome[] = [];
  const candidates: Array<{ level: LevelDefinition; score: number }> = [];
  for (let attempt = 0; attempt < 32 && candidates.length < CANDIDATE_COUNT; attempt++) {
    const id = `${puzzleId}#${attempt}`;
    const level = tryBuildFamily(family, id, seed, w, h, mode, rng, opts);
    if (!level) {
      attempts.push({ attempt, built: false, report: null });
      continue;
    }
    const report = certifyReport(level);
    attempts.push({ attempt, built: true, report });
    if (report.phase === 'WON' && report.volumeOk && !report.trivialWin) {
      candidates.push({ level, score: quickScore(level) });
    }
  }
  if (candidates.length === 0) return { level: fallbackLevel(puzzleId, seed, mode), attempts };
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a)).level;
  const metrics = analyzeLevel(best);
  best.difficultyEvidence = {
    ...best.difficultyEvidence,
    essentialLength: metrics.essentialLength,
    decisions: metrics.decisions,
    falseAlternatives: metrics.falseAlternatives,
    interactions: metrics.interactions,
    meaningfulRatio: metrics.meaningfulRatio,
    blockingMatters: metrics.blockingMatters,
    score: metrics.score,
  };
  return { level: best, attempts };
}

export function generateLevel(puzzleId: string, seed: number, opts: GenOptions = {}): LevelDefinition {
  return generateLevelReport(puzzleId, seed, opts).level;
}

/** Weighted family pick with anti-repeat of the recent families. */
export function pickFamily(mode: 'child' | 'normal' | 'expert', recent: string[], rng: () => number): Family {
  const table: Family[] = mode === 'child'
    ? ['path', 'path', 'path', 'leakfix', 'branch']
    : mode === 'expert'
      ? ['path', 'leakfix', 'valve', 'filter', 'mixer', 'program', 'carry', 'multiflow', 'exact', 'branch']
      : ['path', 'path', 'leakfix', 'valve', 'filter', 'carry', 'multiflow', 'exact', 'branch'];
  const last = recent[recent.length - 1];
  for (let i = 0; i < 8; i++) {
    const f = table[Math.floor(rng() * table.length)];
    if (f !== last || table.length < 2) return f;
  }
  return table[0];
}

function goalFor(mode: 'child' | 'normal' | 'expert'): number {
  return mode === 'child' ? 3 : mode === 'expert' ? 8 : 5;
}

function buildPath(
  puzzleId: string, seed: number, w: number, h: number, mode: 'child' | 'normal' | 'expert',
  rng: () => number, opts: GenOptions, color: string, recvColor: string, spare: number,
  recvKind: 'auto' | 'overflow' | 'exact' | 'buffer', family: Family = 'path',
): LevelDefinition | null {
  const path = routePath(w, h, rng);
  if (!path || path.length < 3) return null;
  const laid = layPath(w, h, path);
  if (!laid) return null;
  const { cells, pathSet, interior } = laid;
  const sourceCell = idx(path[0][0], path[0][1], w);
  const receiverCell = idx(path[path.length - 1][0], path[path.length - 1][1], w);
  cells[sourceCell] = { kind: 'source', rot: 0 };
  cells[receiverCell] = { kind: 'receiver', rot: 0 };
  // Aim source outlet along the first step and receiver inlet against the last.
  const SIDES_IDX = { top: 0, right: 1, bottom: 2, left: 3 } as const;
  const d0 = DIR_OF(path[0], path[1]);
  cells[sourceCell] = { kind: 'source', rot: (SIDES_IDX[d0] - SIDES_IDX.right + 4) % 4 };
  const d1 = DIR_OF(path[path.length - 2], path[path.length - 1]);
  cells[receiverCell] = { kind: 'receiver', rot: (SIDES_IDX[OPP(d1)] - SIDES_IDX.left + 4) % 4 };
  addDistractors(cells, pathSet, rng, opts.blockedCount ?? (mode === 'child' ? 0 : 2), opts.pipeDistractors ?? true);
  const locked = new Set<number>();
  const lockN = Math.min(opts.lockedCount ?? (mode === 'child' ? 0 : 1), Math.max(0, interior.length - 1));
  for (let k = 0; k < lockN; k++) locked.add(interior[Math.floor(rng() * interior.length)]);
  const witness = scramble(cells, interior, rng, locked);
  if (witness.length === 0) return null;
  const goal = goalFor(mode);
  return {
    ...baseDef(puzzleId, seed, mode, family, w, h),    cells,
    sources: [{ cell: sourceCell, color, portions: goal + spare }],
    receivers: [{ cell: receiverCell, color: recvColor, goal, kind: recvKind }],
    solutionWitness: witness,
    difficultyEvidence: { pathLength: path.length, rotatable: interior.length - locked.size, branches: 0 },
    par: witness.length,
  };
}

function buildLeakfix(
  puzzleId: string, seed: number, w: number, h: number, mode: 'child' | 'normal' | 'expert',
  rng: () => number, opts: GenOptions,
): LevelDefinition | null {
  const lvl = buildPath(puzzleId, seed, w, h, mode, rng, { ...opts, lockedCount: 0, pipeDistractors: false, blockedCount: Math.max(opts.blockedCount ?? 2, 2) }, 'blue', 'blue', 0, 'auto');
  if (!lvl) return null;
  // Attach an open branch to a random interior path cell: leak unless closed.
  const pathCells = lvl.cells.map((c, i) => (['straight', 'elbow', 't', 'cross'].includes(c.kind) ? i : -1)).filter((i) => i >= 0);
  if (pathCells.length === 0) return null;
  const at = pathCells[Math.floor(rng() * pathCells.length)];
  const ax = at % w;
  const ay = Math.floor(at / w);
  const cands: Array<[number, number, 'top' | 'right' | 'bottom' | 'left']> = [];
  if (ax > 0 && lvl.cells[at - 1].kind === 'empty') cands.push([ax - 1, ay, 'right']);
  if (ax < w - 1 && lvl.cells[at + 1].kind === 'empty') cands.push([ax + 1, ay, 'left']);
  if (ay > 0 && lvl.cells[at - w].kind === 'empty') cands.push([ax, ay - 1, 'bottom']);
  if (ay < h - 1 && lvl.cells[at + w].kind === 'empty') cands.push([ax, ay + 1, 'top']);
  if (cands.length === 0) return null;
  const [bx, by, needSide] = cands[Math.floor(rng() * cands.length)];
  const bi = idx(bx, by, w);
  // Straight tile aimed at the path, open end outward (leak). Witness rotates it to a wall.
  const wantRot = needSide === 'left' || needSide === 'right' ? 1 : 0; // straight axis toward path
  const openOffset = 1 + Math.floor(rng() * 3);
  lvl.cells[bi] = { kind: 'straight', rot: (wantRot + openOffset) % 4 };
  for (let k = 0; k < (4 - openOffset) % 4; k++) lvl.solutionWitness.push({ type: 'rotate', index: bi });
  lvl.puzzleId = puzzleId;
  lvl.family = 'leakfix';
  lvl.par = lvl.solutionWitness.length;
  return lvl;
}

function buildValve(
  puzzleId: string, seed: number, w: number, h: number, mode: 'child' | 'normal' | 'expert',
  rng: () => number, opts: GenOptions,
): LevelDefinition | null {
  const lvl = buildPath(puzzleId, seed, w, h, mode, rng, { ...opts, lockedCount: 0 }, 'blue', 'blue', 2, 'auto');
  if (!lvl || lvl.difficultyEvidence.rotatable < 2) return null;
  // Replace one interior straight with a closed valve; witness opens it.
  const straights = lvl.cells.map((c, i) => (c.kind === 'straight' && !c.locked ? i : -1)).filter((i) => i >= 0);
  if (straights.length === 0) return null;
  const vi = straights[Math.floor(rng() * straights.length)];
  const rot = lvl.cells[vi].rot;
  lvl.cells[vi] = { kind: 'valve', rot, valveOpen: false };
  lvl.solutionWitness.push({ type: 'toggleValve', index: vi });
  lvl.dynamic = true;
  lvl.family = 'valve';
  lvl.par = lvl.solutionWitness.filter((c) => c.type === 'rotate').length;
  return lvl;
}

function buildFilter(
  puzzleId: string, seed: number, w: number, h: number, mode: 'child' | 'normal' | 'expert',
  rng: () => number, opts: GenOptions,
): LevelDefinition | null {
  const lvl = buildPath(puzzleId, seed, w, h, mode, rng, { ...opts, lockedCount: 0 }, 'blue', 'blue', 2, 'auto');
  if (!lvl) return null;
  const straights = lvl.cells.map((c, i) => (c.kind === 'straight' && !c.locked ? i : -1)).filter((i) => i >= 0);
  if (straights.length === 0) return null;
  const fi = straights[Math.floor(rng() * straights.length)];
  lvl.cells[fi] = { kind: 'filter', rot: lvl.cells[fi].rot, filterAllow: ['blue'] };
  // Red herring: small red source feeding a dead-end stub.
  const empties = lvl.cells.map((c, i) => (c.kind === 'empty' ? i : -1)).filter((i) => i >= 0);
  if (empties.length > 0) {
    const ri = empties[Math.floor(rng() * empties.length)];
    lvl.cells[ri] = { kind: 'source', rot: 0 };
    lvl.sources.push({ cell: ri, color: 'red', portions: 2 });
  }
  lvl.family = 'filter';
  return lvl;
}

function buildMixer(puzzleId: string, seed: number, mode: 'child' | 'normal' | 'expert', rng: () => number): LevelDefinition | null {
  // §4 diversity: same mechanic (red + blue → mixer → purple receiver) but the
  // grid size, mixer row and link length vary instead of one fixed 4x3 shape.
  const w = rng() < 0.5 ? 4 : 5;
  const h = rng() < 0.5 ? 3 : 4;
  const my = 1 + Math.floor(rng() * (h - 2));
  const mixerX = 1;
  const cells: CellDef[] = Array.from({ length: w * h }, () => ({ kind: 'empty' as const, rot: 0 }));
  const redSrc = idx(0, my, w);
  const blueSrc = idx(mixerX, my - 1, w);
  const mixerCell = idx(mixerX, my, w);
  const recvCell = idx(w - 1, my, w);
  cells[redSrc] = { kind: 'source', rot: 0 }; // outlet right into the mixer
  cells[blueSrc] = { kind: 'source', rot: 1 }; // outlet down into the mixer
  cells[mixerCell] = { kind: 'mixer', rot: 0, recipeIn: { red: 1, blue: 1 }, recipeOut: { color: 'purple', count: 2 } };
  // Link pipes mixer → receiver, scrambled to vertical; witness turns each flat.
  const linkIdx: number[] = [];
  for (let x = mixerX + 1; x <= w - 2; x++) {
    const ci = idx(x, my, w);
    cells[ci] = { kind: 'straight', rot: 0 };
    linkIdx.push(ci);
  }
  cells[recvCell] = { kind: 'receiver', rot: 0 };
  const goal = mode === 'child' ? 2 : 4;
  const def: LevelDefinition = {
    ...baseDef(puzzleId, seed, mode, 'mixer', w, h),
    cells,
    sources: [
      { cell: redSrc, color: 'red', portions: goal / 2 + 1 },
      { cell: blueSrc, color: 'blue', portions: goal / 2 + 1 },
    ],
    receivers: [{ cell: recvCell, color: 'purple', goal }],
    solutionWitness: linkIdx.map((i) => ({ type: 'rotate', index: i } as PlumberCommand)),
    difficultyEvidence: { pathLength: 3 + linkIdx.length, rotatable: linkIdx.length, branches: 2 },
    par: linkIdx.length,
  };
  const used = new Set([redSrc, blueSrc, mixerCell, recvCell, ...linkIdx]);
  addDistractors(cells, used, rng, 0);
  return def;
}

function buildProgram(
  puzzleId: string, seed: number, w: number, h: number, mode: 'child' | 'normal' | 'expert',
  rng: () => number, opts: GenOptions,
): LevelDefinition | null {
  const lvl = buildPath(puzzleId, seed, w, h, mode, rng, { ...opts, lockedCount: 0, pipeDistractors: false }, 'blue', 'blue', 0, 'auto');
  if (!lvl) return null;
  lvl.sources[0].enabled = false;
  lvl.programmed = true;
  lvl.dynamic = true;
  lvl.program = [{ type: 'toggleSource', source: 0, state: true }];
  lvl.family = 'program';
  return lvl;
}

function buildCarry(
  puzzleId: string, seed: number, w: number, h: number, mode: 'child' | 'normal' | 'expert',
  rng: () => number, opts: GenOptions,
): LevelDefinition | null {
  const lvl = buildPath(puzzleId, seed, w, h, mode, rng, { ...opts, lockedCount: 0 }, 'blue', 'blue', 2, 'auto');
  if (!lvl || lvl.difficultyEvidence.rotatable < 1) return null;
  // Remove one interior pipe; player places stock back. Witness: place + rotations.
  const interior = lvl.cells.map((c, i) => (['straight', 'elbow'].includes(c.kind) && !c.locked ? i : -1)).filter((i) => i >= 0);
  if (interior.length === 0) return null;
  const gi = interior[Math.floor(rng() * interior.length)];
  const needKind = lvl.cells[gi].kind;
  const scrambledRot = lvl.cells[gi].rot;
  // Witness entries for gi encode its scramble offset: solved = scrambled + count.
  const giTurns = lvl.solutionWitness.filter((c) => c.type === 'rotate' && c.index === gi).length;
  const solvedRot = (scrambledRot + giTurns) % 4;
  // Drop witness rotations that targeted the removed tile, then place + orient.
  const rotations = lvl.solutionWitness.filter((c) => !(c.type === 'rotate' && c.index === gi));
  const needTurns = ((solvedRot % 4) + 4) % 4; // placed pipe starts at rot 0
  const placeWitness: PlumberCommand[] = [{ type: 'placeStock', kind: needKind, index: gi }];
  for (let k = 0; k < needTurns; k++) placeWitness.push({ type: 'rotate', index: gi });
  lvl.cells[gi] = { kind: 'empty', rot: 0 };
  lvl.inventory = [needKind];
  lvl.solutionWitness = [...placeWitness, ...rotations];
  lvl.dynamic = false;
  lvl.family = 'carry';
  lvl.par = rotations.length + 1;
  return lvl;
}

function buildMultiflow(
  puzzleId: string, seed: number, w: number, h: number, mode: 'child' | 'normal' | 'expert',
  rng: () => number, opts: GenOptions,
): LevelDefinition | null {
  const hh = Math.max(2, Math.floor(h / 2));
  const top = buildPath(`${puzzleId}-a`, seed * 2 + 1, w, hh, mode, rng, { ...opts, lockedCount: 0 }, 'red', 'red', 1, 'auto');
  const bottom = buildPath(`${puzzleId}-b`, seed * 2 + 2, w, h - hh, mode, rng, { ...opts, lockedCount: 0 }, 'blue', 'blue', 1, 'auto');
  if (!top || !bottom) return null;
  const cells: CellDef[] = [...top.cells, ...bottom.cells.map((c) => ({ ...c }))];
  const off = top.cells.length;
  const sources = [...top.sources, ...bottom.sources.map((s) => ({ ...s, cell: s.cell + off }))];
  const receivers = [...top.receivers, ...bottom.receivers.map((r) => ({ ...r, cell: r.cell + off }))];
  const shifted: PlumberCommand[] = [];
  for (const c of bottom.solutionWitness) {
    if (c.type === 'rotate') shifted.push({ type: 'rotate', index: c.index + off });
    else shifted.push(c);
  }
  const witness: PlumberCommand[] = [...top.solutionWitness, ...shifted];
  const def: LevelDefinition = {
    ...baseDef(puzzleId, seed, mode, 'multiflow', w, h),
    cells,
    sources,
    receivers,
    solutionWitness: witness,
    difficultyEvidence: {
      pathLength: top.difficultyEvidence.pathLength + bottom.difficultyEvidence.pathLength,
      rotatable: top.difficultyEvidence.rotatable + bottom.difficultyEvidence.rotatable,
      branches: 1,
    },
    par: witness.length,
  };
  return def;
}

function buildBranch(
  puzzleId: string, seed: number, w: number, h: number, mode: 'child' | 'normal' | 'expert',
  rng: () => number, opts: GenOptions,
): LevelDefinition | null {
  const path = routePath(w, h, rng);
  if (!path || path.length < 4) return null;
  const laid = layPath(w, h, path);
  if (!laid) return null;
  const { cells, pathSet, interior } = laid;
  const SIDES_IDX = { top: 0, right: 1, bottom: 2, left: 3 } as const;
  const sourceCell = idx(path[0][0], path[0][1], w);
  const receiverCell = idx(path[path.length - 1][0], path[path.length - 1][1], w);
  const d0 = DIR_OF(path[0], path[1]);
  cells[sourceCell] = { kind: 'source', rot: (SIDES_IDX[d0] - SIDES_IDX.right + 4) % 4 };
  const d1 = DIR_OF(path[path.length - 2], path[path.length - 1]);
  cells[receiverCell] = { kind: 'receiver', rot: (SIDES_IDX[OPP(d1)] - SIDES_IDX.left + 4) % 4 };
  // Turn one interior route cell into a T that also opens toward an empty
  // neighbour; that neighbour becomes a second receiver so the flow splits.
  const spots: Array<{ at: number; side: Dir; to: number }> = [];
  for (const ci of interior) {
    const x = ci % w;
    const y = Math.floor(ci / w);
    if (x > 0 && !pathSet.has(ci - 1)) spots.push({ at: ci, side: 'left', to: ci - 1 });
    if (x < w - 1 && !pathSet.has(ci + 1)) spots.push({ at: ci, side: 'right', to: ci + 1 });
    if (y > 0 && !pathSet.has(ci - w)) spots.push({ at: ci, side: 'top', to: ci - w });
    if (y < h - 1 && !pathSet.has(ci + w)) spots.push({ at: ci, side: 'bottom', to: ci + w });
  }
  if (spots.length === 0) return null;
  const spot = spots[Math.floor(rng() * spots.length)];
  const atX = spot.at % w;
  const atY = Math.floor(spot.at / w);
  const prev = path[path.findIndex(([px, py]) => idx(px, py, w) === spot.at) - 1];
  const next = path[path.findIndex(([px, py]) => idx(px, py, w) === spot.at) + 1];
  if (!prev || !next) return null;
  const inSide = OPP(DIR_OF(prev, [atX, atY]));
  const outSide = DIR_OF([atX, atY], next);
  const tRot = rotForSides('t', [inSide, outSide, spot.side]);
  if (tRot === null || inSide === spot.side || outSide === spot.side) return null;
  cells[spot.at] = { kind: 't', rot: tRot };
  cells[spot.to] = { kind: 'receiver', rot: (SIDES_IDX[OPP(spot.side)] - SIDES_IDX.left + 4) % 4 };
  const used = new Set(pathSet);
  used.add(spot.to);
  addDistractors(cells, used, rng, opts.blockedCount ?? (mode === 'child' ? 0 : 2), opts.pipeDistractors ?? true);
  const locked = new Set<number>();
  const witness = scramble(cells, interior, rng, locked);
  if (witness.length === 0) return null;
  const goalA = mode === 'expert' ? 4 : mode === 'child' ? 2 : 3;
  const goalB = mode === 'expert' ? 3 : 2;
  return {
    ...baseDef(puzzleId, seed, mode, 'branch', w, h),
    cells,
    sources: [{ cell: sourceCell, color: 'blue', portions: goalA + goalB + 2 }],
    receivers: [
      { cell: receiverCell, color: 'blue', goal: goalA, kind: 'auto' },
      { cell: spot.to, color: 'blue', goal: goalB, kind: 'auto' },
    ],
    solutionWitness: witness,
    difficultyEvidence: { pathLength: path.length, rotatable: interior.length, branches: 2 },
    par: witness.length,
  };
}

/** Detailed certification report (dev diagnostics, replay evidence). */
export function certifyReport(def: LevelDefinition): { phase: string; got: number[]; lost: number; errorKind: string | null; volumeOk: boolean; trivialWin: boolean } {
  const s = createRuntime(def);
  let witnessOk = true;
  for (const cmd of def.solutionWitness) {
    if (!applyCommand(s, cmd)) {
      witnessOk = false;
      break;
    }
  }
  let phase = 'SKIPPED';
  if (witnessOk && applyCommand(s, { type: 'start' })) phase = runToEnd(s);
  const t = createRuntime(def);
  let trivialWin = false;
  if (applyCommand(t, { type: 'start' })) trivialWin = runToEnd(t) === 'WON';
  return { phase, got: [...s.receiverGot], lost: s.lost, errorKind: s.errorKind, volumeOk: totalVolume(s).ok, trivialWin };
}
export function certifySolvable(def: LevelDefinition): boolean {
  const s = createRuntime(def);
  for (const cmd of def.solutionWitness) {
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
  if (s.program.length === 0 && s.def.program) s.program = s.def.program.map((c) => ({ ...c }));
  if (!applyCommand(s, { type: 'start' })) return false;
  return runToEnd(s) === 'WON';
}

/**
 * §4 logical fingerprint: the actual pipe connectivity (per-cell open sides at
 * the solved rotation) plus source/receiver roles. Two levels that only differ
 * by orientation or route are distinct here, so diversity checks cannot be
 * fooled by a kind-grid that ignores pipe direction.
 */
export function logicalFingerprint(def: LevelDefinition): string {
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const grid = def.cells
    .map((c) => {
      const p = portsOf(c, c.rot);
      return sides.map((s) => (p[s] ? '1' : '0')).join('');
    })
    .join('|');
  const io = [
    ...def.sources.map((s) => `S${s.cell}:${s.color}:${s.portions}`),
    ...def.receivers.map((r) => `R${r.cell}:${r.color}:${r.goal}:${r.kind ?? 'auto'}`),
  ]
    .sort()
    .join(',');
  return `${def.gridW}x${def.gridH}|${def.family}|${grid}|${io}`;
}

// ── P2: structure metrics, canonical fingerprint, action-type similarity ──────

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** Solved rotations after replaying the witness (analysis only; never mutates def). */
function solvedRots(def: LevelDefinition): number[] {
  const s = createRuntime(def);
  for (const cmd of def.solutionWitness) applyCommand(s, cmd);
  return [...s.rots];
}

export interface LevelMetrics {
  essentialLength: number;
  decisions: number;
  falseAlternatives: number;
  interactions: number;
  meaningfulRatio: number;
  blockingMatters: number;
  score: number;
}

const ROTATABLE_KINDS: ReadonlySet<CellDef['kind']> = new Set(['straight', 'elbow', 't', 'cross']);

function isPlayableKind(kind: CellDef['kind']): boolean {
  return kind !== 'empty' && kind !== 'blocked';
}

function isTransferKind(kind: CellDef['kind']): boolean {
  return isPlayableKind(kind) && kind !== 'source' && kind !== 'receiver';
}

function reachable(from: number[], def: LevelDefinition, rots: number[]): Set<number> {
  const { gridW: w, gridH: h } = def;
  const seen = new Set<number>(from);
  const queue = [...from];
  while (queue.length) {
    const i = queue.shift() as number;
    const p = portsOf(def.cells[i], rots[i]);
    for (const side of SIDES) {
      if (!p[side]) continue;
      const n = neighborOf(i, side, w, h);
      if (n === null) continue;
      const np = portsOf(def.cells[n], rots[n]);
      if (!np[OPPOSITE[side]]) continue;
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen;
}

/**
 * Measurable level quality (P2 §2.3/§2.4): how long and how decided the
 * essential route is, how many real false directions and interaction types it
 * carries, how much of the field is meaningful, and whether blockers actually
 * constrain the route. `score` is the single number the candidate layer ranks by.
 */
export function analyzeLevel(def: LevelDefinition): LevelMetrics {
  const rots = solvedRots(def);
  const total = def.cells.length;
  const reach = reachable(def.sources.map((s) => s.cell), def, rots);
  const toRecv = reachable(def.receivers.map((r) => r.cell), def, rots);
  let essentialLength = 0;
  let decisions = 0;
  let falseAlternatives = 0;
  let playable = 0;
  const essential = new Set<number>();
  def.cells.forEach((c, i) => {
    if (isPlayableKind(c.kind)) playable += 1;
    if (!isTransferKind(c.kind) || !reach.has(i)) return;
    if (toRecv.has(i)) {
      essential.add(i);
      essentialLength += 1;
      if (ROTATABLE_KINDS.has(c.kind) && !c.locked) decisions += 1;
    } else {
      falseAlternatives += 1;
    }
  });
  let blockingMatters = 0;
  def.cells.forEach((c, i) => {
    if (c.kind !== 'blocked') return;
    for (const side of SIDES) {
      const n = neighborOf(i, side, def.gridW, def.gridH);
      if (n !== null && essential.has(n)) { blockingMatters += 1; break; }
    }
  });
  const interactions = new Set(def.solutionWitness.map((c) => c.type)).size;
  const emptyRatio = (total - playable) / total;
  const score = Number((
    essentialLength * 0.4 +
    decisions * 1.4 +
    interactions * 2.0 +
    (playable / total) * 5 +
    blockingMatters * 0.8 +
    Math.min(falseAlternatives, 3) * 0.6 -
    emptyRatio * 2
  ).toFixed(3));
  return {
    essentialLength,
    decisions,
    falseAlternatives,
    interactions,
    meaningfulRatio: Number((playable / total).toFixed(4)),
    blockingMatters,
    score,
  };
}

/** Cheap, runtime-free ranking heuristic (candidate layer; refine winner after). */
function quickScore(def: LevelDefinition): number {
  const total = def.cells.length;
  let playable = 0;
  let blocked = 0;
  for (const c of def.cells) {
    if (c.kind === 'empty') continue;
    if (c.kind === 'blocked') blocked += 1;
    else playable += 1;
  }
  const par = def.par ?? def.solutionWitness.filter((c) => c.type === 'rotate').length;
  const interactions = new Set(def.solutionWitness.map((c) => c.type)).size;
  return Number((par * 1.2 + interactions * 2 + def.receivers.length * 1.5 + (playable / total) * 5 - (blocked / total) * 1.5).toFixed(3));
}

function rotSide(side: Side, q: number): Side {
  return SIDES[(SIDES.indexOf(side) + q) % 4];
}

/** Rotate a grid coordinate q quarter-turns clockwise on an N×N board. */
function rotateXY(x: number, y: number, n: number, q: number): [number, number] {
  let cx = x;
  let cy = y;
  const last = n - 1;
  for (let k = 0; k < q; k++) {
    const nx = last - cy;
    cy = cx;
    cx = nx;
  }
  return [cx, cy];
}

function canonicalTokens(def: LevelDefinition, q: number): string[] {
  const { gridW: w, gridH: h } = def;
  const out: string[] = Array.from({ length: w * h }, () => '0000');
  def.cells.forEach((c, i) => {
    const [nx, ny] = rotateXY(i % w, Math.floor(i / w), w, q);
    const p = portsOf(c, c.rot);
    out[ny * w + nx] = SIDES.map((s) => (p[rotSide(s, (4 - q) % 4)] ? '1' : '0')).join('');
  });
  const io: string[] = [];
  for (const s of def.sources) {
    const [nx, ny] = rotateXY(s.cell % w, Math.floor(s.cell / w), w, q);
    io.push(`S${ny * w + nx}:${s.color}:${s.portions}`);
  }
  for (const r of def.receivers) {
    const [nx, ny] = rotateXY(r.cell % w, Math.floor(r.cell / w), w, q);
    io.push(`R${ny * w + nx}:${r.color}:${r.goal}:${r.kind ?? 'auto'}`);
  }
  return [...out, `#${io.sort().join(',')}`];
}

function bestCanonical(def: LevelDefinition): { key: string; tokens: string[] } {
  const qs = def.gridW === def.gridH ? [0, 1, 2, 3] : [0];
  let best: { key: string; tokens: string[] } | null = null;
  for (const q of qs) {
    const tokens = canonicalTokens(def, q);
    const key = tokens.join('|');
    if (best === null || key < best.key) best = { key, tokens };
  }
  return best as { key: string; tokens: string[] };
}

/**
 * §2.3 canonical logical fingerprint: rotation-invariant pipe connectivity +
 * source/receiver roles. Two levels that differ only by a quarter-turn share a
 * fingerprint, so variety checks cannot be satisfied by cosmetically re-orienting
 * one shape. (Reflections are intentionally excluded: the tile set is not
 * mirror-symmetric, so a mirrored layout is a genuinely different puzzle.)
 */
export function canonicalFingerprint(def: LevelDefinition): string {
  return bestCanonical(def).key;
}

/**
 * §2.3 structural similarity in [0,1]: 1 for rotation-equivalent levels, else a
 * blend of canonical cell-mask overlap and route/action metrics.
 */
export function structuralSimilarity(a: LevelDefinition, b: LevelDefinition): number {
  if (bestCanonical(a).key === bestCanonical(b).key) return 1;
  let cellSim = 0;
  if (a.gridW === b.gridW && a.gridH === b.gridH) {
    const ta = bestCanonical(a).tokens;
    const tb = bestCanonical(b).tokens;
    let same = 0;
    for (let i = 0; i < ta.length; i++) if (ta[i] === tb[i]) same += 1;
    cellSim = same / ta.length;
  }
  const ma = analyzeLevel(a);
  const mb = analyzeLevel(b);
  const d = (x: number, y: number, scale: number) => Math.min(1, Math.abs(x - y) / scale);
  const metricSim = 1 - (d(ma.essentialLength, mb.essentialLength, 12) + d(ma.decisions, mb.decisions, 10) + d(ma.interactions, mb.interactions, 4)) / 3;
  const sim = cellSim > 0 ? 0.7 * cellSim + 0.3 * metricSim : 0.5 * metricSim;
  return Number(Math.max(0, sim).toFixed(4));
}

/** Rotate a whole level q quarter-turns clockwise (test/analysis helper). */
export function rotateLevelCW(def: LevelDefinition, q = 1): LevelDefinition {
  const turns = ((q % 4) + 4) % 4;
  const { gridW: w } = def;
  const out: CellDef[] = Array.from({ length: def.cells.length }, () => ({ kind: 'empty' as const, rot: 0 }));
  def.cells.forEach((c, i) => {
    const [nx, ny] = rotateXY(i % w, Math.floor(i / w), w, turns);
    out[ny * w + nx] = { ...c, rot: (c.rot + turns) % 4 };
  });
  const remap = (cell: number): number => {
    const [nx, ny] = rotateXY(cell % w, Math.floor(cell / w), w, turns);
    return ny * w + nx;
  };
  return {
    ...def,
    cells: out,
    sources: def.sources.map((s) => ({ ...s, cell: remap(s.cell) })),
    receivers: def.receivers.map((r) => ({ ...r, cell: remap(r.cell) })),
    solutionWitness: def.solutionWitness.map((c) => {
      const raw = c as unknown as Record<string, unknown>;
      return typeof raw.index === 'number'
        ? ({ ...c, index: remap(raw.index as number) } as PlumberCommand)
        : ({ ...c } as PlumberCommand);
    }),
  };
}

function fallbackLevel(puzzleId: string, seed: number, mode: 'child' | 'normal' | 'expert'): LevelDefinition {
  const goal = 3;
  const cells: CellDef[] = [
    { kind: 'source', rot: 0 },
    { kind: 'straight', rot: 0 },
    { kind: 'receiver', rot: 0 },
  ];
  const def: LevelDefinition = {
    ...baseDef(`${puzzleId}#fallback`, seed, mode, 'path', 3, 1),
    cells,
    sources: [{ cell: 0, color: 'blue', portions: goal + 2 }],
    receivers: [{ cell: 2, color: 'blue', goal }],
    solutionWitness: [{ type: 'rotate', index: 1 }],
    difficultyEvidence: { pathLength: 3, rotatable: 1, branches: 0 },
    par: 1,
  };
  if (!certifySolvable(def)) throw new Error('fallback level does not certify');
  return def;
}

export type { PipeKind };
