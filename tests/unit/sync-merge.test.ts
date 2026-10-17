import { describe, it, expect } from 'vitest';
import { emptySave, mergeServerSnapshot, recordConflict, sanitizeSave, mergeSaves, buildExport, parseExport } from '../../src/platform/storage/save';

describe('mergeServerSnapshot (monotonic, no double-count)', () => {
  it('unions wins, takes best stars, unions collections/dailies', () => {
    const save = emptySave();
    const g = save.games['plumber'] as import('../../src/platform/storage/save').PlumberSave;
    g.completed = [1, 2];
    g.maxLevel = 3;
    g.stars = { 'normal:1': 2 };
    g.collections = ['pipe-straight'];
    g.dailies = { '2026-10-01': 1 };
    mergeServerSnapshot(save, 'plumber', {
      completed: [2, 3, 4],
      maxLevel: 5,
      stars: { 'normal:1': 3, 'normal:3': 1 },
      collections: ['pipe-elbow'],
      dailies: { '2026-10-01': 3, '2026-10-02': 2 },
    });
    expect(g.completed).toEqual([1, 2, 3, 4]);
    expect(g.maxLevel).toBe(5);
    expect(g.stars['normal:1']).toBe(3);
    expect(g.stars['normal:3']).toBe(1);
    expect(g.collections.sort()).toEqual(['pipe-elbow', 'pipe-straight']);
    expect(g.dailies['2026-10-01']).toBe(3);
    expect(g.dailies['2026-10-02']).toBe(2);
  });

  it('stats merge by max (counters only grow; server dedups by uuid)', () => {
    const save = emptySave();
    const g = save.games['plumber'] as import('../../src/platform/storage/save').PlumberSave;
    g.stats.normal.hints = 4;
    mergeServerSnapshot(save, 'plumber', { stats: { normal: { hints: 2, wins: 1 }, expert: { wins: 3 } } });
    expect(g.stats.normal.hints).toBe(4);
    expect(g.stats.normal.wins).toBe(1);
    expect(g.stats.expert.wins).toBe(3);
  });

  it('never touches the local active session', () => {
    const save = emptySave();
    const g = save.games['plumber'] as import('../../src/platform/storage/save').PlumberSave;
    const active = { levelNumber: 7, marker: 'local' } as unknown as import('../../src/platform/storage/save').PlumberSessionSave;
    g.active = active;
    mergeServerSnapshot(save, 'plumber', { completed: [7], active: { marker: 'remote' } });
    expect((g.active as { marker?: string } | null)?.marker).toBe('local');
  });

  it('merge is idempotent (applying twice equals once)', () => {
    const s1 = emptySave();
    mergeServerSnapshot(s1, 'water-sort', { completed: [1, 2], maxLevel: 3 });
    mergeServerSnapshot(s1, 'water-sort', { completed: [1, 2], maxLevel: 3 });
    const ws = s1.games['water-sort'] as import('../../src/platform/storage/save').WaterSortSave;
    expect(ws.completed).toEqual([1, 2]);
    expect(ws.maxLevel).toBe(3);
  });
});

describe('conflict snapshots survive sanitize + export/import', () => {
  it('keeps both actives and round-trips through export', () => {
    const save = emptySave();
    recordConflict(save, 'plumber', { v: 'local' }, { v: 'remote' });
    const text = buildExport(save);
    const parsed = parseExport(text);
    expect(parsed?.conflicts?.plumber.local).toEqual({ v: 'local' });
    expect(parsed?.conflicts?.plumber.remote).toEqual({ v: 'remote' });
  });
  it('sanitize drops malformed conflict entries', () => {
    const raw = { schemaVersion: 1, games: {}, conflicts: { '../evil': { local: 1 }, plumber: { local: 1, remote: 2, at: 5 } } };
    const s = sanitizeSave(raw);
    expect(s?.conflicts?.['../evil']).toBeUndefined();
    expect(s?.conflicts?.plumber.remote).toBe(2);
  });
});

describe('mergeSaves keeps Water Sort working and unifies plumber extras', () => {
  it('unions completed and max, keeps local active', () => {
    const a = emptySave();
    const b = emptySave();
    (a.games['water-sort'] as import('../../src/platform/storage/save').WaterSortSave).completed = [1];
    (a.games['water-sort'] as import('../../src/platform/storage/save').WaterSortSave).maxLevel = 2;
    (b.games['water-sort'] as import('../../src/platform/storage/save').WaterSortSave).completed = [2, 3];
    (b.games['water-sort'] as import('../../src/platform/storage/save').WaterSortSave).maxLevel = 4;
    const m = mergeSaves(a, b);
    const ws = m.games['water-sort'] as import('../../src/platform/storage/save').WaterSortSave;
    expect(ws.completed).toEqual([1, 2, 3]);
    expect(ws.maxLevel).toBe(4);
  });
});
