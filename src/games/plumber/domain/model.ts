// Plumber Stage 1 — pure deterministic domain model (no Phaser/DOM).
// Covers TZ §4–§5 basic subset: grid, ports, rotations, fixed-tick integer
// simulation with volume conservation. Colors/mixers/valves dynamics → Stage 3.

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
export const OPPOSITE: Record<Side, Side> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
// Stable deterministic port order for remainder distribution (§5.1 п.5).
export const PORT_ORDER: Side[] = ['top', 'right', 'bottom', 'left'];

export type PipeKind =
  | 'empty'
  | 'blocked'
  | 'straight'
  | 'elbow'
  | 't'
  | 'cross'
  | 'cap'
  | 'valve'
  | 'source'
  | 'receiver';

export type Phase = 'PREPARING' | 'RUNNING' | 'PAUSED' | 'WON' | 'FAILED' | 'STOPPED';

export interface PortMask {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface CellDef {
  kind: PipeKind;
  /** 0..3 clockwise quarter-turns from base orientation. */
  rot: number;
  /** Only for valve; default open. */
  valveOpen?: boolean;
  /** Fixed pipe: player cannot rotate/move. */
  locked?: boolean;
}

export interface SourceDef {
  cell: number;
  color: string;
  portions: number;
}

export interface ReceiverDef {
  cell: number;
  color: string;
  /** Goal portions. Stage 1: accumulating with auto-close (no overflow error yet). */
  goal: number;
}

export type PlumberCommand =
  | { type: 'rotate'; index: number }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'restart' }
  | { type: 'step' };

export interface LevelDefinition {
  schemaVersion: number;
  rulesetVersion: string;
  generatorVersion: string;
  puzzleId: string;
  seed: number;
  mode: 'child' | 'normal' | 'expert';
  gridW: number;
  gridH: number;
  cells: CellDef[];
  sources: SourceDef[];
  receivers: ReceiverDef[];
  /** Verified action sequence that wins (rotations), for generator certification. */
  solutionWitness: PlumberCommand[];
  difficultyEvidence: { pathLength: number; rotatable: number; branches: number };
}

export interface RuntimeState {
  def: LevelDefinition;
  rots: number[];
  /** Integer portions per cell (single-color Stage 1; color tracked separately). */
  water: number[];
  waterColor: Array<string | null>;
  sourceLeft: number[];
  receiverGot: number[];
  lost: number;
  tick: number;
  phase: Phase;
  log: PlumberCommand[];
  leakCell: number | null;
}

export const SCHEMA_VERSION = 1;
export const RULESET_VERSION = 'plumber-rules/1';
export const GENERATOR_VERSION = 'plumber-gen/0.1-stage1';
/** Per-pipe capacity (portions). Receivers are sinks with capacity = goal. */
export const PIPE_CAPACITY = 4;
export const MAX_TICKS = 1000;

const BASE_PORTS: Record<PipeKind, PortMask> = {
  empty: { top: false, right: false, bottom: false, left: false },
  blocked: { top: false, right: false, bottom: false, left: false },
  straight: { top: true, right: false, bottom: true, left: false },
  elbow: { top: true, right: true, bottom: false, left: false },
  t: { top: true, right: true, bottom: false, left: true },
  cross: { top: true, right: true, bottom: true, left: true },
  cap: { top: true, right: false, bottom: false, left: false },
  valve: { top: true, right: false, bottom: true, left: false },
  source: { top: false, right: true, bottom: false, left: false },
  receiver: { top: false, right: false, bottom: false, left: true },
};

function rotSide(side: Side, rot: number): Side {
  const i = SIDES.indexOf(side);
  return SIDES[((i + rot) % 4 + 4) % 4];
}

/** Effective ports of a cell given current rotation (valve closed → none). */
export function portsOf(cell: CellDef, rot?: number): PortMask {
  const r = ((rot ?? cell.rot) % 4 + 4) % 4;
  if (cell.kind === 'valve' && cell.valveOpen === false) {
    return { top: false, right: false, bottom: false, left: false };
  }
  const base = BASE_PORTS[cell.kind];
  const out: PortMask = { top: false, right: false, bottom: false, left: false };
  for (const s of SIDES) if (base[s]) out[rotSide(s, r)] = true;
  return out;
}

