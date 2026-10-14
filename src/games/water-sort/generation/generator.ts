// Constructive deterministic generator with a verifiable solution certificate.
//
// Method ("reverse construction with splitting"):
//  1. Start from the solved state.
//  2. Repeatedly apply a REVERSE step: take k top units of color c from a tube
//     T and stack them onto another tube U, where either
//       (a) k is a strict partial run (T keeps color c on top), or
//       (b) the whole tube is taken (T becomes empty),
//     and U is empty or shows a different color on top (so the placed block
//     forms exactly the top run of U), with room for k units.
//  3. The certificate is the LIFO inversion: pour the k-block from U back to
//     T. Each inverted pour is provably legal under player rules and moves
//     exactly those k units (U's top run is exactly the block; T's top is c
//     or empty; T always has room since it held those units before).
//  4. The certificate is re-validated by independent simulation before publish.
//
// Tubes are indexed; indices are stable, so the certificate is a plain
// (from, to) pour list. No solver, no wall-clock, no Math.random anywhere:
// the same level is byte-identical on every device.
import {
  TUBE_CAPACITY,
  applyPourToTubes,
  isWin,
  type ColorId,
  type Layer,
  type LayerId,
  type Tube,
} from '../domain/model';
import {
  BALANCE_VERSION,
  GAME_ID,
  GENERATOR_VERSION,
  colorCountForLevel,
  hiddenCountForLevel,
  tubeCountForLevel,
} from '../config/balance';
import { mulberry32, seedFor } from './prng';

export interface CertMove {
  from: number;
  to: number;
}

export interface GeneratedPuzzle {
  levelNumber: number;
  seed: number;
  attempt: number;
  generatorVersion: string;
  balanceVersion: string;
  colors: ColorId[];
  tubes: Tube[];
  solution: CertMove[];
  hiddenLayerIds: LayerId[];
  checksum: string;
}

export class LevelGenerationError extends Error {}

function solvedTubes(level: number, colors: ColorId[], tubeCount: number): Tube[] {
  const tubes: Tube[] = [];
  for (let i = 0; i < colors.length; i++) {
    const layers: Layer[] = [];
    for (let k = 0; k < TUBE_CAPACITY; k++) layers.push({ id: `${level}:${colors[i]}:${k}`, color: colors[i] });
    tubes.push({ id: `t${i}`, layers });
  }
  for (let i = colors.length; i < tubeCount; i++) tubes.push({ id: `t${i}`, layers: [] });
  return tubes;
}

function stateHash(tubes: Tube[]): string {
  return tubes.map((t) => t.layers.map((l) => l.color).join(',')).join(';');
}

function topRunLen(tube: Tube): number {
  const n = tube.layers.length;
  if (n === 0) return 0;
  const c = tube.layers[n - 1].color;
  let len = 1;
  for (let i = n - 2; i >= 0 && tube.layers[i].color === c; i--) len++;
  return len;
}

function mixStepsForLevel(levelNumber: number, colorCount: number): number {
  const wave = Math.floor(8 * (0.5 + 0.5 * Math.sin(levelNumber * 0.35)));
  return 12 + colorCount * 3 + wave;
}

interface ReverseStep {
  fromT: number;
  toU: number;
  k: number;
}

function reverseCandidates(tubes: Tube[], prev: ReverseStep | null): ReverseStep[] {
  const out: ReverseStep[] = [];
  for (let t = 0; t < tubes.length; t++) {
    const src = tubes[t];
    if (src.layers.length === 0) continue;
    const runLen = topRunLen(src);
    const wholeTube = runLen === src.layers.length;
    // k choices: strict partial runs, or whole-tube removal.
    const ks: number[] = [];
    for (let k = 1; k < runLen; k++) ks.push(k);
    if (wholeTube) ks.push(runLen);
    if (ks.length === 0) continue;
    const srcTop = src.layers[src.layers.length - 1].color;
    for (let u = 0; u < tubes.length; u++) {
      if (u === t) continue;
      const dst = tubes[u];
      const free = TUBE_CAPACITY - dst.layers.length;
      if (free <= 0) continue;
      const dTop = dst.layers.length ? dst.layers[dst.layers.length - 1].color : null;
      if (dTop !== null && dTop === srcTop) continue;
      for (const k of ks) {
        if (k > free) continue;
        if (prev && prev.fromT === u && prev.toU === t && prev.k === k) continue;
        out.push({ fromT: t, toU: u, k });
      }
    }
  }
  return out;
}

