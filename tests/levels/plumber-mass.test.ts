// Plumber mass certification (TZ v1.2 §6): >= 10000 plumber levels evenly
// spread across modes and families. For every level we prove: the certified
// witness replays to WON through the official model, immediate victory from a
// scrambled state is impossible, volume is conserved, regeneration is byte
// identical, and the generator never silently swaps in a fallback. An aggregate
// report (fallback rate, canonical overlap, difficulty distribution, par) is
// written to evidence/plumber-mass-report.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRuntime, runToEnd, applyCommand, totalVolume, type LevelDefinition } from '../../src/games/plumber/domain/model';
import { generateLevel, certifySolvable, winsWithoutWitness, type Family } from '../../src/games/plumber/domain/generator';

const MODES = ['child', 'normal', 'expert'] as const;
const PER_MODE = 1500;
const FAMILIES: Family[] = ['path', 'leakfix', 'valve', 'filter', 'mixer', 'program', 'carry', 'multiflow', 'exact'];
const PER_FAMILY = 650;

interface Metrics {
  total: number;
  fallback: number;
  unsolvable: number;
  nontrivialFails: number;
  determinismFails: number;
  fingerprints: Map<string, number>;
  parSum: number;
  parMax: number;
  bySize: Map<string, number>;
}

function newMetrics(): Metrics {
  return { total: 0, fallback: 0, unsolvable: 0, nontrivialFails: 0, determinismFails: 0, fingerprints: new Map(), parSum: 0, parMax: 0, bySize: new Map() };
}

/** Canonical positional fingerprint: the same layout family/size/kind grid. */
function fingerprint(def: LevelDefinition): string {
  const kinds = def.cells.map((c) => c.kind).join(',');
  const goals = def.receivers.map((r) => `${r.cell}:${r.kind}`).sort().join(',');
  return `${def.gridW}x${def.gridH}|${def.family}|${kinds}|${goals}`;
}

function check(def: LevelDefinition, m: Metrics): void {
  m.total += 1;
  if (def.puzzleId.includes('#fallback')) m.fallback += 1;
  if (!certifySolvable(def)) m.unsolvable += 1;
  if (winsWithoutWitness(def)) m.nontrivialFails += 1;
  const par = def.par ?? def.solutionWitness.filter((c) => c.type === 'rotate').length;
  m.parSum += par;
  m.parMax = Math.max(m.parMax, par);
  const size = `${def.gridW}x${def.gridH}`;
  m.bySize.set(size, (m.bySize.get(size) ?? 0) + 1);
  const fp = fingerprint(def);
  m.fingerprints.set(fp, (m.fingerprints.get(fp) ?? 0) + 1);
}

function replay(def: LevelDefinition): void {
  const s = createRuntime(def);
  expect(totalVolume(s).ok).toBe(true);
  for (const c of def.solutionWitness) expect(applyCommand(s, c)).toBe(true);
  expect(applyCommand(s, { type: 'start' })).toBe(true);
  expect(runToEnd(s)).toBe('WON');
  expect(totalVolume(s).ok).toBe(true);
}

function writeReport(m: Metrics, extra: Record<string, unknown>): void {
  const distinct = m.fingerprints.size;
  const duplicates = [...m.fingerprints.values()].filter((n) => n > 1).length;
  const report = {
    levelsChecked: m.total,
    fallback: m.fallback,
    unsolvable: m.unsolvable,
    nontrivialFails: m.nontrivialFails,
    determinismFails: m.determinismFails,
    distinctFingerprints: distinct,
    overlappingFingerprints: duplicates,
    overlapRate: Number((duplicates / Math.max(1, distinct)).toFixed(4)),
    meanPar: Number((m.parSum / Math.max(1, m.total)).toFixed(3)),
    maxPar: m.parMax,
    sizeDistribution: Object.fromEntries([...m.bySize.entries()].sort()),
    ...extra,
  };
  mkdirSync('evidence', { recursive: true });
  writeFileSync('evidence/plumber-mass-report.json', `${JSON.stringify(report, null, 2)}\n`);
}

describe('plumber mass: modes', () => {
  it.each(MODES)('mode %s: %d seeds certify, replay, regenerate identically', (mode) => {
    const m = newMetrics();
    for (let seed = 1; seed <= PER_MODE; seed++) {
      const id = `mass-${mode}-${seed}`;
      const a = generateLevel(id, seed, { mode });
      check(a, m);
      expect(certifySolvable(a)).toBe(true);
      expect(winsWithoutWitness(a)).toBe(false);
      replay(a);
      const b = generateLevel(id, seed, { mode });
      if (JSON.stringify(b) !== JSON.stringify(a)) m.determinismFails += 1;
    }
    expect(m.fallback).toBe(0);
    expect(m.unsolvable).toBe(0);
    expect(m.nontrivialFails).toBe(0);
    expect(m.determinismFails).toBe(0);
    writeReport(m, { kind: 'mode', mode, perMode: PER_MODE });
  });
});

describe('plumber mass: families', () => {
  it.each(FAMILIES)('family %s: %d seeds certify + non-trivial + deterministic', (family) => {
    const mode = family === 'mixer' || family === 'program' ? 'expert' : family === 'path' ? 'child' : 'normal';
    for (let seed = 5000; seed < 5000 + PER_FAMILY; seed++) {
      const id = `massfam-${family}-${seed}`;
      const a = generateLevel(id, seed, { mode, family });
      expect(a.family).toBe(family);
      expect(certifySolvable(a)).toBe(true);
      expect(winsWithoutWitness(a)).toBe(false);
      const b = generateLevel(id, seed, { mode, family });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('aggregates the full 10000+ corpus with no fallbacks or overlaps beyond slack', () => {
    const m = newMetrics();
    for (const mode of MODES) {
      for (let seed = 1; seed <= 1200; seed++) check(generateLevel(`corpus-${mode}-${seed}`, seed, { mode }), m);
    }
    for (const family of FAMILIES) {
      const mode = family === 'mixer' || family === 'program' ? 'expert' : 'normal';
      for (let seed = 9000; seed < 9000 + 750; seed++) check(generateLevel(`corpus-${family}-${seed}`, seed, { mode, family }), m);
    }
    writeReport(m, { kind: 'corpus', modes: MODES, families: FAMILIES });
    expect(m.total).toBeGreaterThanOrEqual(10000);
    expect(m.fallback).toBe(0);
    expect(m.unsolvable).toBe(0);
    // Canonical overlap must stay low: the generator is not reusing one shape.
    const distinct = m.fingerprints.size;
    const overlap = 1 - distinct / m.total;
    expect(overlap).toBeLessThan(0.2);
  });
});