export function neighborOf(index: number, side: Side, w: number, h: number): number | null {
  const x = index % w;
  const y = Math.floor(index / w);
  if (side === 'top') return y > 0 ? index - w : null;
  if (side === 'bottom') return y < h - 1 ? index + w : null;
  if (side === 'left') return x > 0 ? index - 1 : null;
  return x < w - 1 ? index + 1 : null;
}

export function createRuntime(def: LevelDefinition): RuntimeState {
  return {
    def,
    rots: def.cells.map((c) => ((c.rot % 4) + 4) % 4),
    water: def.cells.map(() => 0),
    waterColor: def.cells.map(() => null),
    sourceLeft: def.sources.map((s) => s.portions),
    receiverGot: def.receivers.map(() => 0),
    lost: 0,
    tick: 0,
    phase: 'PREPARING',
    log: [],
    leakCell: null,
  };
}

export function snapshot(s: RuntimeState): Pick<RuntimeState, 'rots' | 'water' | 'waterColor' | 'sourceLeft' | 'receiverGot' | 'lost' | 'tick' | 'phase'> {
  return {
    rots: [...s.rots],
    water: [...s.water],
    waterColor: [...s.waterColor],
    sourceLeft: [...s.sourceLeft],
    receiverGot: [...s.receiverGot],
    lost: s.lost,
    tick: s.tick,
    phase: s.phase,
  };
}

export function restore(s: RuntimeState, snap: ReturnType<typeof snapshot>): void {
  s.rots = [...snap.rots];
  s.water = [...snap.water];
  s.waterColor = [...snap.waterColor];
  s.sourceLeft = [...snap.sourceLeft];
  s.receiverGot = [...snap.receiverGot];
  s.lost = snap.lost;
  s.tick = snap.tick;
  s.phase = snap.phase;
}

function cellAt(def: LevelDefinition, rots: number[], index: number): CellDef {
  return { ...def.cells[index], rot: rots[index] };
}

/** Rotate a pipe in PREPARING (single 90° step). Returns false if forbidden. */
export function applyRotate(s: RuntimeState, index: number): boolean {
  if (s.phase !== 'PREPARING') return false;
  const cell = s.def.cells[index];
  if (cell.kind === 'empty' || cell.kind === 'blocked' || cell.kind === 'source' || cell.kind === 'receiver') return false;
  if (cell.locked) return false;
  if (s.water[index] > 0) return false; // §4.3 default: no touching wet pipes
  s.rots[index] = (s.rots[index] + 1) % 4;
  s.log.push({ type: 'rotate', index });
  return true;
}

