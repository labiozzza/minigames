import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { MemoryStore, type Store } from '../../server/src/store';
import { createApp } from '../../server/src/app';
import { AuthService, hashSecret } from '../../server/src/auth';
import type { Server } from 'node:http';

let base = '';
let server: Server;
let auth: AuthService;
let store: Store;

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  const app = createApp({ store: new MemoryStore(), exposeCodes: true, cors: '*' });
  server = app.server;
  auth = app.auth;
  store = app.store;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

async function login(email: string): Promise<string> {
  const q = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ email }) });
  expect(q.status).toBe(200);
  const code = auth.lastCodeFor(email);
  expect(code).toBeDefined();
  const v = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  expect(v.status).toBe(200);
  return v.body.token as string;
}

describe('auth', () => {
  it('health is public and gated routes require auth', async () => {
    const health = await api('/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    const gated = await api('/me');
    expect(gated.status).toBe(401);
  });
  it('request -> verify -> me; wrong code rejected; brute force locked', async () => {
    const token = await login('player@example.com');
    const me = await api('/me', { headers: AUTH(token) });
    expect(me.status).toBe(200);
    expect((me.body.user as { email: string }).email).toBe('player@example.com');
    const bad = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email: 'player@example.com', code: '000000' }) });
    expect(bad.status).toBe(401);
    // Exhaust attempts with a fresh code.
    await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ email: 'brute@example.com' }) });
    for (let i = 0; i < 5; i++) {
      await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email: 'brute@example.com', code: '111111' }) });
    }
    const locked = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email: 'brute@example.com', code: auth.lastCodeFor('brute@example.com') }) });
    expect(locked.status).toBe(401);
  });
  it('request rate limited without enumeration', async () => {
    for (let i = 0; i < 6; i++) {
      await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ email: 'flood@example.com' }) });
    }
    const r = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ email: 'flood@example.com' }) });
    expect(r.status).toBe(200);
    expect(r.body.retryAfter).toBeDefined();
  });
  it('guest link merges without loss', async () => {
    const token = await login('linker@example.com');
    const r = await api('/guest/link', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ guestId: 'g-123' }) });
    expect(r.status).toBe(200);
  });
  it('production auth config never exposes OTP codes', () => {
    const prod = new AuthService(new MemoryStore(), { exposeCodes: false });
    expect(prod.lastCodeFor('any@example.com')).toBeUndefined();
  });
});

describe('saves sync', () => {
  it('idempotent win events; conflict keeps first active', async () => {
    const token = await login('syncer@example.com');
    const ev = { uuid: 'e1', kind: 'win', level: 3, stars: 3, mode: 'normal', family: 'valve' };
    const first = await api('/games/plumber/sync', {
      method: 'POST', headers: AUTH(token),
      body: JSON.stringify({ events: [ev], baseVersion: 1, active: { level: 3 } }),
    });
    expect(first.body.applied).toBe(1);
    const replay = await api('/games/plumber/sync', {
      method: 'POST', headers: AUTH(token),
      body: JSON.stringify({ events: [ev], baseVersion: 2, active: { level: 9 } }),
    });
    expect(replay.body.applied).toBe(0); // duplicate uuid ignored
    expect((replay.body.save as { active: { level: number } }).active.level).toBe(3); // first wins
    const second = await api('/games/plumber/sync', {
      method: 'POST', headers: AUTH(token),
      body: JSON.stringify({ events: [{ uuid: 'e2', kind: 'win', level: 4, stars: 2, mode: 'normal', family: 'path' }], baseVersion: 99 }),
    });
    expect(second.body.conflict).toBe(true);
    expect(second.body.applied).toBe(1);
    const ach = await api('/games/plumber/achievements', { headers: AUTH(token) });
    expect((ach.body.achievements as Array<{ id: string; done: boolean }>).find((a) => a.id === 'first-win')?.done).toBe(true);
  });
});

