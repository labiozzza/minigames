// Plumber domain model — pure deterministic core (no Phaser/DOM).
// Stage 1: grid, ports, fixed-tick integer simulation, volume conservation.
// Stage 3: colors/conflicts, mixer, filter, distributor, dynamic valves,
// 4 receiver types, programs, carry/inventory. All additive & backward
// compatible with rules/1 definitions (new fields optional with defaults).

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
  | 'filter'
  | 'mixer'
  | 'distributor'
  | 'source'
  | 'receiver';

export type Phase = 'PREPARING' | 'RUNNING' | 'PAUSED' | 'WON' | 'FAILED' | 'STOPPED';

export interface PortMask {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface CarriedPipe {
  kind: PipeKind;
  filterAllow?: string[];
  recipeIn?: Record<string, number>;
  recipeOut?: { color: string; count: number };
  ratio?: [number, number];
}

export interface CellDef {
  kind: PipeKind;
  /** 0..3 clockwise quarter-turns from base orientation. */
  rot: number;
  /** Only for valve; default open. Runtime state lives in RuntimeState.valves. */
  valveOpen?: boolean;
  /** Fixed pipe: player cannot rotate/move. */
  locked?: boolean;
  /** Only for filter: allowed colors. Default: all. */
  filterAllow?: string[];
  /** Only for mixer: e.g. {red:2, blue:1}. */
  recipeIn?: Record<string, number>;
  /** Only for mixer: e.g. {color:'purple', count:3}. */
  recipeOut?: { color: string; count: number };
  /** Only for distributor (2 exits): deterministic share pattern. */
  ratio?: [number, number];
  /** Only for buffer receivers: outlet side (rotates with the cell). */
  outlet?: Side;
}

export type ReceiverKind = 'auto' | 'overflow' | 'exact' | 'buffer';

export interface SourceDef {
  cell: number;
  color: string;
  portions: number;
  /** Program-controlled sources start disabled. Default true. */
  enabled?: boolean;
}

export interface ReceiverDef {
  cell: number;
  color: string;
  /** Goal portions. Default kind 'auto': accumulating with auto-close. */
  goal: number;
  kind?: ReceiverKind;
  /** Only for 'buffer': outlet side emitting downstream. */
  outlet?: Side;
  /** Only for 'buffer': emit 1 portion every N ticks. Default 3. */
  releaseEvery?: number;
  /** Only for 'buffer': max stock. Default goal + 4. */
  bufferCap?: number;
}

/** Visual sequential program step (expert levels). Executed on logical ticks. */
export type ProgramCmd =
  | { type: 'feed'; source: number; count: number }
  | { type: 'toggleSource'; source: number; state: boolean }
  | { type: 'switchValve'; index: number; state: boolean };

export type PlumberCommand =
  | { type: 'rotate'; index: number }
  | { type: 'toggleValve'; index: number }
  | { type: 'pickup'; index: number }
  | { type: 'place'; index: number }
  | { type: 'placeStock'; kind: PipeKind; index: number }
  | { type: 'appendProgram'; cmd: ProgramCmd }
  | { type: 'removeProgram'; at: number }
  | { type: 'moveProgram'; from: number; to: number }
  | { type: 'markHint' }
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
  family: string;
  gridW: number;
  gridH: number;
  cells: CellDef[];
  sources: SourceDef[];
  receivers: ReceiverDef[];
  /** Dynamic trial: valves may toggle mid-run, stall doesn't fail fast. */
  dynamic?: boolean;
  /** Player builds/executes a visual program on this level. */
  programmed?: boolean;
  /** Prefilled program steps (editable in PREPARING). */
  program?: ProgramCmd[];
  /** Carryable stock for placeStock (multiset of kinds). */
  inventory?: PipeKind[];
  /** Verified action sequence that wins (rotations + valve/program ops). */
  solutionWitness: PlumberCommand[];
  difficultyEvidence: { pathLength: number; rotatable: number; branches: number };
  /** Par rotations for stars (defaults to witness rotation count). */
  par?: number;
  /**
   * §14: published admin config this level was generated under. A level keeps
   * its pinned revision for its whole life, so publishing a new config only
   * affects newly generated puzzles.
   */
  configRevision?: number;
  configChecksum?: string;
}

export interface MixerStock {
  color: string;
  count: number;
}

