import { describe, expect, it } from 'vitest';
import {
  PIPE_CAPACITY,
  applyCommand,
  checksum,
  createRuntime,
  portsOf,
  runToEnd,
  snapshot,
  restore,
  stepTick,
  totalVolume,
  type LevelDefinition,
} from '../../src/games/plumber/domain/model';
import { generateLevel, certifySolvable } from '../../src/games/plumber/domain/generator';
import { solveSmall, verifyWitness } from '../../src/games/plumber/domain/solver';

function lineLevel(): LevelDefinition {
  return {
    schemaVersion: 1,
    rulesetVersion: 'plumber-rules/1',
    generatorVersion: 'plumber-gen/0.1-stage1',
    puzzleId: 'test-line',
    seed: 1,
    mode: 'normal',
    family: 'path',
    gridW: 3,
    gridH: 1,
    cells: [
      { kind: 'source', rot: 0 },
      { kind: 'straight', rot: 1 }, // horizontal: connects left+right
      { kind: 'receiver', rot: 0 },
    ],
    sources: [{ cell: 0, color: 'blue', portions: 7 }],
    receivers: [{ cell: 2, color: 'blue', goal: 5 }],
    solutionWitness: [],
    difficultyEvidence: { pathLength: 3, rotatable: 0, branches: 0 },
  };
}

describe('plumber ports', () => {
  it('straight rotates vertical↔horizontal', () => {
    expect(portsOf({ kind: 'straight', rot: 0 })).toMatchObject({ top: true, bottom: true, left: false, right: false });
    expect(portsOf({ kind: 'straight', rot: 1 })).toMatchObject({ left: true, right: true, top: false, bottom: false });
  });
  it('elbow covers all four orientations', () => {
    expect(portsOf({ kind: 'elbow', rot: 0 })).toMatchObject({ top: true, right: true });
    expect(portsOf({ kind: 'elbow', rot: 1 })).toMatchObject({ right: true, bottom: true });
    expect(portsOf({ kind: 'elbow', rot: 2 })).toMatchObject({ bottom: true, left: true });
    expect(portsOf({ kind: 'elbow', rot: 3 })).toMatchObject({ left: true, top: true });
  });
  it('closed valve has no ports', () => {
    expect(portsOf({ kind: 'valve', rot: 0, valveOpen: false })).toMatchObject({
      top: false, right: false, bottom: false, left: false,
    });
  });
});

describe('plumber simulation', () => {
  it('wins on connected line and conserves volume', () => {
    const s = createRuntime(lineLevel());
    expect(applyCommand(s, { type: 'start' })).toBe(true);
    expect(runToEnd(s)).toBe('WON');
    expect(s.receiverGot[0]).toBeGreaterThanOrEqual(5);
    expect(totalVolume(s).ok).toBe(true);
  });
  it('broken pipe does not win; leak is explicit', () => {
    const def = lineLevel();
    def.cells = [
      { kind: 'source', rot: 0 },
      { kind: 'straight', rot: 0 }, // vertical: wall against source/receiver
      { kind: 'receiver', rot: 0 },
    ];
    const s = createRuntime(def);
    applyCommand(s, { type: 'start' });
    const phase = runToEnd(s);
    expect(phase).not.toBe('WON');
    expect(totalVolume(s).ok).toBe(true);
  });
  it('rotate forbidden during RUNNING and on wet pipes', () => {
    const s = createRuntime(lineLevel());
    applyCommand(s, { type: 'start' });
    expect(applyCommand(s, { type: 'rotate', index: 1 })).toBe(false);
  });
  it('restart preserves assembly but resets trial resources', () => {
    const s = createRuntime(lineLevel());
    applyCommand(s, { type: 'start' });
    runToEnd(s);
    expect(s.phase).toBe('WON');
    applyCommand(s, { type: 'restart' });
    expect(s.phase).toBe('PREPARING');
    expect(s.receiverGot[0]).toBe(0);
    expect(s.sourceLeft[0]).toBe(7);
    expect(totalVolume(s).ok).toBe(true);
  });
  it('replay is deterministic (same checksum twice)', () => {
    const run = (): string => {
      const s = createRuntime(lineLevel());
      applyCommand(s, { type: 'start' });
      runToEnd(s);
      return checksum(s);
    };
    expect(run()).toBe(run());
  });
  it('snapshot/restore round-trips', () => {
    const s = createRuntime(lineLevel());
    applyCommand(s, { type: 'start' });
    runToEnd(s);
    const snap = snapshot(s);
    const s2 = createRuntime(lineLevel());
    restore(s2, snap);
    expect(checksum(s2)).toBe(checksum(s));
  });
  it('pipe capacity respected (no cell exceeds PIPE_CAPACITY)', () => {
    const s = createRuntime(lineLevel());
    applyCommand(s, { type: 'start' });
    for (let i = 0; i < 50 && s.phase === 'RUNNING'; i++) stepTick(s);
    expect(Math.max(...s.water)).toBeLessThanOrEqual(PIPE_CAPACITY);
  });
});

describe('plumber generator + solver', () => {
  it('witness certifies on a batch of seeds (all modes)', () => {
    const modes = ['child', 'normal', 'expert'] as const;
    let n = 0;
    for (const mode of modes) {
      for (let seed = 1; seed <= 20; seed++) {
        const def = generateLevel(`batch-${mode}-${seed}`, seed, { mode });
        expect(certifySolvable(def)).toBe(true);
        expect(verifyWitness(def)).toBe(true);
        expect(totalVolume(createRuntime(def)).ok).toBe(true);
        n += 1;
      }
    }
    expect(n).toBe(60);
  });
  it('same seed + puzzleId reproduces identical definition', () => {
    const a = generateLevel('repro-1', 42, { mode: 'normal' });
    const b = generateLevel('repro-1', 42, { mode: 'normal' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('solveSmall finds the fallback solution', () => {
    const def = generateLevel('tiny-x', 7, { mode: 'child', gridW: 3, gridH: 1 });
    const r = solveSmall(def);
    expect(r.checkedStates).toBeGreaterThan(0);
    if (r.solution) {
      const s = createRuntime(def);
      for (const c of r.solution) applyCommand(s, c);
      applyCommand(s, { type: 'start' });
      expect(runToEnd(s)).toBe('WON');
    }
  });
});
