// Pure domain model of Water Sort. No Phaser, DOM or CSS here.
export const TUBE_CAPACITY = 4;

export type ColorId = string;
export type LayerId = string;

export interface Layer {
  readonly id: LayerId;
  readonly color: ColorId;
}

export interface Tube {
  readonly id: string;
  layers: Layer[]; // bottom..top
}

export interface PourMove {
  from: number;
  to: number;
  count: number;
  color: ColorId;
}

export type PourError =
  | 'empty-source'
  | 'target-full'
  | 'color-mismatch'
  | 'same-tube'
  | 'no-liquid';

export interface SessionState {
  tubes: Tube[];
  known: Set<LayerId>;
  history: PourMove[];
  initialTubes: Tube[];
  initialKnown: Set<LayerId>;
}

export function cloneTubes(tubes: Tube[]): Tube[] {
  return tubes.map((t) => ({ id: t.id, layers: t.layers.slice() }));
}

export function topRun(tube: Tube): { color: ColorId; count: number } | null {
  const n = tube.layers.length;
  if (n === 0) return null;
  const color = tube.layers[n - 1].color;
  let count = 1;
  for (let i = n - 2; i >= 0 && tube.layers[i].color === color; i--) count++;
  return { color, count };
}

export function freeSpace(tube: Tube): number {
  return TUBE_CAPACITY - tube.layers.length;
}

export function canPour(tubes: Tube[], from: number, to: number): PourError | null {
  if (from === to) return 'same-tube';
  if (from < 0 || to < 0 || from >= tubes.length || to >= tubes.length) return 'no-liquid';
  const src = tubes[from];
  const dst = tubes[to];
  if (src.layers.length === 0) return 'empty-source';
  if (dst.layers.length >= TUBE_CAPACITY) return 'target-full';
  const s = topRun(src);
  const d = topRun(dst);
  if (!s) return 'empty-source';
  if (d && d.color !== s.color) return 'color-mismatch';
  return null;
}

/** Applies one pour directly on the given tubes. Returns the performed move or null. */
export function applyPourToTubes(tubes: Tube[], from: number, to: number): PourMove | null {
  if (canPour(tubes, from, to) !== null) return null;
  const src = tubes[from];
  const dst = tubes[to];
  const run = topRun(src);
  if (!run) return null;
  const count = Math.min(run.count, freeSpace(dst));
  if (count <= 0) return null;
  const moved = src.layers.splice(src.layers.length - count, count);
  for (const l of moved) dst.layers.push(l);
  return { from, to, count, color: run.color };
}

export function isTubeComplete(tube: Tube): boolean {
  if (tube.layers.length !== TUBE_CAPACITY) return false;
  const c = tube.layers[0].color;
  return tube.layers.every((l) => l.color === c);
}

export function isWin(tubes: Tube[]): boolean {
  for (const t of tubes) {
    if (t.layers.length === 0) continue;
    if (!isTubeComplete(t)) return false;
  }
  return true;
}

/** Marks every currently-visible top layer as known. Returns newly revealed ids. */
export function revealTops(tubes: Tube[], known: Set<LayerId>): LayerId[] {
  const revealed: LayerId[] = [];
  for (const t of tubes) {
    const top = t.layers[t.layers.length - 1];
    if (top && !known.has(top.id)) {
      known.add(top.id);
      revealed.push(top.id);
    }
  }
  return revealed;
}

/** Classic levels (no hidden layers) show every layer through the glass. */
export function defaultKnownIds(tubes: Tube[], hiddenIds: Set<LayerId>): Set<LayerId> {
  if (hiddenIds.size === 0) {
    const all = new Set<LayerId>();
    for (const t of tubes) for (const l of t.layers) all.add(l.id);
    return all;
  }
  const tops = new Set<LayerId>();
  for (const t of tubes) {
    const top = t.layers[t.layers.length - 1];
    if (top) tops.add(top.id);
  }
  return tops;
}

export function createSession(initialTubes: Tube[], initialKnown?: Set<LayerId>): SessionState {
  const tubes = cloneTubes(initialTubes);
  const known = initialKnown ? new Set(initialKnown) : new Set<LayerId>();
  revealTops(tubes, known);
  return {
    tubes,
    known,
    history: [],
    initialTubes: cloneTubes(initialTubes),
    initialKnown: new Set(known),
  };
}

export type AttemptResult =
  | { ok: true; move: PourMove; revealed: LayerId[] }
  | { ok: false; error: PourError };

export function attemptPour(s: SessionState, from: number, to: number): AttemptResult {
  const err = canPour(s.tubes, from, to);
  if (err !== null) return { ok: false, error: err };
  const move = applyPourToTubes(s.tubes, from, to);
  if (!move) return { ok: false, error: 'no-liquid' };
  s.history.push(move);
  const revealed = revealTops(s.tubes, s.known);
  return { ok: true, move, revealed };
}

/** Undo reverts liquid placement but NEVER hides revealed layers. */
export function undoSession(s: SessionState): boolean {
  const move = s.history.pop();
  if (!move) return false;
  const src = s.tubes[move.to];
  const dst = s.tubes[move.from];
  const moved = src.layers.splice(src.layers.length - move.count, move.count);
  for (const l of moved) dst.layers.push(l);
  return true;
}

/** Restart restores the initial layout, clears history, keeps revealed knowledge. */
export function restartSession(s: SessionState): void {
  s.tubes = cloneTubes(s.initialTubes);
  s.history = [];
  revealTops(s.tubes, s.known);
}

export function colorCounts(tubes: Tube[]): Map<ColorId, number> {
  const m = new Map<ColorId, number>();
  for (const t of tubes)
    for (const l of t.layers) m.set(l.color, (m.get(l.color) ?? 0) + 1);
  return m;
}
