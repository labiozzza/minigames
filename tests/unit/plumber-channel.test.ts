import { describe, it, expect } from 'vitest';
import { portsOf, type CellDef, type PipeKind } from '../../src/games/plumber/domain/model';
import { channelGeometry, openPorts, fillFrom } from '../../src/games/plumber/presentation/channel';

const KINDS: PipeKind[] = ['straight', 'elbow', 't', 'cross', 'cap', 'valve', 'filter', 'mixer', 'distributor', 'source', 'receiver'];
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

describe('channel geometry matches model ports', () => {
  for (const kind of KINDS) {
    for (let rot = 0; rot < 4; rot++) {
      it(`${kind} rot=${rot}: open ports coincide with channel ports`, () => {
        const modelPorts = portsOf({ kind, rot } as CellDef, rot);
        const geo = channelGeometry(kind, rot, true);
        const modelOpen = SIDES.filter((s) => modelPorts[s]).sort();
        const geoOpen = geo.ports.map((p) => p.side).sort();
        expect(geoOpen).toEqual(modelOpen);
        // Every port anchor sits on the corresponding tile edge midpoint.
        for (const { side, p } of geo.ports) {
          const onEdge =
            (side === 'top' && Math.abs(p.y) < 1e-6) ||
            (side === 'bottom' && Math.abs(p.y - 1) < 1e-6) ||
            (side === 'left' && Math.abs(p.x) < 1e-6) ||
            (side === 'right' && Math.abs(p.x - 1) < 1e-6);
          expect(onEdge).toBe(true);
          const mid = side === 'top' || side === 'bottom' ? p.x : p.y;
          expect(Math.abs(mid - 0.5)).toBeLessThan(1e-6);
        }
      });
    }
  }

  it('straight is vertical at rot=0 and horizontal at rot=1', () => {
    const v = channelGeometry('straight', 0, true).segments;
    expect(v.every((s) => Math.abs(s.a.x - s.b.x) < 1e-6)).toBe(true);
    const h = channelGeometry('straight', 1, true).segments;
    expect(h.every((s) => Math.abs(s.a.y - s.b.y) < 1e-6)).toBe(true);
  });

  it('closed valve has no channel', () => {
    expect(openPorts('valve', 0, false)).toEqual([]);
    expect(channelGeometry('valve', 0, false).segments).toEqual([]);
  });

  it('fill advances monotonically along the channel from the inlet', () => {
    const geo = channelGeometry('elbow', 0, true); // inlet top -> corner -> right
    const tenth = fillFrom(geo, 'top', 0.1);
    const full = fillFrom(geo, 'top', 1);
    const len = (segs: { a: { x: number; y: number }; b: { x: number; y: number } }[]) =>
      segs.reduce((t, s) => t + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0);
    expect(len(tenth)).toBeLessThan(len(full));
    expect(len(full)).toBeGreaterThan(0.99);
  });

  it('zero progress draws nothing', () => {
    expect(fillFrom(channelGeometry('cross', 0, true), 'left', 0)).toEqual([]);
  });
});