export function normalizePuzzle(p: GeneratedPuzzle): string {
  return [
    p.levelNumber,
    p.generatorVersion,
    p.balanceVersion,
    p.colors.join(','),
    p.tubes.map((t) => t.layers.map((l) => `${l.id}=${l.color}`).join('|')).join(';'),
    p.solution.map((m) => `${m.from}>${m.to}`).join(','),
    p.hiddenLayerIds.slice().sort().join(','),
  ].join('#');
}

export function checksumOf(body: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < body.length; i++) {
    h1 = Math.imul(h1 ^ body.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 + body.charCodeAt(i), 0x811c9dc5);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function countComplete(tubes: Tube[]): number {
  let n = 0;
  for (const t of tubes) {
    if (t.layers.length === TUBE_CAPACITY && t.layers.every((l) => l.color === t.layers[0].color)) n++;
  }
  return n;
}

export function generatePuzzle(levelNumber: number): GeneratedPuzzle {
  if (!Number.isInteger(levelNumber) || levelNumber < 1) throw new LevelGenerationError(`bad level ${levelNumber}`);
  const seed = seedFor(GAME_ID, levelNumber, GENERATOR_VERSION, BALANCE_VERSION);
  const rng = mulberry32(seed);
  const colorCount = colorCountForLevel(levelNumber);
  const tubeCount = tubeCountForLevel(levelNumber);
  const colors: ColorId[] = Array.from({ length: colorCount }, (_, i) => `c${i}`);
  const tubes = solvedTubes(levelNumber, colors, tubeCount);
  const steps = mixStepsForLevel(levelNumber, colorCount);

  const forwardSolution: CertMove[] = [];
  const seen = new Set<string>([stateHash(tubes)]);
  let prev: ReverseStep | null = null;
  for (let s = 0; s < steps; s++) {
    const options = reverseCandidates(tubes, prev);
    if (options.length === 0) break;
    // Prefer options that keep the walk in unseen states.
    const fresh: ReverseStep[] = [];
    const stale: ReverseStep[] = [];
    for (const o of options) {
      const src = tubes[o.fromT];
      const moved = src.layers.slice(src.layers.length - o.k);
      const before = tubes[o.toU].layers.length;
      for (const l of moved) tubes[o.toU].layers.push(l);
      src.layers.length -= o.k;
      const h = stateHash(tubes);
      src.layers.push(...moved);
      tubes[o.toU].layers.length = before;
      (seen.has(h) ? stale : fresh).push(o);
    }
    const pool = fresh.length > 0 ? fresh : options;
    const pick = pool[Math.floor(rng() * pool.length)];
    const moved = tubes[pick.fromT].layers.splice(tubes[pick.fromT].layers.length - pick.k, pick.k);
    for (const l of moved) tubes[pick.toU].layers.push(l);
    seen.add(stateHash(tubes));
    // Forward solution pours the block back: from U to T.
    forwardSolution.push({ from: pick.toU, to: pick.fromT });
    prev = pick;
  }

  if (isWin(tubes)) throw new LevelGenerationError(`degenerate solved start at level ${levelNumber}`);
  if (countComplete(tubes) > Math.max(2, Math.floor(colorCount / 2))) {
    throw new LevelGenerationError(`under-mixed start at level ${levelNumber}`);
  }

  // Independent validation with player-rule pours.
  const sim = tubes.map((t) => ({ id: t.id, layers: t.layers.slice() }));
  const solution: CertMove[] = forwardSolution.slice().reverse();
  for (const m of solution) {
    if (!applyPourToTubes(sim, m.from, m.to)) {
      throw new LevelGenerationError(`certificate invalid at level ${levelNumber}`);
    }
  }
  if (!isWin(sim)) throw new LevelGenerationError(`certificate does not win level ${levelNumber}`);

  // Hidden layers: deterministic shuffle of non-top layers; tops stay visible.
  const tops = new Set<LayerId>();
  for (const t of tubes) {
    const top = t.layers[t.layers.length - 1];
    if (top) tops.add(top.id);
  }
  const candidates: LayerId[] = [];
  for (const t of tubes) for (const l of t.layers) if (!tops.has(l.id)) candidates.push(l.id);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const totalUnits = colors.length * TUBE_CAPACITY;
  const hiddenCount = hiddenCountForLevel(levelNumber, totalUnits, candidates.length);
  const hiddenLayerIds = candidates.slice(0, hiddenCount);

  const partial: GeneratedPuzzle = {
    levelNumber,
    seed,
    attempt: 0,
    generatorVersion: GENERATOR_VERSION,
    balanceVersion: BALANCE_VERSION,
    colors,
    tubes,
    solution,
    hiddenLayerIds,
    checksum: '',
  };
  partial.checksum = checksumOf(normalizePuzzle(partial));
  return partial;
}