export interface RuntimeState {
  def: LevelDefinition;
  rots: number[];
  /** Live cell kind overrides (pickup/place). Null = def kind. */
  kinds: Array<PipeKind | null>;
  /** Live filter/recipe/ratio overrides for placed/carried pipes. */
  liveConfig: Array<CarriedPipe | null>;
  /** Integer portions per cell. */
  water: number[];
  waterColor: Array<string | null>;
  /** Valve open states (parallel to cells). */
  valves: boolean[];
  /** Mixer input stock per cell. */
  mixerStock: MixerStock[][];
  /** Distributor cycle counters. */
  distCount: number[];
  sourceLeft: number[];
  sourceEnabled: boolean[];
  receiverGot: number[];
  /** Lifetime received per receiver (win latch for buffer type). */
  receivedTotal: number[];
  /** Externally fed portions (Feed program cmd) for conservation. */
  fedTotal: number;
  /** Carried pipe (pickup/place). */
  carried: CarriedPipe | null;
  /** Entry side of current water per cell (no immediate backflow). */
  cameFrom: Array<Side | null>;
  /** Remaining inventory stock. */
  inventoryLeft: PipeKind[];
  /** Player program under execution. */
  program: ProgramCmd[];
  programCounter: number;
  lost: number;
  tick: number;
  idleTicks: number;
  phase: Phase;
  log: PlumberCommand[];
  leakCell: number | null;
  errorCell: number | null;
  errorKind: string | null;
  playerRotations: number;
  hintsUsed: number;
}

export const SCHEMA_VERSION = 1;
export const RULESET_VERSION = 'plumber-rules/2';
export const GENERATOR_VERSION = 'plumber-gen/0.2-stage3';
/** Per-pipe capacity (portions). Receivers are sinks with capacity = goal. */
export const PIPE_CAPACITY = 4;
export const MAX_TICKS = 1000;
/** Dynamic trials tolerate this many idle ticks before stall-fail. */
export const DYNAMIC_IDLE_LIMIT = 300;

