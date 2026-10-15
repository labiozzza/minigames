import { describe, expect, it } from 'vitest';
import { findEmptyTarget, findFirstSource, findMatchingTarget, findScoutPour } from '../../src/games/water-sort/tutorial/logic';
import type { PublicState } from '../../src/games/water-sort/domain/mystery';

const K = (id: string, color: string) => ({ id, color });
const U = (id: string) => ({ id, color: 'unknown' as const });

describe('tutorial logic (public state only)', () => {
  it('finds a matching target before an empty one', () => {
    const pub: PublicState = {
      tubes: [
        [K('a0', 'r'), K('a1', 'g')],
        [K('b0', 'g')],
        [],
      ],
    };
    expect(findFirstSource(pub)).toBe(0);
    expect(findMatchingTarget(pub, 0)).toBe(1);
  });
  it('falls back to an empty tube when no match', () => {
    const pub: PublicState = {
      tubes: [[K('a0', 'r')], [K('b0', 'g')], []],
    };
    expect(findMatchingTarget(pub, 0)).toBe(2);
    expect(findEmptyTarget(pub, 0)).toBe(2);
    expect(findEmptyTarget(pub, 2)).toBe(null);
  });
  it('ignores unknown tops as sources', () => {
    const pub: PublicState = { tubes: [[U('h0')], [K('b0', 'g')], []] };
    expect(findFirstSource(pub)).toBe(1);
    expect(findMatchingTarget(pub, 0)).toBe(null);
  });
  it('scout pour exposes a hidden layer and is deterministic', () => {
    const pub: PublicState = {
      tubes: [
        [U('h0'), U('h1'), K('a2', 'r')],
        [K('b0', 'r')],
        [],
      ],
    };
    const s1 = findScoutPour(pub);
    const s2 = findScoutPour(JSON.parse(JSON.stringify(pub)) as PublicState);
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(null);
    // The chosen source really hides something under its top run.
    const src = pub.tubes[s1!.f];
    const c = src[src.length - 1].color;
    let i = src.length - 1;
    while (i >= 0 && src[i].color === c) i--;
    expect(src[i].color).toBe('unknown');
  });
  it('returns null when nothing can be taught', () => {
    const pub: PublicState = { tubes: [[U('h0')], [U('h1')], [], []] };
    expect(findFirstSource(pub)).toBe(null);
    expect(findScoutPour(pub)).toBe(null);
  });
});
