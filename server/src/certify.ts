// §14 real preview + certification on the server. Publish is only allowed when
// the chosen seed batch all pass: generator output replays to WON through the
// official model, volume is conserved, and a scrambled start cannot win without
// the certified witness. This replaces the old "client validates seeds" note.
import { certifySolvable, generateLevel, winsWithoutWitness } from '../../src/games/plumber/domain/generator';
import { applyCommand, createRuntime, runToEnd, totalVolume } from '../../src/games/plumber/domain/model';
import type { PlumberConfig } from './config-schema';

export interface SeedResult {
  seed: number;
  puzzleId: string;
  ok: boolean;
  family: string;
  gridW: number;
  gridH: number;
  par: number;
  certLevel: 'certified' | 'rejected';
  reason?: string;
}

export interface CertifyReport {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  results: SeedResult[];
}

/** Deterministically derive a preview config for a single seed from the config. */
export function certifySeed(gameId: string, config: PlumberConfig, seed: number, index: number): SeedResult {
  const mode = config.challenges.modes[index % config.challenges.modes.length];
  const puzzleId = `${gameId}-cfg-${config.generator.seedSalt}#${seed}`;
  const family = config.generator.families[index % config.generator.families.length];
  const def = generateLevel(puzzleId, seed >>> 0, { mode, family, gridW: 6, gridH: 6 });
  const fail = (reason: string): SeedResult => ({
    seed,
    puzzleId,
    ok: false,
    family: def.family,
    gridW: def.gridW,
    gridH: def.gridH,
    par: def.par ?? 0,
    certLevel: 'rejected',
    reason,
  });
  if (!certifySolvable(def)) return fail('not-solvable');
  if (winsWithoutWitness(def)) return fail('trivial-win');
  const s = createRuntime(def);
  if (!totalVolume(s).ok) return fail('volume-drift');
  for (const c of def.solutionWitness) if (!applyCommand(s, c)) return fail(`witness-rejected:${c.type}`);
  if (!applyCommand(s, { type: 'start' })) return fail('start-rejected');
  if (runToEnd(s) !== 'WON') return fail('no-win');
  if (!totalVolume(s).ok) return fail('volume-drift-after');
  return { seed, puzzleId, ok: true, family: def.family, gridW: def.gridW, gridH: def.gridH, par: def.par ?? 0, certLevel: 'certified' };
}

export function certifySeeds(gameId: string, config: PlumberConfig, seeds: number[]): CertifyReport {
  const results = seeds.map((seed, i) => certifySeed(gameId, config, seed, i));
  const passed = results.filter((r) => r.ok).length;
  return { ok: passed === results.length && results.length > 0, total: results.length, passed, failed: results.length - passed, results };
}

/** Seeds used when the admin does not pick any (deterministic, reproducible). */
export function defaultSeeds(count = 8): number[] {
  return Array.from({ length: count }, (_, i) => 1000 + i * 97);
}
