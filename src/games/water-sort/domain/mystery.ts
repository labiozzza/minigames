// Information-limited public projection. The Hint Engine only ever sees this.
import type { ColorId, LayerId, Tube } from './model';

export const UNKNOWN = 'unknown' as const;
export type PublicColor = ColorId | typeof UNKNOWN;

export interface PublicLayer {
  id: LayerId;
  color: PublicColor;
}

export interface PublicState {
  tubes: PublicLayer[][];
}

export function toPublic(tubes: Tube[], known: Set<LayerId>): PublicState {
  return {
    tubes: tubes.map((t) =>
      t.layers.map((l) => ({ id: l.id, color: known.has(l.id) ? l.color : UNKNOWN })),
    ),
  };
}

export function hasUnknown(pub: PublicState): boolean {
  return pub.tubes.some((t) => t.some((l) => l.color === UNKNOWN));
}

/** Legal pours using only public information. Unknown tops block source and matching. */
export function publicLegalMoves(pub: PublicState, capacity: number): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const n = pub.tubes.length;
  const topOf = (i: number): PublicLayer | null => {
    const t = pub.tubes[i];
    return t.length ? t[t.length - 1] : null;
  };
  for (let from = 0; from < n; from++) {
    const s = topOf(from);
    if (!s || s.color === UNKNOWN) continue;
    for (let to = 0; to < n; to++) {
      if (to === from) continue;
      const dst = pub.tubes[to];
      if (dst.length >= capacity) continue;
      const d = topOf(to);
      if (d && d.color !== s.color) continue;
      out.push({ from, to });
    }
  }
  return out;
}
