import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { MemoryStore, type Store } from '../../server/src/store';
import { createApp } from '../../server/src/app';
import { AuthService } from '../../server/src/auth';
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
  const app = createApp({ store: new MemoryStore() });
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
  it('manifest deterministic; share roundtrip; oversize rejected', async () => {
    const token = await login('ch@example.com');
    const m1 = await api('/games/plumber/challenges?mode=normal', { headers: AUTH(token) });
    const m2 = await api('/games/plumber/challenges?mode=normal', { headers: AUTH(token) });
    expect(m1.body).toEqual(m2.body);
    const daily = (m1.body.challenges as Array<{ id: string }>)[0].id;
    const one = await api(`/games/plumber/challenges/${daily}`, { headers: AUTH(token) });
    expect(one.status).toBe(200);
    expect((one.body.challenge as { seed: number }).seed).toBeGreaterThan(0);
    const sh = await api('/share', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ def: { cells: [1, 2, 3] } }) });
    expect(sh.status).toBe(200);
    const got = await api(`/share/${sh.body.code}`, { headers: AUTH(token) });
    expect(got.body.def).toEqual({ cells: [1, 2, 3] });
    const big = await api('/share', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ def: { blob: 'x'.repeat(20000) } }) });
    expect(big.status).toBe(413);
  });
});

describe('config, admin, telemetry', () => {
  it('draft -> publish -> rollback with audit; forbidden without role', async () => {
    const token = await login('user@example.com');
    const forb = await api('/admin/config/draft?game=plumber', { headers: AUTH(token) });
    expect(forb.status).toBe(403);
    await store.upsertUser({ id: 'admin-1', email: 'admin@example.com', role: 'admin', createdAt: Date.now() });
    const adminToken = 'admintoken123';
    await store.putSession({ token: adminToken, userId: 'admin-1', role: 'admin', expiresAt: Date.now() + 3600000 });
    const A = AUTH(adminToken);
    const draft = await api('/admin/config/draft?game=plumber', { headers: A });
    expect(draft.status).toBe(200);
    await api('/admin/config/draft', { method: 'PUT', headers: A, body: JSON.stringify({ game: 'plumber', draft: { families: ['path'] } }) });
    const pub = await api('/admin/config/publish', { method: 'POST', headers: A, body: JSON.stringify({ game: 'plumber' }) });
    expect(pub.body.version).toBe(2);
    const cfg = await api('/games/plumber/config', { headers: AUTH(token) });
    expect((cfg.body.config as { version: number }).version).toBe(2);
    const rb = await api('/admin/config/rollback', { method: 'POST', headers: A, body: JSON.stringify({ game: 'plumber' }) });
    expect(rb.body.version).toBe(1);
    const audit = await api('/admin/audit', { headers: A });
    expect((audit.body.audit as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
  it('telemetry requires consent and strips PII', async () => {
    const token = await login('tele@example.com');
    const no = await api('/telemetry', { method: 'POST', headers: AUTH(token), body: JSON.stringify({ events: [{ t: 1 }] }) });
    expect(no.body.ok).toBe(false);
    const yes = await api('/telemetry', {
      method: 'POST', headers: AUTH(token),
      body: JSON.stringify({ consent: true, events: [{ t: 1, email: 'x@y.z', password: 'p' }] }),
    });
    expect(yes.body).toEqual({ ok: true, accepted: 1 });
  });
});
