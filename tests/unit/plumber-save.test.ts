import { describe, expect, it } from 'vitest';
import {
  buildExport,
  emptySave,
  getPlumberSave,
  mergeSaves,
  parseExport,
  sanitizeSave,
  type PlumberSessionSave,
} from '../../src/platform/storage/save';
import { generateLevel } from '../../src/games/plumber/domain/generator';
import { applyCommand, createRuntime, snapshot } from '../../src/games/plumber/domain/model';

function fakeActive(levelNumber: number): PlumberSessionSave {
  const def = generateLevel(`save-test-${levelNumber}`, 1000 + levelNumber, { mode: 'child' });
  const s = createRuntime(def);
  applyCommand(s, { type: 'start' });
  const snap = snapshot(s);
  return {
    levelNumber,
    puzzleId: def.puzzleId,
    seed: def.seed,
    mode: def.mode,
    gridW: def.gridW,
    gridH: def.gridH,
    ...snap,
    def: {
      cells: def.cells.map((c) => ({ kind: c.kind, rot: c.rot })),
      sources: def.sources.map((x) => ({ ...x })),
      receivers: def.receivers.map((x) => ({ ...x })),
      solutionWitness: def.solutionWitness.map((c) => ({ ...(c as object) }) as { type: string; index?: number }),
      puzzleId: def.puzzleId,
      seed: def.seed,
      mode: def.mode,
      family: def.family,
      gridW: def.gridW,
      gridH: def.gridH,
    },
    updatedAt: Date.now(),
  };
}

describe('plumber saves', () => {
  it('empty save contains a plumber slot without breaking water-sort', () => {
    const s = emptySave();
    expect(s.games['plumber']).toBeDefined();
    expect(getPlumberSave(s).maxLevel).toBe(1);
    expect(s.games['water-sort']).toBeDefined();
  });
  it('export/import roundtrip preserves plumber active session', () => {
    const s = emptySave();
    getPlumberSave(s).active = fakeActive(2);
    getPlumberSave(s).completed = [1];
    const back = parseExport(buildExport(s));
    expect(back).not.toBe(null);
    const slot = getPlumberSave(back!);
    expect(slot.completed).toEqual([1]);
    expect(slot.active?.levelNumber).toBe(2);
    expect(slot.active?.rots.length).toBe(slot.active!.gridW * slot.active!.gridH);
  });
  it('merge unions plumber progress and keeps current active', () => {
    const a = emptySave();
    getPlumberSave(a).completed = [1, 2];
    getPlumberSave(a).active = fakeActive(3);
    const b = emptySave();
    getPlumberSave(b).completed = [2, 3];
    getPlumberSave(b).active = fakeActive(5);
    const m = mergeSaves(a, b);
    expect(getPlumberSave(m).completed).toEqual([1, 2, 3]);
    expect(getPlumberSave(m).active?.levelNumber).toBe(3);
  });
  it('sanitize rejects corrupt plumber def but keeps water-sort', () => {
    const s = emptySave();
    s.games['water-sort']!.maxLevel = 4;
    const raw = JSON.parse(JSON.stringify(s));
    raw.games['plumber'] = { maxLevel: 2, completed: [1], active: { levelNumber: 1, rots: [0], def: { cells: [{ kind: 'nope', rot: 0 }] } }, tutorialSeen: false };
    const back = sanitizeSave(raw);
    expect(back).not.toBe(null);
    expect(getPlumberSave(back!).active).toBe(null);
    expect((back!.games['water-sort'] as { maxLevel: number }).maxLevel).toBe(4);
  });
});
