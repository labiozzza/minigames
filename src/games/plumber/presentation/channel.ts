// Internal water channel geometry per pipe kind, in normalized tile space
// [0..1]x[0..1], matching the port layout in domain/model BASE_PORTS.
// Rotations rotate the geometry about the tile center exactly like rotSide(),
// so the liquid path always coincides with the visible ports.
import type { PipeKind } from '../domain/model';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface Point { x: number; y: number }
export interface Segment { a: Point; b: Point }

// Base (rot=0) port midpoints per side.
const PORT_MID: Record<Side, Point> = {
  top: { x: 0.5, y: 0 },
  right: { x: 1, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
};
const CENTER: Point = { x: 0.5, y: 0.5 };

// rot=0 arms per kind as side lists (matches BASE_PORTS).
const BASE_ARMS: Partial<Record<PipeKind, Side[]>> = {
  straight: ['top', 'bottom'],
  elbow: ['top', 'right'],
  t: ['top', 'right', 'left'],
  cross: ['top', 'right', 'bottom', 'left'],
  cap: ['top'],
  valve: ['top', 'bottom'],
  filter: ['top', 'bottom'],
  mixer: ['top', 'right', 'bottom', 'left'],
  distributor: ['top', 'right', 'left'],
  source: ['right'],
  receiver: ['left'],
};

/** Clockwise rotation of a normalized point about (0.5,0.5), `rot` quarter turns. */
function rotate(p: Point, rot: number): Point {
  let { x, y } = p;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    const nx = 1 - y;
    const ny = x;
    x = nx;
    y = ny;
  }
  return { x, y };
}

export interface ChannelGeometry {
  /** Channel centerline segments (normalized), already rotated. */
  segments: Segment[];
  /** Half-width of the liquid band, normalized to the tile. */
  halfWidth: number;
  /** Port anchors (edge midpoints actually open), normalized. */
  ports: Array<{ side: Side; p: Point }>;
  /** Source/receiver are tanks, not channels — filled as a reservoir. */
  tank: boolean;
}

const HALF_WIDTH = 0.11;

const SIDE_ORDER: Side[] = ['top', 'right', 'bottom', 'left'];
function rotateSide(side: Side, rot: number): Side {
  const i = SIDE_ORDER.indexOf(side);
  return SIDE_ORDER[(((i + rot) % 4) + 4) % 4];
}

export function portMid(side: Side): Point {
  return { ...PORT_MID[side] };
}

/** Rotated open ports for a kind (valve closed => none). */
export function openPorts(kind: PipeKind, rot: number, valveOpen = true): Array<{ side: Side; p: Point }> {
  if (kind === 'valve' && !valveOpen) return [];
  const arms = BASE_ARMS[kind] ?? [];
  return arms.map((side) => ({ side: rotateSide(side, rot), p: rotate(PORT_MID[side], rot) }));
}

export function channelGeometry(kind: PipeKind, rot: number, valveOpen = true): ChannelGeometry {
  const ports = openPorts(kind, rot, valveOpen);
  const tank = kind === 'source' || kind === 'receiver';
  const segments: Segment[] = [];
  const c = rotate(CENTER, rot);
  for (const { p } of ports) {
    segments.push({ a: c, b: p });
  }
  return { segments, halfWidth: HALF_WIDTH, ports, tank };
}

/**
 * Order + partially fill the channel from the inlet side.
 * Returns a draw list: full segments plus, for the last one, a fraction of it.
 * `inlet` is the side water arrived from (or null → pick the longest arm).
 */
export interface FilledSegment { a: Point; b: Point }
export function fillFrom(
  geo: ChannelGeometry,
  inlet: Side | null,
  progress: number,
): FilledSegment[] {
  const frac = Math.max(0, Math.min(1, progress));
  if (geo.segments.length === 0) return [];
  // Determine the start point (near the inlet port).
  const start: Point = inlet ? (geo.ports.find((p) => p.side === inlet)?.p ?? geo.segments[0].b) : geo.segments[0].b;
  // For each segment, the far endpoint is the one farther from start.
  const ordered = geo.segments
    .map((s) => {
      const da = dist(s.a, start);
      const db = dist(s.b, start);
      const nearIsA = da <= db;
      return { near: nearIsA ? s.a : s.b, far: nearIsA ? s.b : s.a, farDist: Math.max(da, db) };
    })
    .sort((x, y) => x.farDist - y.farDist);
  const lens = ordered.map((o) => dist(o.near, o.far));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let budget = total * frac;
  const out: FilledSegment[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const { near, far } = ordered[i];
    const len = lens[i];
    const take = Math.min(len, budget);
    budget -= take;
    if (take <= 0.0001) continue;
    const t = take / len;
    out.push({ a: near, b: { x: near.x + (far.x - near.x) * t, y: near.y + (far.y - near.y) * t } });
    if (budget <= 0) break;
  }
  return out;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