const BASE_PORTS: Record<PipeKind, PortMask> = {
  empty: { top: false, right: false, bottom: false, left: false },
  blocked: { top: false, right: false, bottom: false, left: false },
  straight: { top: true, right: false, bottom: true, left: false },
  elbow: { top: true, right: true, bottom: false, left: false },
  t: { top: true, right: true, bottom: false, left: true },
  cross: { top: true, right: true, bottom: true, left: true },
  cap: { top: true, right: false, bottom: false, left: false },
  valve: { top: true, right: false, bottom: true, left: false },
  filter: { top: true, right: false, bottom: true, left: false },
  mixer: { top: true, right: true, bottom: true, left: true },
  distributor: { top: true, right: true, bottom: false, left: true },
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
  if (cell.kind === 'receiver' && cell.outlet) out[rotSide(cell.outlet, r)] = true;
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

export function kindAt(s: RuntimeState, index: number): PipeKind {
  return s.kinds[index] ?? s.def.cells[index].kind;
}

function configAt(s: RuntimeState, index: number): CarriedPipe | null {
  if (s.liveConfig[index]) return s.liveConfig[index];
  const c = s.def.cells[index];
  if (c.kind === 'filter' || c.kind === 'mixer' || c.kind === 'distributor') {
    return { kind: c.kind, filterAllow: c.filterAllow ? [...c.filterAllow] : undefined, recipeIn: c.recipeIn ? { ...c.recipeIn } : undefined, recipeOut: c.recipeOut ? { ...c.recipeOut } : undefined, ratio: c.ratio ? [...c.ratio] as [number, number] : undefined };
  }
  return null;
}

export function createRuntime(def: LevelDefinition): RuntimeState {
  return {
    def,
    rots: def.cells.map((c) => ((c.rot % 4) + 4) % 4),
    kinds: def.cells.map(() => null),
    liveConfig: def.cells.map(() => null),
    water: def.cells.map(() => 0),
    waterColor: def.cells.map(() => null),
    valves: def.cells.map((c) => c.valveOpen !== false),
    mixerStock: def.cells.map(() => []),
    distCount: def.cells.map(() => 0),
    sourceLeft: def.sources.map((x) => x.portions),
    sourceEnabled: def.sources.map((x) => x.enabled !== false),
    receiverGot: def.receivers.map(() => 0),
    receivedTotal: def.receivers.map(() => 0),
    fedTotal: 0,
    carried: null,
    cameFrom: def.cells.map(() => null),
    inventoryLeft: def.inventory ? [...def.inventory] : [],
    program: def.program ? def.program.map((c) => ({ ...c })) : [],
    programCounter: 0,
    lost: 0,
    tick: 0,
    idleTicks: 0,
    phase: 'PREPARING',
    log: [],
    leakCell: null,
    errorCell: null,
    errorKind: null,
    playerRotations: 0,
    hintsUsed: 0,
  };
}

export type Snapshot = Pick<RuntimeState, 'rots' | 'kinds' | 'liveConfig' | 'water' | 'waterColor' | 'valves' | 'mixerStock' | 'distCount' | 'sourceLeft' | 'sourceEnabled' | 'receiverGot' | 'receivedTotal' | 'fedTotal' | 'carried' | 'cameFrom' | 'inventoryLeft' | 'program' | 'programCounter' | 'lost' | 'tick' | 'idleTicks' | 'phase' | 'playerRotations' | 'hintsUsed'>;

export function snapshot(s: RuntimeState): Snapshot {
  return {
    rots: [...s.rots],
    kinds: [...s.kinds],
    liveConfig: s.liveConfig.map((c) => (c ? JSON.parse(JSON.stringify(c)) as CarriedPipe : null)),
    water: [...s.water],
    waterColor: [...s.waterColor],
    valves: [...s.valves],
    mixerStock: s.mixerStock.map((a) => a.map((e) => ({ ...e }))),
    distCount: [...s.distCount],
    sourceLeft: [...s.sourceLeft],
    sourceEnabled: [...s.sourceEnabled],
    receiverGot: [...s.receiverGot],
    receivedTotal: [...s.receivedTotal],
    fedTotal: s.fedTotal,
    carried: s.carried ? JSON.parse(JSON.stringify(s.carried)) as CarriedPipe : null,
    cameFrom: [...s.cameFrom],
    inventoryLeft: [...s.inventoryLeft],
    program: s.program.map((c) => ({ ...c })),
    programCounter: s.programCounter,
    lost: s.lost,
    tick: s.tick,
    idleTicks: s.idleTicks,
    phase: s.phase,
    playerRotations: s.playerRotations,
    hintsUsed: s.hintsUsed,
  };
}

export function restore(s: RuntimeState, snap: Snapshot): void {
  s.rots = [...snap.rots];
  s.kinds = [...(snap.kinds ?? s.def.cells.map(() => null))];
  s.liveConfig = (snap.liveConfig ?? s.def.cells.map(() => null)).map((c) => (c ? { ...c } : null));
  s.water = [...snap.water];
  s.waterColor = [...snap.waterColor];
  s.valves = [...(snap.valves ?? s.def.cells.map((c) => c.valveOpen !== false))];
  s.mixerStock = (snap.mixerStock ?? s.def.cells.map(() => [])).map((a) => a.map((e) => ({ ...e })));
  s.distCount = [...(snap.distCount ?? s.def.cells.map(() => 0))];
  s.sourceLeft = [...snap.sourceLeft];
  s.sourceEnabled = [...(snap.sourceEnabled ?? s.def.sources.map((x) => x.enabled !== false))];
  s.receiverGot = [...snap.receiverGot];
  s.receivedTotal = [...(snap.receivedTotal ?? snap.receiverGot)];
  s.fedTotal = snap.fedTotal ?? 0;
  s.carried = snap.carried ? { ...snap.carried } : null;
  s.cameFrom = [...(snap.cameFrom ?? s.def.cells.map(() => null))];
  s.inventoryLeft = [...(snap.inventoryLeft ?? [])];
  s.program = (snap.program ?? []).map((c) => ({ ...c }));
  s.programCounter = snap.programCounter ?? 0;
  s.lost = snap.lost;
  s.tick = snap.tick;
  s.idleTicks = snap.idleTicks ?? 0;
  s.phase = snap.phase;
  s.playerRotations = snap.playerRotations ?? 0;
  s.hintsUsed = snap.hintsUsed ?? 0;
}

function cellAt(s: RuntimeState, index: number): CellDef {
  const base = s.def.cells[index];
  const cell: CellDef = { ...base, kind: kindAt(s, index), rot: s.rots[index] };
  if (cell.kind === 'valve') cell.valveOpen = s.valves[index];
  const live = configAt(s, index);
  if (live) {
    if (live.filterAllow) cell.filterAllow = live.filterAllow;
    if (live.recipeIn) cell.recipeIn = live.recipeIn;
    if (live.recipeOut) cell.recipeOut = live.recipeOut;
    if (live.ratio) cell.ratio = live.ratio;
  }
  return cell;
}

/** Rotate a pipe in PREPARING (single 90° step). Returns false if forbidden. */
export function applyRotate(s: RuntimeState, index: number): boolean {
  if (s.phase !== 'PREPARING') return false;
  const kind = kindAt(s, index);
  if (kind === 'empty' || kind === 'blocked' || kind === 'source' || kind === 'receiver') return false;
  if (s.def.cells[index].locked) return false;
  if (s.water[index] > 0) return false; // §4.3 default: no touching wet pipes
  s.rots[index] = (s.rots[index] + 1) % 4;
  s.playerRotations += 1;
  s.log.push({ type: 'rotate', index });
  return true;
}

const MOVABLE: PipeKind[] = ['straight', 'elbow', 't', 'cross', 'cap', 'valve', 'filter', 'mixer', 'distributor'];

/** Toggle a valve. PREPARING always; mid-trial only on dynamic levels. */
export function applyToggleValve(s: RuntimeState, index: number): boolean {
  if (kindAt(s, index) !== 'valve') return false;
  if (s.def.cells[index].locked) return false;
  if (s.phase !== 'PREPARING' && !(s.def.dynamic && (s.phase === 'RUNNING' || s.phase === 'PAUSED'))) return false;
  s.valves[index] = !s.valves[index];
  s.idleTicks = 0;
  s.log.push({ type: 'toggleValve', index });
  return true;
}

/** Pick up a dry unlocked pipe into hands (carry mechanic). */
export function applyPickup(s: RuntimeState, index: number): boolean {
  if (s.phase !== 'PREPARING' || s.carried !== null) return false;
  const kind = kindAt(s, index);
  if (!MOVABLE.includes(kind)) return false;
  if (s.def.cells[index].locked) return false;
  if (s.water[index] > 0 || (s.mixerStock[index]?.length ?? 0) > 0) return false;
  const live = configAt(s, index);
  s.carried = { kind, ...(live?.filterAllow ? { filterAllow: live.filterAllow } : {}), ...(live?.recipeIn ? { recipeIn: live.recipeIn } : {}), ...(live?.recipeOut ? { recipeOut: live.recipeOut } : {}), ...(live?.ratio ? { ratio: live.ratio } : {}) };
  s.kinds[index] = 'empty';
  s.liveConfig[index] = null;
  s.rots[index] = 0;
  s.log.push({ type: 'pickup', index });
  return true;
}

/** Place the carried pipe onto an empty cell. */
export function applyPlace(s: RuntimeState, index: number): boolean {
  if (s.phase !== 'PREPARING' || s.carried === null) return false;
  if (kindAt(s, index) !== 'empty') return false;
  const carried = s.carried;
  s.kinds[index] = carried.kind;
  s.liveConfig[index] = { ...carried };
  s.rots[index] = 0;
  s.carried = null;
  s.log.push({ type: 'place', index });
  return true;
}

/** Place one stock pipe from inventory onto an empty cell. */
export function applyPlaceStock(s: RuntimeState, kind: PipeKind, index: number): boolean {
  if (s.phase !== 'PREPARING') return false;
  if (kindAt(s, index) !== 'empty') return false;
  const at = s.inventoryLeft.indexOf(kind);
  if (at < 0) return false;
  s.inventoryLeft.splice(at, 1);
  s.kinds[index] = kind;
  s.liveConfig[index] = null;
  s.rots[index] = 0;
  s.log.push({ type: 'placeStock', kind, index });
  return true;
}

function programEditable(s: RuntimeState): boolean {
  return !!s.def.programmed && s.phase === 'PREPARING';
}

export function applyAppendProgram(s: RuntimeState, cmd: ProgramCmd): boolean {
  if (!programEditable(s) || s.program.length >= 24) return false;
  if (cmd.type === 'feed' && (cmd.source < 0 || cmd.source >= s.def.sources.length || cmd.count < 1 || cmd.count > 20)) return false;
  if (cmd.type === 'toggleSource' && (cmd.source < 0 || cmd.source >= s.def.sources.length)) return false;
  if (cmd.type === 'switchValve' && kindAt(s, cmd.index) !== 'valve') return false;
  s.program.push({ ...cmd });
  s.log.push({ type: 'appendProgram', cmd: { ...cmd } });
  return true;
}

export function applyRemoveProgram(s: RuntimeState, at: number): boolean {
  if (!programEditable(s) || at < 0 || at >= s.program.length) return false;
  s.program.splice(at, 1);
  s.log.push({ type: 'removeProgram', at });
  return true;
}

export function applyMoveProgram(s: RuntimeState, from: number, to: number): boolean {
  if (!programEditable(s) || from < 0 || from >= s.program.length || to < 0 || to >= s.program.length) return false;
  const [cmd] = s.program.splice(from, 1);
  s.program.splice(to, 0, cmd);
  s.log.push({ type: 'moveProgram', from, to });
  return true;
}

function execProgramCmd(s: RuntimeState, cmd: ProgramCmd): void {
  if (cmd.type === 'feed') {
    if (cmd.source >= 0 && cmd.source < s.def.sources.length) {
      s.sourceLeft[cmd.source] = Math.min(999, s.sourceLeft[cmd.source] + cmd.count);
      s.fedTotal += cmd.count;
    }
  } else if (cmd.type === 'toggleSource') {
    if (cmd.source >= 0 && cmd.source < s.def.sources.length) s.sourceEnabled[cmd.source] = cmd.state;
  } else if (cmd.type === 'switchValve') {
    if (kindAt(s, cmd.index) === 'valve') s.valves[cmd.index] = cmd.state;
  }
}

function mixerStockTotal(s: RuntimeState, i: number): number {
  return s.mixerStock[i].reduce((a, e) => a + e.count, 0);
}

function mixerCapacityLeft(s: RuntimeState, i: number): number {
  return Math.max(0, PIPE_CAPACITY - s.water[i] - mixerStockTotal(s, i));
}

/** Try to fire mixer reactions (bounded, deterministic). */
function reactMixers(s: RuntimeState, ports: PortMask[]): void {
  const n = s.def.gridW * s.def.gridH;
  for (let i = 0; i < n; i++) {
    if (kindAt(s, i) !== 'mixer') continue;
    const cell = cellAt(s, i);
    const recipeIn = cell.recipeIn ?? {};
    const recipeOut = cell.recipeOut;
    if (!recipeOut) continue;
    void ports;
    for (let iter = 0; iter < 8; iter++) {
      const okIn = Object.entries(recipeIn).every(([color, qty]) => (s.mixerStock[i].find((e) => e.color === color)?.count ?? 0) >= qty);
      if (!okIn) break;
      const heldColor = s.waterColor[i];
      if (s.water[i] > 0 && heldColor !== recipeOut.color) break;
      if (s.water[i] + recipeOut.count > PIPE_CAPACITY) break;
      for (const [color, qty] of Object.entries(recipeIn)) {
        const entry = s.mixerStock[i].find((e) => e.color === color);
        if (entry) entry.count -= qty;
      }
      s.mixerStock[i] = s.mixerStock[i].filter((e) => e.count > 0);
      if (s.water[i] === 0) s.waterColor[i] = recipeOut.color;
      s.water[i] += recipeOut.count;
    }
  }
}

/** Conduit kinds leak through unconnected open ports; device kinds
 *  (mixer/distributor/source/receiver) treat them as closed flanges. */
const LEAKY: ReadonlySet<PipeKind> = new Set(['straight', 'elbow', 't', 'cross', 'cap', 'valve', 'filter']);

/** One fixed logical tick. Deterministic: snapshot → reserve → atomic apply. */
export function stepTick(s: RuntimeState): void {
  if (s.phase !== 'RUNNING') return;
  const { def } = s;
  const w = def.gridW;
  const h = def.gridH;
  const n = w * h;

  const ports: PortMask[] = def.cells.map((_c, i) => portsOf(cellAt(s, i)));
  const snapWater = [...s.water];
  const snapColor = [...s.waterColor];
  const reserved = new Array<number>(n).fill(0);
  const receiverReserved = new Array<number>(def.receivers.length).fill(0);
  const receiverByCell = new Map<number, number>();
  def.receivers.forEach((r, i) => receiverByCell.set(r.cell, i));

  interface Move {
    from: number;
    to: number | null;
    toReceiver: number | null;
    amount: number;
    color: string;
    /** Exit side from the sender cell (null for external injection). */
    side: Side | null;
  }
  const moves: Move[] = [];
  let colorConflict = -1;

  const freeOf = (idx: number): number => {
    const k = kindAt(s, idx);
    if (k === 'blocked' || k === 'empty') return 0;
    if (k === 'receiver') {
      const ri = receiverByCell.get(idx);
      const r = ri !== undefined ? def.receivers[ri] : undefined;
      if (r && r.kind === 'buffer') {
        return Math.max(0, (r.bufferCap ?? r.goal + 4) - s.receiverGot[ri as number] - receiverReserved[ri as number]);
      }
      return Number.MAX_SAFE_INTEGER;
    }
    if (k === 'mixer') return Math.max(0, mixerCapacityLeft(s, idx) - reserved[idx]);
    return Math.max(0, PIPE_CAPACITY - snapWater[idx] - reserved[idx]);
  };

  // A) Program: one command per tick, in order.
  if (s.programCounter < s.program.length) {
    execProgramCmd(s, s.program[s.programCounter]);
    s.programCounter += 1;
    s.idleTicks = 0;
  }

  // F) Mixer reactions (use last tick's stock; outputs may leave this same tick).
  reactMixers(s, ports);

  // B) Source injection (1/tick) + buffer-receiver releases.
  def.sources.forEach((src, si) => {
    if (!s.sourceEnabled[si] || s.sourceLeft[si] <= 0) return;
    const idx = src.cell;
    if (snapWater[idx] + reserved[idx] >= PIPE_CAPACITY) return;
    if (snapWater[idx] > 0 && snapColor[idx] !== src.color) return;
    reserved[idx] += 1;
    moves.push({ from: -1 - si, to: idx, toReceiver: null, amount: 1, color: src.color, side: null });
  });
  def.receivers.forEach((r, ri) => {
    if (r.kind !== 'buffer' || !r.outlet) return;
    if (s.receiverGot[ri] <= 0) return;
    const every = r.releaseEvery ?? 3;
    if (s.tick % every !== 0) return;
    const nb = neighborOf(r.cell, r.outlet, w, h);
    if (nb === null) return;
    if (!ports[nb][OPPOSITE[r.outlet]]) return;
    if (freeOf(nb) <= 0) return;
    if (snapWater[nb] > 0 && snapColor[nb] !== r.color) return;
    reserved[nb] += 1;
    s.receiverGot[ri] -= 1;
    moves.push({ from: -1000 - ri, to: nb, toReceiver: null, amount: 1, color: r.color, side: r.outlet ?? null });
  });

  const receiverRoom = (ri: number): number => {
    const r = def.receivers[ri];
    const kind = r.kind ?? 'auto';
    if (kind === 'overflow') return Number.MAX_SAFE_INTEGER;
    if (kind === 'buffer') return Math.max(0, (r.bufferCap ?? r.goal + 4) - s.receiverGot[ri] - receiverReserved[ri]);
    if (kind === 'exact') return Number.MAX_SAFE_INTEGER; // excess fails explicitly on apply
    return Math.max(0, r.goal - s.receiverGot[ri] - receiverReserved[ri]); // auto
  };

  // C+D) Forwarding with per-kind exit rules.
  for (let i = 0; i < n; i++) {
    const k = kindAt(s, i);
    if (k === 'blocked' || k === 'empty' || k === 'receiver') continue;
    const held = snapWater[i];
    if (held <= 0) continue;
    const color = snapColor[i] ?? 'water';
    const myPorts = ports[i];
    const exits: Array<{ to: number; toReceiver: number | null; side: Side }> = [];
    for (const side of PORT_ORDER) {
      if (!myPorts[side]) continue;
      const nb = neighborOf(i, side, w, h);
      if (nb === null) {
        // Open edge: conduits leak, devices treat it as a closed flange.
        if (LEAKY.has(k)) exits.push({ to: -999, toReceiver: null, side });
        continue;
      }
      const nbKind = kindAt(s, nb);
      if (nbKind === 'blocked' || nbKind === 'empty') continue;
      if (nbKind === 'source') continue; // emitters never accept inflow (no backflow)
      const nbPorts = ports[nb];
      if (!nbPorts[OPPOSITE[side]]) continue; // wall: water waits, no leak
      if (nbKind === 'receiver') {
        const ri = receiverByCell.get(nb);
        if (ri === undefined) continue;
        const want = def.receivers[ri];
        if (snapColor[i] !== null && snapColor[i] !== want.color) {
          if (colorConflict < 0) colorConflict = i;
          continue;
        }
        if ((want.kind ?? 'auto') === 'auto' && receiverRoom(ri) <= 0) continue; // auto-closed
        if ((want.kind ?? 'auto') === 'buffer' && receiverRoom(ri) <= 0) continue;
        exits.push({ to: nb, toReceiver: ri, side });
      } else {
        if (nbKind === 'filter') {
          const allow = cellAt(s, nb).filterAllow;
          if (allow && !allow.includes(color)) continue; // filter wall (no error)
        }
        if (freeOf(nb) <= 0) continue;
        if (snapWater[nb] > 0 && snapColor[nb] !== color) {
          if (colorConflict < 0) colorConflict = i;
          continue; // different fluids never share a channel (§5.1 п.7)
        }
        exits.push({ to: nb, toReceiver: null, side });
      }
    }
    if (exits.length === 0) continue;
    // No immediate backflow: skip the entry side unless it is the only exit.
    const fwd = exits.filter((e) => e.side !== s.cameFrom[i]);
    const use = fwd.length > 0 ? fwd : exits;
    const roomOf = (e: { to: number; toReceiver: number | null }): number => {
      if (e.to === -999) return held;
      if (e.toReceiver !== null) return receiverRoom(e.toReceiver);
      return freeOf(e.to);
    };
    if (k === 'distributor') {
      // Deterministic ratio pattern over consecutive units (§5.1 distributor).
      const cfg = cellAt(s, i);
      const ratio = cfg.ratio ?? [1, 1];
      const slots: number[] = [];
      ratio.forEach((q, ei) => {
        for (let qk = 0; qk < q; qk++) slots.push(ei % use.length);
      });
      if (slots.length === 0) continue;
      let remaining = held;
      let guard = 0;
      while (remaining > 0 && guard++ < held + use.length) {
        const slot = slots[(s.distCount[i] + guard - 1) % slots.length];
        const e = use[slot];
        const room = e.to === -999 ? remaining : e.toReceiver !== null ? Math.min(remaining, receiverRoom(e.toReceiver)) : Math.min(remaining, freeOf(e.to));
        if (room <= 0) {
          if (use.every((x) => (x.to === -999 ? false : x.toReceiver !== null ? receiverRoom(x.toReceiver) <= 0 : freeOf(x.to) <= 0))) break;
          continue;
        }
        remaining -= 1;
        s.distCount[i] += 1;
        if (e.to === -999) moves.push({ from: i, to: null, toReceiver: null, amount: 1, color, side: e.side });
        else if (e.toReceiver !== null) {
          receiverReserved[e.toReceiver] += 1;
          moves.push({ from: i, to: e.to, toReceiver: e.toReceiver, amount: 1, color, side: e.side });
        } else {
          reserved[e.to] += 1;
          moves.push({ from: i, to: e.to, toReceiver: null, amount: 1, color, side: e.side });
        }
      }
      continue;
    }
    // Uniform split with stable remainder order (§5.1 п.5).
    const remaining0 = held;
    const totalFree = use.reduce((acc, e) => acc + Math.min(remaining0, roomOf(e)), 0);
    const toMove = Math.min(remaining0, totalFree);
    const base = Math.floor(toMove / use.length);
    let rem = toMove % use.length;
    for (const e of use) {
      let amt = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
      amt = Math.min(amt, e.to === -999 ? amt : e.toReceiver !== null ? receiverRoom(e.toReceiver) : freeOf(e.to));
      if (amt <= 0) continue;
      if (e.to === -999) {
        moves.push({ from: i, to: null, toReceiver: null, amount: amt, color, side: e.side });
      } else if (e.toReceiver !== null) {
        receiverReserved[e.toReceiver] += amt;
        moves.push({ from: i, to: e.to, toReceiver: e.toReceiver, amount: amt, color, side: e.side });
      } else {
        reserved[e.to] += amt;
        moves.push({ from: i, to: e.to, toReceiver: null, amount: amt, color, side: e.side });
      }
    }
  }

  // E) Atomic apply.
  for (const m of moves) {
    if (m.from >= 0) {
      s.water[m.from] -= m.amount;
      if (s.water[m.from] <= 0) {
        s.water[m.from] = 0;
        s.waterColor[m.from] = null;
        s.cameFrom[m.from] = null;
      }
    } else if (m.from <= -1000) {
      // buffer release already deducted from stock
    } else {
      const si = -1 - m.from;
      s.sourceLeft[si] -= m.amount;
    }
    if (m.to === null) {
      s.lost += m.amount; // explicit leak sink (§5.1 п.3)
      if (s.leakCell === null && m.from >= 0) s.leakCell = m.from;
    } else if (m.toReceiver !== null) {
      const ri = m.toReceiver;
      const r = def.receivers[ri];
      const kind = r.kind ?? 'auto';
      s.receiverGot[ri] += m.amount;
      s.receivedTotal[ri] += m.amount;
      if (kind === 'overflow' && s.receiverGot[ri] > r.goal) {
        s.lost += s.receiverGot[ri] - r.goal; // open spillover
        s.receiverGot[ri] = r.goal;
      }
      if (kind === 'exact' && s.receiverGot[ri] > r.goal) {
        s.phase = 'FAILED'; // precise dosing violated
        s.errorCell = m.to;
        s.errorKind = 'overdose';
      }
    } else if (kindAt(s, m.to) === 'mixer') {
      const stock = s.mixerStock[m.to];
      const entry = stock.find((e) => e.color === m.color);
      if (entry) entry.count += m.amount;
      else stock.push({ color: m.color, count: m.amount });
    } else {
      if (s.water[m.to] === 0) s.waterColor[m.to] = m.color;
      s.water[m.to] += m.amount;
      if (m.side !== null) s.cameFrom[m.to] = OPPOSITE[m.side];
    }
  }

  s.tick += 1;
  if (s.phase === 'FAILED') return; // overdose set above

  // H) Terminal conditions (win latches on lifetime totals).
  const won = def.receivers.every((r, i) => s.receivedTotal[i] >= r.goal);
  if (won) {
    s.phase = 'WON';
    return;
  }
  const stable = moves.length === 0;
  const exhausted = s.sourceLeft.every((v) => v <= 0);
  const programPending = s.programCounter < s.program.length;
  if (stable && !programPending && (!def.dynamic || s.idleTicks >= DYNAMIC_IDLE_LIMIT)) {
    // Truly frozen: nothing moved and (static trial, exhausted dynamic, or
    // no program/valve action can follow). Deterministic termination.
    s.phase = 'FAILED';
    s.errorKind = colorConflict >= 0 ? 'conflict' : exhausted ? 'unreachable' : 'stalled';
    s.errorCell = colorConflict >= 0 ? colorConflict : s.leakCell;
    return;
  }
  if (stable) s.idleTicks += 1;
  else s.idleTicks = 0;
  if (s.tick >= MAX_TICKS) {
    s.phase = 'FAILED';
    s.errorKind = s.errorKind ?? 'timeout';
  }
}

/** Total volume invariant: sources + fed == left + pipes + mixer + receivers + lost. */
export function totalVolume(s: RuntimeState): { initial: number; accounted: number; ok: boolean } {
  const initial = s.def.sources.reduce((a, x) => a + x.portions, 0) + s.fedTotal;
  const pipes = s.water.reduce((a, v) => a + v, 0);
  const stock = s.mixerStock.reduce((a, arr) => a + arr.reduce((x, e) => x + e.count, 0), 0);
  const recv = s.receiverGot.reduce((a, v) => a + v, 0);
  const left = s.sourceLeft.reduce((a, v) => a + v, 0);
  const accounted = left + pipes + stock + recv + s.lost;
  return { initial, accounted, ok: initial === accounted };
}

export function applyCommand(s: RuntimeState, cmd: PlumberCommand): boolean {
  switch (cmd.type) {
    case 'rotate':
      return applyRotate(s, cmd.index);
    case 'toggleValve':
      return applyToggleValve(s, cmd.index);
    case 'pickup':
      return applyPickup(s, cmd.index);
    case 'place':
      return applyPlace(s, cmd.index);
    case 'placeStock':
      return applyPlaceStock(s, cmd.kind, cmd.index);
    case 'appendProgram':
      return applyAppendProgram(s, cmd.cmd);
    case 'removeProgram':
      return applyRemoveProgram(s, cmd.at);
    case 'moveProgram':
      return applyMoveProgram(s, cmd.from, cmd.to);
    case 'markHint':
      if (s.phase !== 'PREPARING') return false;
      s.hintsUsed += 1;
      s.log.push(cmd);
      return true;
    case 'start':
      if (s.phase !== 'PREPARING' && s.phase !== 'STOPPED') return false;
      if (s.programCounter === 0 && s.program.length === 0 && s.def.program) {
        s.program = s.def.program.map((c) => ({ ...c }));
      }
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
      // Assembly (rots, kinds, valves, program) preserved; trial resources reset (§4.3).
      const keep = snapshot(s);
      const fresh = createRuntime(s.def);
      fresh.rots = [...keep.rots];
      fresh.kinds = [...keep.kinds];
      fresh.liveConfig = keep.liveConfig.map((c) => (c ? { ...c } : null));
      fresh.valves = [...keep.valves];
      fresh.carried = keep.carried ? { ...keep.carried } : null;
      fresh.inventoryLeft = [...keep.inventoryLeft];
      fresh.program = keep.program.map((c) => ({ ...c }));
      fresh.log = [...s.log, cmd];
      restore(s, { ...snapshot(fresh), phase: 'PREPARING' });
      s.log = fresh.log;
      s.leakCell = null;
      s.errorCell = null;
      s.errorKind = null;
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
  const core = [
    s.rots.join(','),
    s.kinds.map((k) => k ?? '').join(','),
    s.water.join(','),
    (s.waterColor.join(',') + '|' + s.valves.map((v) => (v ? 1 : 0)).join('')),
    s.mixerStock.map((a) => a.map((e) => `${e.color}:${e.count}`).join('+')).join(';'),
    s.distCount.join(','),
    s.sourceLeft.join(','),
    s.sourceEnabled.map((v) => (v ? 1 : 0)).join(''),
    s.receiverGot.join(','),
    s.receivedTotal.join(','),
    s.fedTotal,
    s.carried?.kind ?? '',
    s.programCounter,
    s.lost,
    s.tick,
    s.phase,
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < core.length; i++) {
    h ^= core.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
