import { describe, expect, it } from 'vitest';
import { applyCommand, createRuntime, type LevelDefinition } from '../../src/games/plumber/domain/model';
import { generateLevel } from '../../src/games/plumber/domain/generator';
import { diagnose } from '../../src/games/plumber/domain/solver';
import {
  DiagRecorder,
  DUMP_SCHEMA,
  batchDiagnose,
  importDump,
  replayDump,
  rejectToFixture,
  sanitizeDump,
  validateDump,
  type DiagDump,
} from '../../src/games/plumber/dev/session';
import { checkDraft, rotateCell, removeObject, setInventory } from '../../src/games/plumber/dev/editor';

function playSession(seed: number): DiagDump {
  const def: LevelDefinition = generateLevel('dev-fixture', seed, { mode: 'normal' });
  const rec = new DiagRecorder(def);
  const s = createRuntime(def);
  rec.sync(s);
  for (const c of def.solutionWitness) {
    applyCommand(s, c);
    rec.sync(s);
  }
  applyCommand(s, { type: 'start' });
  rec.sync(s);
  for (let i = 0; i < 400 && s.phase === 'RUNNING'; i += 1) applyCommand(s, { type: 'step' });
  rec.sync(s);
  return rec.toDump(s, { attempts: 1, hints: 0 }, null);
}

describe('§16 dev diagnostics: versioned dump + 1:1 replay', () => {
  it('records a real session and replays it to identical phases/checksums', () => {
    const dump = playSession(1234567);
    expect(dump.schema).toBe(DUMP_SCHEMA);
    expect(dump.entries.length).toBeGreaterThan(0);
    const res = replayDump(dump);
    expect(res.ok).toBe(true);
    expect(res.phase).toBe(dump.final.phase);
    expect(res.checksum).toBe(dump.final.checksum);
  });

  it('refuses a dump recorded under a different ruleset/generator version', () => {
    const dump = playSession(7654321);
    const stale = { ...dump, rulesetVersion: 'plumber-rules/1' };
    const res = replayDump(stale);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('ruleset-version-mismatch');
  });

  it('detects a tampered step (checksum mismatch) instead of silently passing', () => {
    const dump = playSession(2222222);
    const tampered: DiagDump = { ...dump, entries: dump.entries.map((e, i) => (i === 1 ? { ...e, checksum: 'deadbeef' } : e)) };
    const res = replayDump(tampered);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('checksum-mismatch');
    expect(res.mismatchAt).toBe(1);
  });

  it('strips PII-like keys and rejects malformed imports', () => {
    const dirty = sanitizeDump({ email: 'secret@x.y', token: 'abc', nested: { authorization: 'Bearer x', keep: 1 } });
    expect(dirty).toEqual({ nested: { keep: 1 } });
    expect(validateDump(null).ok).toBe(false);
    expect(validateDump({ schema: 'other' as typeof DUMP_SCHEMA }).ok).toBe(false);
    expect(importDump('{not json').ok).toBe(false);
    const dump = playSession(3333333);
    expect(importDump(JSON.stringify(dump)).ok).toBe(true);
  });
});

describe('§16 dev editor: certify gate + batch diagnostics', () => {
  it('forbids saving a draft that is not publicly valid', () => {
    const good = generateLevel('dev-editor', 424242, { mode: 'normal' });
    const goodCheck = checkDraft(good, diagnose);
    expect(goodCheck.ok).toBe(true);

    // Break the level: empty out a cell on the solution path -> no win.
    const pathCell = good.solutionWitness.find((c) => c.type === 'rotate');
    expect(pathCell).toBeDefined();
    const broken = removeObject(good, pathCell && 'index' in pathCell ? pathCell.index : 0);
    const brokenCheck = checkDraft(broken, diagnose);
    expect(brokenCheck.ok).toBe(false);
    expect(brokenCheck.reasons.length).toBeGreaterThan(0);
  });

  it('editor ops produce new defs without mutating the input', () => {
    const def = generateLevel('dev-editor2', 111, { mode: 'normal' });
    const before = JSON.stringify(def);
    const rotated = rotateCell(def, 0);
    const inv = setInventory(def, []);
    expect(JSON.stringify(def)).toBe(before);
    expect(rotated.cells[0].rot).not.toBe(def.cells[0].rot);
    expect(inv.inventory).toEqual([]);
  });

  it('batch diagnostics certifies good seeds and preserves rejections as fixtures', () => {
    const specs = Array.from({ length: 6 }, (_, i) => ({ puzzleId: `batch-${i}`, seed: (0x1234567 * (i + 1)) >>> 0, opts: { mode: 'normal' as const } }));
    const rep = batchDiagnose(specs, (id, seed, opts) => generateLevel(id, seed, opts));
    expect(rep.total).toBe(6);
    expect(rep.approved).toBeGreaterThan(0);
    expect(rep.schema).toBe('plumber-batch/1');
    for (const r of rep.rejected) {
      const fx = rejectToFixture(r);
      expect(fx.puzzleId).toBe(r.puzzleId);
      expect(fx.note).toContain('regression');
    }
  });
});