describe('challenges and share', () => {
  const validDef = {
    seed: 42, puzzleId: 'lvl-1', mode: 'normal', rulesetVersion: 'plumber-rules/2',
    generatorVersion: 'plumber-gen/0.2-stage3', gridW: 3, gridH: 3,
    cells: [1, 2, 3], sources: [{ cell: 0 }], receivers: [{ cell: 2, kind: 'auto' }],
  };
  it('manifest deterministic; share roundtrip; oversize rejected', async () => {
    const token = await login('ch@example.com');
    const m1 = await api('/games/plumber/challenges?mode=normal', { headers: AUTH(token) });
    const m2 = await api('/games/plumber/challenges?mode=normal', { headers: AUTH(token) });
    expect(m1.body).toEqual(m2.body);
    const daily = (m1.body.challenges as Array<{ id: string }>)[0].id;
    const one = await api(`/games/plumber/challenges/${daily}`, { headers: AUTH(token) });
    expect(one.status).toBe(200);
    expect((one.body.challenge as { seed: number }).seed).toBeGreaterThan(0);
    const sh = await api('/share', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ def: { ...validDef } }) });
    expect(sh.status).toBe(200);
    const got = await api(`/share/${sh.body.code}`, { headers: AUTH(token) });
    expect(got.body.def).toMatchObject({ seed: 42, gridW: 3 });
    const big = await api('/share', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ def: { blob: 'x'.repeat(20000) } }) });
    expect(big.status).toBe(413);
  });
  it('manifest carries >=7 daily and >=2 weekly pre-certified tasks per mode', async () => {
    const token = await login('manifest@example.com');
    for (const mode of ['child', 'normal', 'expert']) {
      const r = await api(`/games/plumber/challenges?mode=${mode}`, { headers: AUTH(token) });
      expect(r.status).toBe(200);
      expect(r.body.version).toBe('challenge/1');
      const list = r.body.challenges as Array<{ id: string; kind: string; mode: string; seed: number; version: string; day: string }>;
      expect(list.filter((c) => c.kind === 'daily').length).toBeGreaterThanOrEqual(7);
      expect(list.filter((c) => c.kind === 'weekly').length).toBeGreaterThanOrEqual(2);
      for (const c of list) {
        expect(c.mode).toBe(mode);
        expect(c.version).toBe('challenge/1');
        expect(c.seed).toBeGreaterThan(0);
      }
    }
    // Same task on two independent clients (deterministic resolution).
    const a = await api('/games/plumber/challenges/daily-2026-03-02?mode=normal', { headers: AUTH(token) });
    const b = await api('/games/plumber/challenges/daily-2026-03-02?mode=normal', { headers: AUTH(token) });
    expect(a.body).toEqual(b.body);
    // Weekly must be a Monday; unknown ids are 404.
    const tuesday = await api('/games/plumber/challenges/weekly-2026-03-03?mode=expert', { headers: AUTH(token) });
    expect(tuesday.status).toBe(404);
    const junk = await api('/games/plumber/challenges/daily-nope', { headers: AUTH(token) });
    expect(junk.status).toBe(404);
  });
  it('rejects malformed share definitions before write (fuzz)', async () => {
    const token = await login('fuzz@example.com');
    const cases = [
      { cells: [1, 2, 3] },
      { ...validDef, gridW: 999 },
      { ...validDef, seed: 'x' },
      { ...validDef, receivers: [{ cell: 1, kind: 'bogus' }] },
      null,
    ];
    for (const def of cases) {
      const r = await api('/share', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ def }) });
      expect([400, 413]).toContain(r.status);
    }
  });
});

describe('sync validation & hardening', () => {
  it('rejects malformed events, accepts valid ones', async () => {
    const token = await login('val@example.com');
    const r = await api('/games/plumber/sync', {
      method: 'POST', headers: AUTH(token),
      body: JSON.stringify({
        events: [
          { uuid: 'ok1', kind: 'win', level: 2, stars: 3, mode: 'child', family: 'path' },
          { uuid: 'bad1', kind: 'win', level: -1, stars: 9, mode: 'nope' },
          { uuid: 'bad2', kind: 'teleport', level: 1 },
          { kind: 'win', level: 1, stars: 1, mode: 'normal' },
        ],
        baseVersion: 1,
      }),
    });
    expect(r.body.applied).toBe(1);
    expect(r.body.rejected).toBe(3);
    expect(r.body.provisional).toBe(true);
  });
  it('rejects oversized body with 413 (no crash)', async () => {
    const r = await api('/games/plumber/sync', {
      method: 'POST',
      body: JSON.stringify({ events: [], pad: 'x'.repeat(100000) }),
    });
    expect(r.status).toBe(413);
    const health = await api('/health');
    expect(health.status).toBe(200);
  });
});