/** One fixed logical tick. Deterministic: snapshot → reserve → atomic apply. */
export function stepTick(s: RuntimeState): void {
  if (s.phase !== 'RUNNING') return;
  const { def } = s;
  const w = def.gridW;
  const h = def.gridH;
  const n = w * h;

  const ports: PortMask[] = def.cells.map((_c, i) => portsOf(cellAt(def, s.rots, i)));
  const snapWater = [...s.water];
  const snapColor = [...s.waterColor];
  const reserved = new Array<number>(n).fill(0);
  const receiverReserved = new Array<number>(def.receivers.length).fill(0);
  const receiverByCell = new Map<number, number>();
  def.receivers.forEach((r, i) => receiverByCell.set(r.cell, i));
  const sourceByCell = new Map<number, number>();
  def.sources.forEach((src, i) => sourceByCell.set(src.cell, i));

  interface Move {
    from: number;
    to: number | null;
    toReceiver: number | null;
    amount: number;
    color: string;
  }
  const moves: Move[] = [];

  const freeOf = (idx: number): number => {
    const c = def.cells[idx];
    if (c.kind === 'blocked' || c.kind === 'empty') return 0;
    if (c.kind === 'receiver') return Number.MAX_SAFE_INTEGER;
    return Math.max(0, PIPE_CAPACITY - snapWater[idx] - reserved[idx]);
  };

  // 1) Source injection: 1 portion/tick into own cell if space and stock left.
  def.sources.forEach((src, si) => {
    if (s.sourceLeft[si] <= 0) return;
    const idx = src.cell;
    if (snapWater[idx] + reserved[idx] >= PIPE_CAPACITY) return;
    if (snapWater[idx] > 0 && snapColor[idx] !== src.color) return; // different type waiting — blocked (Stage 3 conflict)
    reserved[idx] += 1;
    moves.push({ from: -1 - si, to: idx, toReceiver: null, amount: 1, color: src.color });
  });

  // 2) Pipe forwarding in index order; amounts computed from snapshot + reservations.
  for (let i = 0; i < n; i++) {
    const kind = def.cells[i].kind;
    if (kind === 'blocked' || kind === 'empty' || kind === 'source' || kind === 'receiver') {
      if (kind !== 'source') continue;
      // Source cell also forwards its held water like a pipe (outlet = its ports).
    }
    const held = snapWater[i];
    if (held <= 0) continue;
    const color = snapColor[i] ?? 'water';
    const myPorts = ports[i];
    // Candidate exits: connected neighbor with matching opposite port.
    const exits: Array<{ to: number; toReceiver: number | null; side: Side }> = [];
    for (const side of PORT_ORDER) {
      if (!myPorts[side]) continue;
      const nb = neighborOf(i, side, w, h);
      if (nb === null) {
        exits.push({ to: -999, toReceiver: null, side }); // open edge → explicit leak sink
        continue;
      }
      const nbKind = def.cells[nb].kind;
      if (nbKind === 'blocked' || nbKind === 'empty') continue;
      const nbPorts = ports[nb];
      if (!nbPorts[OPPOSITE[side]]) {
        // Facing a wall / mismatched port: not an exit (no leak, water waits).
        continue;
      }
      if (nbKind === 'receiver') {
        const ri = receiverByCell.get(nb);
        if (ri === undefined) continue;
        const want = def.receivers[ri];
        if (snapColor[i] !== null && snapColor[i] !== want.color) continue; // wrong type never enters
        if (s.receiverGot[ri] + receiverReserved[ri] >= want.goal) continue; // auto-closed
        exits.push({ to: nb, toReceiver: ri, side });
      } else {
        if (freeOf(nb) <= 0) continue;
        if (snapWater[nb] > 0 && snapColor[nb] !== color) continue; // different fluids never share a channel (§5.1 п.7)
        exits.push({ to: nb, toReceiver: null, side });
      }
    }
    if (exits.length === 0) continue;
    // Uniform split with stable remainder order (§5.1 п.5).
    let remaining = held;
    const totalFree = exits.reduce((acc, e) => {
      if (e.to === -999) return acc + remaining; // leak sink absorbs
      if (e.toReceiver !== null) return acc + (def.receivers[e.toReceiver].goal - s.receiverGot[e.toReceiver] - receiverReserved[e.toReceiver]);
      return acc + freeOf(e.to);
    }, 0);
    const toMove = Math.min(remaining, totalFree);
    const base = Math.floor(toMove / exits.length);
    let rem = toMove % exits.length;
    for (const e of exits) {
      let amt = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
      if (e.to !== -999 && e.toReceiver === null) amt = Math.min(amt, freeOf(e.to));
      if (e.toReceiver !== null) {
        amt = Math.min(amt, def.receivers[e.toReceiver].goal - s.receiverGot[e.toReceiver] - receiverReserved[e.toReceiver]);
      }
      if (amt <= 0) continue;
      remaining -= amt;
      if (e.to === -999) {
        moves.push({ from: i, to: null, toReceiver: null, amount: amt, color });
      } else if (e.toReceiver !== null) {
        receiverReserved[e.toReceiver] += amt;
        moves.push({ from: i, to: e.to, toReceiver: e.toReceiver, amount: amt, color });
      } else {
        reserved[e.to] += amt;
        moves.push({ from: i, to: e.to, toReceiver: null, amount: amt, color });
      }
    }
  }

  // 3) Atomic apply.
  for (const m of moves) {
    if (m.from >= 0) {
      s.water[m.from] -= m.amount;
      if (s.water[m.from] <= 0) {
        s.water[m.from] = 0;
        s.waterColor[m.from] = null;
      }
    } else {
      const si = -1 - m.from;
      s.sourceLeft[si] -= m.amount;
    }
    if (m.to === null) {
      s.lost += m.amount; // explicit leak sink (§5.1 п.3)
      if (s.leakCell === null && m.from >= 0) s.leakCell = m.from;
    } else if (m.toReceiver !== null) {
      s.receiverGot[m.toReceiver] += m.amount;
    } else {
      if (s.water[m.to] === 0) s.waterColor[m.to] = m.color;
      s.water[m.to] += m.amount;
    }
  }

  s.tick += 1;

  // 4) Terminal conditions.
  const won = def.receivers.every((r, i) => s.receiverGot[i] >= r.goal);
  if (won) {
    s.phase = 'WON';
    return;
  }
  const stable = moves.length === 0;
  const exhausted = s.sourceLeft.every((v) => v <= 0);
  if ((stable && exhausted) || s.tick >= MAX_TICKS) {
    s.phase = s.receiverGot.some((v, i) => v >= def.receivers[i].goal) ? 'WON' : 'FAILED';
  }
}

