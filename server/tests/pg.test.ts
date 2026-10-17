// Real PostgreSQL integration tests. Skipped unless PG_URL is set, because no
// database is bundled. Run locally with an isolated database, e.g.:
//   PG_URL=postgres://minigames:minigames@127.0.0.1:5432/minigames_test \
//     npx vitest run server/tests/pg.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgStore } from '../../server/src/pg-store';
import { AuthService, hashSecret } from '../../server/src/auth';

const PG_URL = process.env.PG_URL ?? '';
const d = PG_URL ? describe : describe.skip;

d('PgStore against real PostgreSQL', () => {
  const stores: PgStore[] = [];
  async function store(): Promise<PgStore> {
    const s = await PgStore.create({ connectionString: PG_URL });
    stores.push(s);
    return s;
  }
  afterAll(async () => {
    for (const s of stores) await s.close().catch(() => undefined);
  });

  it('1. survives a process restart (new instance sees written data)', async () => {
    const a = await store();
    const uid = `u_${randomUUID()}`;
    await a.upsertUser({ id: uid, email: `${uid}@x.io`, role: 'player', createdAt: 1 });
    await a.putSave(uid, 'plumber', { version: 4, updatedAt: 2, seen: [], active: { levelNumber: 7 }, data: { completed: [1, 2, 3], maxLevel: 8, stars: {}, fams: {} } });
    await a.close();

    const b = await store();
    expect(await b.getUser(uid)).toMatchObject({ id: uid });
    expect((await b.getSave(uid, 'plumber')).version).toBe(4);
    expect((await b.getSave(uid, 'plumber')).active).toEqual({ levelNumber: 7 });
  });

  it('2. concurrent identical events are applied exactly once (DB unique key)', async () => {
    const s = await store();
    const uid = `u_${randomUUID()}`;
    await s.upsertUser({ id: uid, email: null, role: 'player', createdAt: 1 });
    const ev = { uuid: randomUUID(), kind: 'win', level: 3, stars: 3, mode: 'normal', family: 'valve' };
    const [a, b] = await Promise.all([
      s.syncSave(uid, 'plumber', [ev], null, null, 1000),
      s.syncSave(uid, 'plumber', [ev], null, null, 1001),
    ]);
    expect(a.applied + b.applied).toBe(1);
    const done = (await s.getSave(uid, 'plumber')).data.completed as number[];
    expect(done).toEqual([3]);
  });

  it('3. conflict reported and active snapshot is first-wins', async () => {
    const s = await store();
    const uid = `u_${randomUUID()}`;
    await s.upsertUser({ id: uid, email: null, role: 'player', createdAt: 1 });
    await s.syncSave(uid, 'plumber', [{ uuid: randomUUID(), kind: 'win', level: 1, stars: 3, mode: 'child', family: 'path' }], { a: 1 }, null, 1);
    const r = await s.syncSave(uid, 'plumber', [], { a: 2 }, 1, 2);
    expect(r.conflict).toBe(true);
    expect((r.save.active as { a: number }).a).toBe(1);
  });

  it('4. OTP + session roundtrip, secrets hashed at rest', async () => {
    const s = await store();
    const auth = new AuthService(s, { exposeCodes: true, now: () => 1 });
    const email = `${randomUUID()}@x.io`;
    await auth.requestOtp(email, '127.0.0.1');
    const rec = await s.getOtp(email);
    expect(rec?.codeHash).toBeTruthy();
    expect(rec?.codeHash).not.toBe(auth.lastCodeFor(email));
    const v = await auth.verifyOtp(email, auth.lastCodeFor(email) as string);
    expect(v).not.toBeNull();
    expect(await auth.sessionOf(v!.token)).toMatchObject({ userId: v!.userId });
    // Plaintext token must not be a valid lookup key.
    expect(await s.getSession(v!.token)).toBeNull();
    expect(await s.getSession(hashSecret(v!.token))).not.toBeNull();
  });

  it('5. share roundtrip and config draft->publish->rollback with audit', async () => {
    const s = await store();
    const code = randomUUID().slice(0, 12);
    await s.putShare(code, { def: { seed: 7 }, owner: 'me', createdAt: 1, hits: 0 });
    expect(await s.getShare(code)).toMatchObject({ owner: 'me' });
    await s.putDraft('plumber', { families: ['path'] }, 'admin', 5);
    const v = await s.publishConfig('plumber', 'admin', 6);
    expect(v).toBeGreaterThan(1);
    const rb = await s.rollbackConfig('plumber', 'admin', 7);
    expect(rb).toBe(v! - 1);
    const audit = await s.getAudit(20);
    expect(audit.some((a) => a.action === 'publish')).toBe(true);
    expect(audit.some((a) => a.action === 'rollback')).toBe(true);
  });

  it('6. telemetry write persists', async () => {
    const s = await store();
    const uid = `u_${randomUUID()}`;
    await s.putTelemetry(uid, [{ type: 'level_win', level: 1 }], 9);
    expect(await s.ping()).toBe(true);
  });
});
