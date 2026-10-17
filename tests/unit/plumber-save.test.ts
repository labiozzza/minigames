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

function fakeActive(levelNumber: number, mode: 'child' | 'normal' | 'expert' = 'child'): PlumberSessionSave {
  const def = generateLevel(`save-test-${mode}-${levelNumber}`, 1000 + levelNumber, { mode });
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

  it('export/import roundtrip preserves per-mode active session', () => {
    const s = emptySave();
    const slot = getPlumberSave(s);
    slot.modes.child.active = fakeActive(2, 'child');
    slot.modes.child.completed = [1];
    slot.modes.child.maxLevel = 3;
    slot.selected = 'child';
    const back = parseExport(buildExport(s));
    expect(back).not.toBe(null);
    const p = getPlumberSave(back!);
    expect(p.modes.child.completed).toEqual([1]);
    expect(p.modes.child.maxLevel).toBe(3);
    expect(p.modes.child.active?.levelNumber).toBe(2);
    expect(p.active?.levelNumber).toBe(2); // mirror of selected mode
  });

  it('merge unions per-mode progress and keeps current active', () => {
    const a = emptySave();
    getPlumberSave(a).modes.child.completed = [1, 2];
    getPlumberSave(a).modes.child.active = fakeActive(3, 'child');
    const b = emptySave();
    getPlumberSave(b).modes.child.completed = [2, 3];
    getPlumberSave(b).modes.child.active = fakeActive(5, 'child');
    const m = getPlumberSave(mergeSaves(a, b));
    expect(m.modes.child.completed).toEqual([1, 2, 3]);
    expect(m.modes.child.active?.levelNumber).toBe(3);
  });

  it('modes are independent: winning in one never changes another', () => {
    const s = emptySave();
    const p = getPlumberSave(s);
    p.modes.child.completed = [1, 2];
    p.modes.child.maxLevel = 3;
    p.modes.expert.completed = [1];
    p.modes.expert.maxLevel = 2;
    const raw = JSON.parse(JSON.stringify(s));
    const back = sanitizeSave(raw)!;
    const q = getPlumberSave(back);
    expect(q.modes.child.completed).toEqual([1, 2]);
    expect(q.modes.expert.completed).toEqual([1]);
    expect(q.modes.normal.completed).toEqual([]);
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

describe('v1 -> v2 mode migration (no progress loss)', () => {
  function v1Save(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      settings: {},
      games: {
        'water-sort': { maxLevel: 1, completed: [], active: null },
        plumber: {
          maxLevel: 13,
          completed: [1, 2, 3, 12, 13, 14],
          active: { ...fakeActive(5, 'normal') },
          tutorialSeen: true,
          stars: { 'normal:5': 3, 'expert:13': 2, 'child:1': 1 },
          collections: ['pipe-straight'],
          stats: { child: { attempts: 1, wins: 1, hints: 0, skips: 0 } },
          dailies: { '2026-10-01': 2 },
          fams: { '13': { family: 'valve', mode: 'expert' } },
        },
      },
      lastPlayed: { gameId: 'plumber', levelNumber: 6 },
      updatedAt: 1,
    };
  }

  it('distributes the single progression into 1-based per-mode progress', () => {
    const back = sanitizeSave(v1Save())!;
    const p = getPlumberSave(back);
    expect(p.modes.child.completed).toEqual([1, 2]);
    expect(p.modes.normal.completed).toEqual([1, 10]);
    expect(p.modes.expert.completed).toEqual([1, 2]);
    expect(p.modes.child.maxLevel).toBe(3);
    expect(p.modes.normal.maxLevel).toBe(11);
    expect(p.modes.expert.maxLevel).toBe(3);
  });

  it('renumbers stars and fams keys, preserves collections/stats/dailies', () => {
    const back = sanitizeSave(v1Save())!;
    const p = getPlumberSave(back);
    expect(p.stars['normal:3']).toBe(3); // was normal:5
    expect(p.stars['expert:1']).toBe(2); // was expert:13
    expect(p.stars['child:1']).toBe(1);
    expect(p.fams['1']).toMatchObject({ family: 'valve', mode: 'expert' });
    expect(p.collections).toContain('pipe-straight');
    expect(p.dailies['2026-10-01']).toBe(2);
    expect(p.stats.child.wins).toBe(1);
  });

  it('moves the active session into its mode and selects it', () => {
    const back = sanitizeSave(v1Save())!;
    const p = getPlumberSave(back);
    expect(p.selected).toBe('normal');
    expect(p.modes.normal.active?.levelNumber).toBe(3); // was 5, normal-local
    expect(p.active?.levelNumber).toBe(3);
  });

  it('is stable: migrating an already-v2 save is a no-op', () => {
    const once = sanitizeSave(v1Save())!;
    const twice = sanitizeSave(JSON.parse(JSON.stringify(once)))!;
    expect(twice).toEqual(once);
  });

  it('rejects unsupported future schema versions', () => {
    const raw = v1Save();
    raw.schemaVersion = 99;
    expect(sanitizeSave(raw)).toBe(null);
  });
});

describe('server snapshot merge with per-mode data', () => {
  it('unions modes and mirrors the selected one', async () => {
    const { mergeServerSnapshot } = await import('../../src/platform/storage/save');
    const s = emptySave();
    const p = getPlumberSave(s);
    p.modes.normal.completed = [1];
    p.selected = 'normal';
    mergeServerSnapshot(s, 'plumber', {
      modes: { normal: { maxLevel: 4, completed: [1, 2, 3] }, expert: { maxLevel: 2, completed: [1] } },
    });
    expect(p.modes.normal.completed).toEqual([1, 2, 3]);
    expect(p.modes.normal.maxLevel).toBe(4);
    expect(p.modes.expert.completed).toEqual([1]);
    expect(p.completed).toEqual([1, 2, 3]); // mirror of selected (normal)
  });
});