/** Total volume invariant: sources_initial == sourceLeft + pipes + receivers + lost. */
export function totalVolume(s: RuntimeState): { initial: number; accounted: number; ok: boolean } {
  const initial = s.def.sources.reduce((a, x) => a + x.portions, 0);
  const pipes = s.water.reduce((a, v) => a + v, 0);
  const recv = s.receiverGot.reduce((a, v) => a + v, 0);
  const left = s.sourceLeft.reduce((a, v) => a + v, 0);
  const accounted = left + pipes + recv + s.lost;
  return { initial, accounted, ok: initial === accounted };
}

export function applyCommand(s: RuntimeState, cmd: PlumberCommand): boolean {
  switch (cmd.type) {
    case 'rotate':
      return applyRotate(s, cmd.index);
    case 'start':
      if (s.phase !== 'PREPARING' && s.phase !== 'STOPPED') return false;
      s.phase = 'RUNNING';
      s.log.push(cmd);
      return true;
    case 'pause':
      if (s.phase !== 'RUNNING') return false;
      s.phase = 'PAUSED';
      s.log.push(cmd);
      return true;
    case 'resume':
      if (s.phase !== 'PAUSED') return false;
      s.phase = 'RUNNING';
      s.log.push(cmd);
      return true;
    case 'stop':
      if (s.phase !== 'RUNNING' && s.phase !== 'PAUSED' && s.phase !== 'FAILED') return false;
      s.phase = 'STOPPED';
      s.log.push(cmd);
      return true;
    case 'restart': {
      // Assembly (rots) preserved; trial resources reset (§4.3).
      const rots = [...s.rots];
      const fresh = createRuntime(s.def);
      fresh.rots = rots;
      fresh.log = [...s.log, cmd];
      restore(s, { ...snapshot(fresh), rots, phase: 'PREPARING' });
      s.log = fresh.log;
      s.leakCell = null;
      return true;
    }
    case 'step':
      if (s.phase !== 'RUNNING') return false;
      stepTick(s);
      s.log.push(cmd);
      return true;
  }
}

/** Run trial to completion (or MAX_TICKS). Returns final phase. */
export function runToEnd(s: RuntimeState): Phase {
  if (s.phase === 'PREPARING' || s.phase === 'STOPPED') s.phase = 'RUNNING';
  while (s.phase === 'RUNNING' && s.tick < MAX_TICKS) stepTick(s);
  return s.phase;
}

/** Canonical checksum of final model state (for replay determinism checks). */
export function checksum(s: RuntimeState): string {
  const core = [s.rots.join(','), s.water.join(','), s.sourceLeft.join(','), s.receiverGot.join(','), s.lost, s.tick, s.phase].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < core.length; i++) {
    h ^= core.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
