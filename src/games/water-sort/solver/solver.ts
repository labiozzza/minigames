// Deterministic IDA* solver over compact color states.
//
// Budgets count SEARCH NODES, never wall-clock, so results are identical on
// every device. Move order is fixed; ties break by (from, to). Two safe prunes:
//  - never pour out of a completed tube;
//  - never relocate a whole monochrome tube into an empty one (symmetry).
// Returns a winning path or null on budget exhaustion. Optimality is NOT claimed.
import { TUBE_CAPACITY } from '../domain/model';

export interface CompactMove {
  from: number;
  to: number;
}

export function encodeCompact(tubes: number[][]): string {
  return tubes.map((t) => t.join(',')).join(';');
}

export function isWinCompact(tubes: number[][]): boolean {
  for (const t of tubes) {
    if (t.length === 0) continue;
    if (t.length !== TUBE_CAPACITY) return false;
    if (!t.every((c) => c === t[0])) return false;
  }
  return true;
}

function isMono(t: number[]): boolean {
  return t.length > 0 && t.every((c) => c === t[0]);
}

function isComplete(t: number[]): boolean {
  return t.length === TUBE_CAPACITY && isMono(t);
}

function topRun(t: number[]): { color: number; len: number } | null {
  if (!t.length) return null;
  const color = t[t.length - 1];
  let len = 1;
  for (let i = t.length - 2; i >= 0 && t[i] === color; i--) len++;
  return { color, len };
}

/**
 * Estimated remaining work. Combines incomplete-tube count with color-segment
 * pressure. It may overestimate (IDA* stays complete; we never claim optimal
 * paths, only valid ones).
 */
function heuristic(tubes: number[][]): number {
  let bad = 0;
  let segments = 0;
  for (const t of tubes) {
    if (t.length === 0) continue;
    if (!isComplete(t)) bad++;
    let runs = 1;
    for (let i = 1; i < t.length; i++) if (t[i] !== t[i - 1]) runs++;
    segments += runs;
  }
  return Math.max(Math.ceil(bad / 2), Math.floor(segments / 6));
}

interface ScoredMove {
  from: number;
  to: number;
  count: number;
  score: number;
}

function orderedMoves(tubes: number[][]): ScoredMove[] {
  const out: ScoredMove[] = [];
  for (let from = 0; from < tubes.length; from++) {
    const s = tubes[from];
    if (s.length === 0) continue;
    if (isComplete(s)) continue;
    const run = topRun(s);
    if (!run) continue;
    for (let to = 0; to < tubes.length; to++) {
      if (to === from) continue;
      const d = tubes[to];
      if (d.length >= TUBE_CAPACITY) continue;
      const match = d.length > 0 && d[d.length - 1] === run.color;
      if (d.length > 0 && !match) continue;
      if (d.length === 0 && run.len === s.length) continue;
      const count = Math.min(run.len, TUBE_CAPACITY - d.length);
      if (count <= 0) continue;
      let score = 0;
      if (d.length + count === TUBE_CAPACITY && match) score = 3;
      else if (d.length + count === TUBE_CAPACITY) score = 2;
      else if (match) score = 1;
      out.push({ from, to, count, score });
    }
  }
  out.sort((a, b) => b.score - a.score || a.from - b.from || a.to - b.to);
  return out;
}

export interface SolverOptions {
  maxStates?: number; // node budget (kept name for callers)
  maxDepth?: number;
}

export function solveCompact(start: number[][], opts: SolverOptions = {}): CompactMove[] | null {
  const maxNodes = opts.maxStates ?? 150000;
  const maxDepth = opts.maxDepth ?? 160;
  const init = start.map((t) => t.slice());
  if (isWinCompact(init)) return [];
  let bound = heuristic(init);
  let nodes = 0;
  const path: CompactMove[] = [];

  const dfs = (tubes: number[][], g: number, boundNow: number, seen: Map<string, number>): number => {
    const h = heuristic(tubes);
    const f = g + h;
    if (f > boundNow) return f;
    if (isWinCompact(tubes)) return -1;
    if (g >= maxDepth) return Infinity;
    let minNext = Infinity;
    for (const m of orderedMoves(tubes)) {
      if (++nodes > maxNodes) return Infinity;
      const next = tubes.map((t) => t.slice());
      const moved = next[m.from].splice(next[m.from].length - m.count, m.count);
      next[m.to].push(...moved);
      const key = encodeCompact(next);
      const prevDepth = seen.get(key);
      if (prevDepth !== undefined && prevDepth <= g + 1) continue;
      seen.set(key, g + 1);
      path.push({ from: m.from, to: m.to });
      const r = dfs(next, g + 1, boundNow, seen);
      if (r === -1) return -1;
      path.pop();
      if (r < minNext) minNext = r;
      if (nodes > maxNodes) return Infinity;
    }
    return minNext;
  };

  // Transposition table is per bound iteration: bounds grow, so a state pruned
  // under a smaller bound must be re-explored under a larger one.
  for (;;) {
    const seen = new Map<string, number>([[encodeCompact(init), 0]]);
    const r = dfs(init, 0, bound, seen);
    if (r === -1) return path.slice();
    if (r === Infinity || bound > maxDepth) return null;
    bound = r;
    if (nodes > maxNodes) return null;
  }
}
