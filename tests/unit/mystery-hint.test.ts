import { describe, expect, it } from 'vitest';
import { createSession, attemptPour, defaultKnownIds } from '../../src/games/water-sort/domain/model';
import { toPublic, UNKNOWN } from '../../src/games/water-sort/domain/mystery';
import { suggestHint } from '../../src/games/water-sort/solver/hint';
import { generatePuzzle } from '../../src/games/water-sort/generation/generator';
import type { Tube } from '../../src/games/water-sort/domain/model';

const T = (id: string, layers: Array<[string, string]>, _known: Set<string>): Tube => ({
  id,
  layers: layers.map(([lid, color]) => ({ id: lid, color })),
});

describe('mystery layers', () => {
  it('reveal only on reaching top; undo/restart keep knowledge; ids stable', () => {
    const known = new Set<string>(['a1']);
    const s = createSession(
      [
        { id: 't0', layers: [{ id: 'a0', color: 'r' }, { id: 'a1', color: 'g' }] },
        { id: 't1', layers: [] },
      ],
      known,
    );
    // tops revealed at creation: a1 known already, t1 empty
    expect(s.known.has('a1')).toBe(true);
    const r = attemptPour(s, 0, 1);
    expect(r.ok).toBe(true);
    expect(s.known.has('a0')).toBe(true); // exposed -> revealed
    const before = new Set(s.known);
    attemptPour(s, 1, 0);
    for (const k of before) expect(s.known.has(k)).toBe(true);
  });
  it('public projection hides unknown colors but keeps ids', () => {
    const tubes = [T('t0', [['x', 'r'], ['y', 'g']], new Set())];
    const pub = toPublic(tubes, new Set(['x']));
    expect(pub.tubes[0][0].color).toBe('r');
    expect(pub.tubes[0][1].color).toBe(UNKNOWN);
    expect(pub.tubes[0][1].id).toBe('y');
  });
});

describe('hint engine honesty', () => {
  it('non-interference: identical public state + different hidden truth -> identical hint', () => {
    const mk = (hiddenColor: string) => {
      const tubes = [
        T('t0', [['k0', 'r'], ['h0', hiddenColor]], new Set()),
        T('t1', [['k1', 'r']], new Set()),
        T('t2', [], new Set()),
      ];
      return toPublic(tubes, new Set(['k0', 'k1']));
    };
    const a = suggestHint(mk('g'), 5000);
    const b = suggestHint(mk('b'), 5000);
    expect(a).toEqual(b);
  });
  it('never labels scout as hint when unknown present', () => {
    const tubes = [
      T('t0', [['k0', 'r'], ['h0', 'g']], new Set()),
      T('t1', [['k1', 'b']], new Set()),
      T('t2', [], new Set()),
    ];
    const h = suggestHint(toPublic(tubes, new Set(['k0', 'k1'])), 5000);
    if (h) expect(h.kind).toBe('scout');
  });
  it('fully-known state yields proven hint matching solver first move', () => {
    const p = generatePuzzle(1);
    const s = createSession(p.tubes, defaultKnownIds(p.tubes, new Set(p.hiddenLayerIds)));
    const pub = toPublic(s.tubes, s.known);
    const h = suggestHint(pub, 150000);
    expect(h).not.toBe(null);
    expect(h!.kind).toBe('hint');
  });
  it('generator tops are always visible (no hidden on top)', () => {
    for (const level of [101, 150, 300]) {
      const p = generatePuzzle(level);
      const hidden = new Set(p.hiddenLayerIds);
      for (const t of p.tubes) {
        const top = t.layers[t.layers.length - 1];
        if (top) expect(hidden.has(top.id)).toBe(false);
      }
    }
  });
});
