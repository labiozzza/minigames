import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory idb stub so the versioned-save migration/rollback path is testable
// without a browser. Kept trivial on purpose: the module under test only needs
// get/set/del semantics.
const mem = new Map<string, string>();
vi.mock('../../src/platform/storage/idb', () => ({
  kvGet: async (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  kvSet: async (k: string, v: string) => { mem.set(k, v); },
  kvDel: async (k: string) => { mem.delete(k); },
}));

const {
  SAVE_KEY, BACKUP_KEY, SAVE_SCHEMA, emptySave, sanitizeSave, loadSave, readBackupSave, restoreBackupSave,
} = await import('../../src/platform/storage/save');

function v2Snapshot(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    settings: { theme: 'dark', lang: 'en' },
    games: {
      'water-sort': { maxLevel: 7, completed: [1, 2, 3, 4, 5, 6], active: null, tutorialBasic: true, tutorialMystery: true },
      plumber: {
        modes: {
          child: { maxLevel: 3, completed: [1, 2], active: null },
          normal: { maxLevel: 5, completed: [1, 2, 3, 4], active: null },
          expert: { maxLevel: 1, completed: [], active: null },
        },
        selected: 'normal',
        stars: { 'normal:1': 3, 'normal:2': 2 },
        collections: ['pipe-straight'],
        stats: { child: { attempts: 3, wins: 2, hints: 0, skips: 0 }, normal: { attempts: 1, wins: 0, hints: 0, skips: 0 }, expert: { attempts: 0, wins: 0, hints: 0, skips: 0 } },
        dailies: { '2026-10-01': 3 },
        fams: { '1': { family: 'path', mode: 'normal' } },
      },
    },
    lastPlayed: { gameId: 'plumber', levelNumber: 4 },
    updatedAt: 5,
  };
}

describe('§13 save versioning v2 -> v3 (additive, lossless)', () => {
  beforeEach(() => mem.clear());

  it('normalises without losing progress and keeps old Переливашки intact', () => {
    const back = sanitizeSave(v2Snapshot())!;
    expect(back.schemaVersion).toBe(SAVE_SCHEMA);
    const ws = back.games['water-sort'] as { maxLevel: number; tutorialMystery: boolean };
    expect(ws.maxLevel).toBe(7);
    expect(ws.tutorialMystery).toBe(true);
    const p = back.games['plumber'] as { modes: Record<string, { completed: number[] }>; weeklies: Record<string, number>; tutorial: string[]; selected: string };
    expect(p.modes.normal.completed).toEqual([1, 2, 3, 4]);
    expect(p.modes.child.completed).toEqual([1, 2]);
    expect(p.selected).toBe('normal');
    expect(p.weeklies).toEqual({});
    expect(p.tutorial).toEqual([]);
    // New accessibility/quality flags exist with defaults.
    expect(back.settings.contrast).toBe(false);
    expect(back.settings.quality).toBe('auto');
    expect(back.settings.lang).toBe('en');
  });

  it('is idempotent and never duplicates completed levels', () => {
    const once = sanitizeSave(v2Snapshot())!;
    const twice = sanitizeSave(JSON.parse(JSON.stringify(once)))!;
    expect(twice).toEqual(once);
    const p = twice.games['plumber'] as { modes: Record<string, { completed: number[] }> };
    for (const m of Object.values(p.modes)) expect(new Set(m.completed).size).toBe(m.completed.length);
  });

  it('rejects corrupted snapshots instead of guessing', () => {
    expect(sanitizeSave(null)).toBe(null);
    expect(sanitizeSave(42)).toBe(null);
    expect(sanitizeSave({ schemaVersion: 99 })).toBe(null);
    expect(sanitizeSave(JSON.parse('{"__proto__":{"evil":true},"schemaVersion":2}'))).toBe(null);
    expect(sanitizeSave(JSON.parse('{"schemaVersion":2,"games":{"plumber":{"__proto__":{}}}}'))).toBe(null);
  });

  it('keeps a pre-migration backup and can roll back to it', async () => {
    mem.set(SAVE_KEY, JSON.stringify(v2Snapshot()));
    const migrated = await loadSave();
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA);
    // A rollback copy of the exact pre-migration bytes exists.
    expect(mem.get(BACKUP_KEY)).toContain('"schemaVersion":2');
    const backup = await readBackupSave();
    expect(backup?.games['water-sort']).toMatchObject({ maxLevel: 7 });
    mem.set(SAVE_KEY, JSON.stringify({ ...v2Snapshot(), games: {} }));
    const rolledBack = await restoreBackupSave();
    expect(rolledBack).not.toBe(null);
    expect(JSON.parse(mem.get(SAVE_KEY) as string).schemaVersion).toBe(SAVE_SCHEMA);
    expect(JSON.parse(mem.get(SAVE_KEY) as string).games['water-sort'].maxLevel).toBe(7);
  });

  it('empty save is already current schema', () => {
    expect(emptySave().schemaVersion).toBe(SAVE_SCHEMA);
  });

  it('§14 pins configRevision on an active level and keeps it through reloads', async () => {
    const snap = v2Snapshot() as { games: Record<string, { modes?: Record<string, { active: unknown }> }> };
    snap.games.plumber.modes!.normal.active = {
      levelNumber: 2,
      puzzleId: 'plumber-normal-lvl-2',
      seed: 7,
      mode: 'normal',
      gridW: 1,
      gridH: 1,
      rots: [0],
      kinds: ['straight'],
      liveConfig: [null],
      water: [0],
      waterColor: [''],
      valves: [],
      mixerStock: [],
      distCount: [],
      sourceLeft: [],
      sourceEnabled: [],
      receiverGot: [],
      receivedTotal: [],
      fedTotal: 0,
      carried: null,
      cameFrom: [],
      inventoryLeft: [],
      program: [],
      programCounter: 0,
      lost: 0,
      tick: 0,
      idleTicks: 0,
      phase: 'PREPARING',
      playerRotations: 0,
      hintsUsed: 0,
      configRevision: 3,
      configChecksum: 'fnv1a-deadbeef',
      def: {
        cells: [{ kind: 'straight', rot: 0 }],
        sources: [],
        receivers: [],
        solutionWitness: [],
        puzzleId: 'plumber-normal-lvl-2',
        seed: 7,
        mode: 'normal',
        family: 'path',
        gridW: 1,
        gridH: 1,
      },
    };
    mem.set(SAVE_KEY, JSON.stringify(snap));
    const s1 = await loadSave();
    const active1 = (s1.games.plumber as { modes: Record<string, { active: { configRevision?: number; configChecksum?: string } | null }> }).modes.normal.active;
    expect(active1?.configRevision).toBe(3);
    expect(active1?.configChecksum).toBe('fnv1a-deadbeef');
    // Re-loading (migration is idempotent) must not drop the pin.
    const s2 = await loadSave();
    const active2 = (s2.games.plumber as { modes: Record<string, { active: { configRevision?: number } | null }> }).modes.normal.active;
    expect(active2?.configRevision).toBe(3);
  });
});
