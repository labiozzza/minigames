// Pure tutorial logic: which tube/button to highlight next, from public state only.
// Fully unit-testable; no Phaser, DOM or hidden truth here.
import { TUBE_CAPACITY } from '../domain/model';
import { UNKNOWN, publicLegalMoves, type PublicState } from '../domain/mystery';

function topOf(pub: PublicState, i: number): { color: string; run: number } | null {
  const t = pub.tubes[i];
  if (t.length === 0) return null;
  const color = t[t.length - 1].color;
  if (color === UNKNOWN) return null;
  let run = 1;
  for (let k = t.length - 2; k >= 0 && t[k].color === color; k--) run++;
  return { color, run };
}

/** First tube with a known pourable top, preferring one that has a matching target. */
export function findFirstSource(pub: PublicState): number | null {
  const n = pub.tubes.length;
  let fallback: number | null = null;
  for (let f = 0; f < n; f++) {
    const s = topOf(pub, f);
    if (!s) continue;
    if (fallback === null) fallback = f;
    if (findMatchingTarget(pub, f) !== null) return f;
  }
  if (fallback !== null) return fallback;
  for (let f = 0; f < n; f++) {
    if (findEmptyTarget(pub, f) !== null && topOf(pub, f)) return f;
  }
  return null;
}

/** Prefer a non-empty target with the same known top color, else an empty tube. */
export function findMatchingTarget(pub: PublicState, from: number): number | null {
  const s = topOf(pub, from);
  if (!s) return null;
  const n = pub.tubes.length;
  for (let to = 0; to < n; to++) {
    if (to === from) continue;
    const t = pub.tubes[to];
    if (t.length === 0 || t.length >= TUBE_CAPACITY) continue;
    const d = topOf(pub, to);
    if (d && d.color === s.color) return to;
  }
  return findEmptyTarget(pub, from);
}

export function findEmptyTarget(pub: PublicState, from: number): number | null {
  for (let to = 0; to < pub.tubes.length; to++) {
    if (to !== from && pub.tubes[to].length === 0) return to;
  }
  return null;
}

/** A legal public move whose source hides an 'unknown' layer right under the top run. */
export function findScoutPour(pub: PublicState): { f: number; t: number } | null {
  for (const m of publicLegalMoves(pub, TUBE_CAPACITY)) {
    const src = pub.tubes[m.from];
    const c = src[src.length - 1].color;
    let i = src.length - 1;
    while (i >= 0 && src[i].color === c) i--;
    if (i >= 0 && src[i].color === UNKNOWN) return { f: m.from, t: m.to };
  }
  return null;
}