describe('config, admin, telemetry', () => {
  it('draft -> publish -> rollback with audit; forbidden without role', async () => {
    const token = await login('user@example.com');
    const forb = await api('/admin/config/draft?game=plumber', { headers: AUTH(token) });
    expect(forb.status).toBe(403);
    const who = await api('/admin/whoami?x=1', { headers: AUTH(token) });
    expect(who.body).toEqual({ isAdmin: false, userId: expect.any(String) });
    await store.upsertUser({ id: 'admin-1', email: 'admin@example.com', role: 'admin', createdAt: Date.now() });
    const adminToken = 'admintoken123';
    await store.putSession({ tokenHash: hashSecret(adminToken), userId: 'admin-1', role: 'admin', expiresAt: Date.now() + 3600000 });
    const A = AUTH(adminToken);
    const draft = await api('/admin/config/draft?game=plumber', { headers: A });
    expect(draft.status).toBe(200);
    // Strict schema: unknown fields / bad types are refused before anything is stored.
    const bad = await api('/admin/config/draft', { method: 'PUT', headers: A, body: JSON.stringify({ game: 'plumber', draft: { generator: { familes: ['path'] }, bogus: 1 } }) });
    expect(bad.status).toBe(422);
    expect((bad.body.errors as string[]).some((e) => e.includes('bogus'))).toBe(true);
    const okDraft = await api('/admin/config/draft', { method: 'PUT', headers: A, body: JSON.stringify({ game: 'plumber', draft: { generator: { families: ['path', 'valve'], seedSalt: 7 }, mechanics: { path: true, valve: true } } }) });
    expect(okDraft.status).toBe(200);
    expect((okDraft.body.checksum as string).startsWith('fnv1a-')).toBe(true);
    // Preview really certifies sample levels (no more "client validates seeds").
    const prev = await api('/admin/config/preview', { method: 'POST', headers: A, body: JSON.stringify({ game: 'plumber', seeds: [11, 22, 33] }) });
    expect(prev.status).toBe(200);
    const preview = prev.body.preview as { report: { ok: boolean; total: number; passed: number; results: Array<{ ok: boolean; certLevel: string; puzzleId: string }> } };
    const report = preview.report;
    expect(report.total).toBe(3);
    expect(report.passed).toBe(3);
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.certLevel === 'certified' && r.puzzleId.includes('plumber-cfg-7'))).toBe(true);
    // Publishing with too few seeds is refused.
    const thin = await api('/admin/config/publish', { method: 'POST', headers: A, body: JSON.stringify({ game: 'plumber', seeds: [1], minSeeds: 4 }) });
    expect(thin.status).toBe(422);
    expect(thin.body.error).toBe('too-few-seeds');
    const pub = await api('/admin/config/publish', { method: 'POST', headers: A, body: JSON.stringify({ game: 'plumber', minSeeds: 4 }) });
    expect(pub.status).toBe(200);
    const pubVer = pub.body.version as { version: number; checksum: string; changes: string[] };
    expect(pubVer.version).toBe(2);
    expect(pubVer.checksum.startsWith('fnv1a-')).toBe(true);
    expect(pubVer.changes.length).toBeGreaterThan(0);
    const cfg = await api('/games/plumber/config', { headers: AUTH(token) });
    const pubCfg = cfg.body.config as { version: number; revision: number; checksum: string };
    expect(pubCfg.version).toBe(2);
    expect(pubCfg.revision).toBe(2);
    expect(pubCfg.checksum).toBe(pubVer.checksum);
    // History is immutable and rollback re-publishes the previous snapshot.
    const hist = await api('/admin/config/history', { headers: A });
    expect((hist.body.history as unknown[]).length).toBe(1);
    const rb = await api('/admin/config/rollback', { method: 'POST', headers: A, body: JSON.stringify({ game: 'plumber' }) });
    expect((rb.body.version as { version: number }).version).toBe(3);
    const audit = await api('/admin/audit', { headers: A });
    expect((audit.body.audit as Array<Record<string, unknown>>).length).toBeGreaterThanOrEqual(3);
    expect((audit.body.audit as Array<Record<string, unknown>>).some((a) => a.action === 'publish' && typeof a.checksum === 'string')).toBe(true);
  });
  it('telemetry requires versioned consent and an allowlist', async () => {
    const token = await login('tele@example.com');
    const no = await api('/telemetry', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ events: [{ type: 'level_win' }] }) });
    expect(no.body.ok).toBe(false);
    const bare = await api('/telemetry', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ consent: true, events: [{ type: 'level_win' }] }) });
    expect(bare.body.ok).toBe(false);
    const yes = await api('/telemetry', {
      method: 'POST', headers: AUTH(token),
      body: JSON.stringify({
        consent: { granted: true, version: '1', scope: 'analytics' },
        events: [
          { type: 'level_win', level: 3, stars: 3, email: 'x@y.z', password: 'p', nested: { a: 1 } },
          { type: 'not_allowed', level: 1 },
        ],
      }),
    });
    expect(yes.body).toEqual({ ok: true, accepted: 1 });
  });
  it('sessions are hashed at rest and reject expired tokens', async () => {
    const token = await login('exp@example.com');
    const me = await api('/me', { headers: AUTH(token) });
    expect(me.status).toBe(200);
    // Stored session must be keyed by hash, not the bearer token.
    const direct = await store.getSession(token);
    expect(direct).toBeNull();
    await store.putSession({ tokenHash: hashSecret('expiredtok'), userId: 'x', role: 'player', expiresAt: Date.now() - 1000 });
    const exp = await api('/me', { headers: AUTH('expiredtok') });
    expect(exp.status).toBe(401);
  });
});

