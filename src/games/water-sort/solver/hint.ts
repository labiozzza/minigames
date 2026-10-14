// Honest Hint Engine. Input is ONLY the public projection (unknown stays unknown).
// - Fully-known states: BFS proof -> {kind:'hint'}.
// - Otherwise: a legal revealing move -> {kind:'scout'} (explicitly NOT a guarantee).
// - No legal public move or no budget -> null (caller suggests undo/restart).
import { TUBE_CAPACITY } from '../domain/model';
import { UNKNOWN, hasUnknown, publicLegalMoves, type PublicState } from '../domain/mystery';
import { solveCompact } from './solver';

export type HintKind = 'hint' | 'scout';
export interface Hint {
  kind: HintKind;
  from: number;
  to: number;
}

export function suggestHint(pub: PublicState, solverBudget = 150000): Hint | null {
  const moves = publicLegalMoves(pub, TUBE_CAPACITY);
  if (moves.length === 0) return null;
  if (!hasUnknown(pub)) {
    // Map public colors to compact ints deterministically by first appearance.
    const ids = new Map<string, number>();
    const compact = pub.tubes.map((t) =>
      t.map((l) => {
        const c = l.color;
        if (c === UNKNOWN) return -1;
        if (!ids.has(c)) ids.set(c, ids.size);
        return ids.get(c) as number;
      }),
    );
    const sol = solveCompact(compact, { maxStates: solverBudget });
    if (!sol || sol.length === 0) return null;
    return { kind: 'hint', from: sol[0].from, to: sol[0].to };
  }
  // Scout: prefer a move that exposes a hidden layer underneath a known top group.
  for (const m of moves) {
    const src = pub.tubes[m.from];
    let i = src.length - 1;
    const topColor = src[i].color;
    while (i >= 0 && src[i].color === topColor) i--;
    const beneath = i >= 0 ? src[i] : null;
    if (beneath && beneath.color === UNKNOWN) return { kind: 'scout', from: m.from, to: m.to };
  }
  // Fallback scout: first legal move (deterministic order).
  return { kind: 'scout', from: moves[0].from, to: moves[0].to };
}
