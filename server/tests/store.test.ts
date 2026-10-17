// R1 regression: FileStore must survive process restart for EVERY collection,
// quarantine corrupt files instead of wiping them, and write atomically.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../../server/src/store';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'mg-store-'));
}

describe('FileStore persistence across restart', () => {
  it('keeps user + session (the original defect)', async () => {
    const dir = tmp();
    const a = new FileStore(dir);
    await a.upsertUser({ id: 'u1', email: 'a@b.c', role: 'player', createdAt: 1 });
    await a.putSession({ tokenHash: 't1', userId: 'u1', role: 'player', expiresAt: 9e12 });

    const b = new FileStore(dir);
    expect(await b.getUser('u1')).toMatchObject({ id: 'u1', email: 'a@b.c' });
    expect(await b.findUserByEmail('a@b.c')).toMatchObject({ id: 'u1' });
    expect(await b.getSession('t1')).toMatchObject({ userId: 'u1' });
  });

  it('keeps otp + otp request log + guest link', async () => {
    const dir = tmp();
    const a = new FileStore(dir);
    await a.putOtp('x@y.z', { codeHash: '123456', expiresAt: 5, attempts: 2 });
    await a.pushOtpRequest('x@y.z', 111);
    await a.upsertUser({ id: 'u2', email: null, role: 'player', createdAt: 1 });
    await a.linkGuest('u2', 'guest-9');

    const b = new FileStore(dir);
    expect(await b.getOtp('x@y.z')).toMatchObject({ codeHash: '123456', attempts: 2 });
    expect(await b.otpRequests('x@y.z')).toEqual([111]);
    expect((await b.getUser('u2') as { guestIds?: string[] }).guestIds).toContain('guest-9');
  });

  it('keeps save, share, draft, published config, history and audit', async () => {
    const dir = tmp();
    const a = new FileStore(dir);
    await a.putSave('u3', 'plumber', { version: 3, updatedAt: 1, seen: ['e1'], active: { levelNumber: 5 }, data: { completed: [1, 2], maxLevel: 6, stars: { 'normal:1': 3 }, fams: {} } });
    await a.putShare('CODE1', { def: { seed: 42 }, owner: 'u3', createdAt: 1, hits: 0 });
    await a.putDraft('plumber', { families: ['path'] }, 'admin1', 7);
    await a.publishConfig('plumber', 'admin1', 8);
    await a.rollbackConfig('plumber', 'admin1', 9);

    const b = new FileStore(dir);
    const save = await b.getSave('u3', 'plumber');
    expect(save.version).toBe(3);
    expect(save.active).toEqual({ levelNumber: 5 });
    expect(save.data.completed).toEqual([1, 2]);
    expect(await b.getShare('CODE1')).toMatchObject({ owner: 'u3' });
    const audit = await b.getAudit(50);
    const actions = audit.map((x) => x.action);
    expect(actions).toContain('publish');
    expect(actions).toContain('rollback');
  });

  it('keeps telemetry array', async () => {
    const dir = tmp();
    const a = new FileStore(dir);
    await a.putTelemetry('u4', [{ type: 'win' }], 12);
    const b = new FileStore(dir);
    // No public getter; assert indirectly via a second write not throwing and file size.
    await b.putTelemetry('u4', [{ type: 'fail' }], 13);
    const dump = JSON.parse(readFileSync(join(dir, 'minigames-server.json'), 'utf8')) as { telemetry: unknown[] };
    expect(dump.telemetry).toHaveLength(2);
  });
});

describe('FileStore durability guarantees', () => {
  it('quarantines a corrupt file instead of silently wiping it', async () => {
    const dir = tmp();
    const file = join(dir, 'minigames-server.json');
    writeFileSync(file, '{ this is not json');
    const s = new FileStore(dir);
    expect(s.lastLoadError).not.toBeNull();
    // Corrupt file preserved under a quarantine name.
    const quarantined = readdirSync(dir).filter((f) => f.includes('corrupt'));
    expect(quarantined.length).toBe(1);
    // Store still usable.
    await s.upsertUser({ id: 'u9', email: null, role: 'player', createdAt: 1 });
    expect(await s.getUser('u9')).toMatchObject({ id: 'u9' });
  });

  it('writes via temp+rename (no leftover temp files, valid JSON on disk)', async () => {
    const dir = tmp();
    const s = new FileStore(dir);
    await s.upsertUser({ id: 'u5', email: null, role: 'player', createdAt: 1 });
    const files = readdirSync(dir);
    expect(files).toEqual(['minigames-server.json']);
    expect(() => JSON.parse(readFileSync(join(dir, 'minigames-server.json'), 'utf8'))).not.toThrow();
  });
});