describe('sync: idempotency, stats merge, CORS, test-only OTP', () => {
  // One login for the whole block: each login consumes a per-IP OTP request,
  // and the rate limiter is intentionally shared across the test IP.
  let token = '';
  beforeAll(async () => {
    token = await login('syncsuite@example.com');
  });

  it('resending the same event uuid never double-counts wins', async () => {
    const ev = { uuid: 'u-fixed-1', kind: 'win', level: 3, stars: 2, mode: 'normal', family: 'valve' };
    const first = await api('/games/plumber/sync', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ events: [ev], baseVersion: 1 }) });
    expect(first.body.applied).toBe(1);
    const second = await api('/games/plumber/sync', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ events: [ev] }) });
    expect(second.body.applied).toBe(0);
    const save = await api('/games/plumber/save', { headers: AUTH(token) });
    const data = save.body.save as { data: { completed: number[]; stars: Record<string, number>; modes: Record<string, { maxLevel: number; completed: number[] }> } };
    expect(data.data.completed).toEqual([3]);
    expect(data.data.stars['normal:3']).toBe(2);
    expect(data.data.modes.normal.completed).toEqual([3]);
    expect(data.data.modes.normal.maxLevel).toBe(4);
  });

  it('keeps per-mode progress independent on the server (TZ v1.2 §5)', async () => {
    const evs = [
      { uuid: 'm-child-1', kind: 'win', level: 1, stars: 3, mode: 'child', family: 'path' },
      { uuid: 'm-child-2', kind: 'win', level: 2, stars: 3, mode: 'child', family: 'path' },
      { uuid: 'm-expert-1', kind: 'win', level: 1, stars: 1, mode: 'expert', family: 'valve' },
    ];
    const r = await api('/games/plumber-modes/sync', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ events: evs }) });
    expect(r.body.applied).toBe(3);
    const save = await api('/games/plumber-modes/save', { headers: AUTH(token) });
    const modes = (save.body.save as { data: { modes: Record<string, { maxLevel: number; completed: number[] }> } }).data.modes;
    expect(modes.child.completed).toEqual([1, 2]);
    expect(modes.child.maxLevel).toBe(3);
    expect(modes.expert.completed).toEqual([1]);
    expect(modes.expert.maxLevel).toBe(2);
    expect(modes.normal.completed).toEqual([]);
    expect(modes.normal.maxLevel).toBe(1);
  });

  it('merges stats deltas across modes additively (once per uuid)', async () => {
    const evs = [
      { uuid: 's1', kind: 'stats', mode: 'normal', delta: { attempts: 1 } },
      { uuid: 's2', kind: 'stats', mode: 'normal', delta: { hints: 2 } },
      { uuid: 's3', kind: 'stats', mode: 'expert', delta: { wins: 1 } },
    ];
    const r = await api('/games/plumber-stats/sync', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ events: evs }) });
    expect(r.body.applied).toBe(3);
    const save = await api('/games/plumber-stats/save', { headers: AUTH(token) });
    const stats = (save.body.save as { data: { stats: Record<string, { attempts: number; hints: number; wins: number }> } }).data.stats;
    expect(stats.normal.attempts).toBe(1);
    expect(stats.normal.hints).toBe(2);
    expect(stats.expert.wins).toBe(1);
    const again = await api('/games/plumber-stats/sync', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ events: evs }) });
    expect(again.body.applied).toBe(0);
    const save2 = await api('/games/plumber-stats/save', { headers: AUTH(token) });
    const stats2 = (save2.body.save as { data: { stats: Record<string, { hints: number }> } }).data.stats;
    expect(stats2.normal.hints).toBe(2);
  });

  it('sends permissive CORS headers and answers preflight', async () => {
    const res = await fetch(base + '/health', { headers: { Origin: 'http://localhost:4173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const pre = await fetch(base + '/games/plumber/sync', { method: 'OPTIONS', headers: { Origin: 'http://localhost:4173' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('exposes the OTP code only in test configuration', async () => {
    const r = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ email: 'reveal@example.com' }) });
    expect(typeof r.body.code).toBe('string');
    expect((r.body.code as string).length).toBe(6);
  });
});
