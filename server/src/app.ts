// MiniGames server — shared modular backend (Stage 5, local/preview tier).
// node:http only, no runtime dependencies. Storage is pluggable (memory/file);
// Postgres adapter is a documented interface, not deployed here (no VPS action
// without approval). All game rules stay client-side; the server stores,
// deduplicates and audits.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { MemoryStore, type Store } from './store';
import { AuthService } from './auth';

export interface ServerOptions {
  store?: Store;
  now?: () => number;
}

interface Ctx {
  userId: string | null;
  isAdmin: boolean;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += String(c);
      if (buf.length > 65536) {
        req.destroy();
        reject(new Error('too large'));
      }
    });
    req.on('end', () => {
      if (!buf) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(buf));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function createApp(opts: ServerOptions = {}): { server: Server; auth: AuthService; store: Store } {
  const store = opts.store ?? new MemoryStore();
  const now = opts.now ?? Date.now;
  const auth = new AuthService(store, now);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';
      const body = (method === 'POST' || method === 'PUT') ? await readJson(req) : {};
      const b = body as Record<string, unknown>;

      const token = bearer(req);
      const session = token ? await auth.sessionOf(token) : null;
      const ctx: Ctx = { userId: session?.userId ?? null, isAdmin: session?.role === 'admin' };

      // ---------- health (public, no auth) ----------
      if (method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true, version: 1 });
      }

      // ---------- auth ----------
      if (method === 'POST' && url.pathname === '/auth/otp/request') {
        if (typeof b.email !== 'string' || b.email.length > 320) return send(res, 400, { error: 'bad-email' });
        const r = await auth.requestOtp(b.email.toLowerCase().trim());
        return send(res, 200, r);
      }
      if (method === 'POST' && url.pathname === '/auth/otp/verify') {
        if (typeof b.email !== 'string' || typeof b.code !== 'string') return send(res, 400, { error: 'bad-args' });
        const r = await auth.verifyOtp(b.email.toLowerCase().trim(), b.code.trim());
        if (!r) return send(res, 401, { error: 'invalid-code' });
        return send(res, 200, r);
      }
      if (!ctx.userId) return send(res, 401, { error: 'auth-required' });

      // ---------- profile ----------
      if (method === 'GET' && url.pathname === '/me') {
        return send(res, 200, { user: await store.getUser(ctx.userId) });
      }
      if (method === 'POST' && url.pathname === '/guest/link') {
        if (typeof b.guestId !== 'string' || b.guestId.length > 128) return send(res, 400, { error: 'bad-guest' });
        const merged = await store.linkGuest(ctx.userId, b.guestId);
        return send(res, 200, { user: merged });
      }

      // ---------- saves & sync ----------
      let m = /^\/games\/([a-z-]+)\/save$/.exec(url.pathname);
      if (method === 'GET' && m) {
        return send(res, 200, { save: await store.getSave(ctx.userId, m[1]) });
      }
      m = /^\/games\/([a-z-]+)\/sync$/.exec(url.pathname);
      if (method === 'POST' && m) {
        const gameId = m[1];
        if (!Array.isArray(b.events) || b.events.length > 200) return send(res, 400, { error: 'bad-events' });
        const save = await store.getSave(ctx.userId, gameId);
        let applied = 0;
        for (const e of b.events as Array<Record<string, unknown>>) {
          if (!e || typeof e.uuid !== 'string' || e.uuid.length > 64) continue;
          if (save.seen.includes(e.uuid)) continue; // idempotent replay
          save.seen.push(e.uuid);
          applied += 1;
          applyEvent(save, e);
        }
        // Active-session conflicts are never merged component-wise: first wins.
        if (b.active && typeof b.active === 'object' && !save.active) {
          save.active = b.active as Record<string, unknown>;
        }
        const conflict = typeof b.baseVersion === 'number' && b.baseVersion !== save.version;
        save.version += 1;
        save.updatedAt = now();
        await store.putSave(ctx.userId, gameId, save);
        return send(res, 200, { applied, save, conflict });
      }
      m = /^\/games\/([a-z-]+)\/achievements$/.exec(url.pathname);
      if (method === 'GET' && m) {
        const save = await store.getSave(ctx.userId, m[1]);
        return send(res, 200, { achievements: deriveAchievements(save) });
      }

      // ---------- challenges (deterministic UTC manifests) ----------
      m = /^\/games\/([a-z-]+)\/challenges$/.exec(url.pathname);
      if (method === 'GET' && m) {
        const mode = url.searchParams.get('mode') ?? 'normal';
        return send(res, 200, { challenges: challengeManifest(m[1], mode, now()) });
      }
      m = /^\/games\/([a-z-]+)\/challenges\/([A-Za-z0-9-]+)$/.exec(url.pathname);
      if (method === 'GET' && m) {
        const c = resolveChallenge(m[1], m[2]);
        if (!c) return send(res, 404, { error: 'unknown-challenge' });
        return send(res, 200, { challenge: c });
      }

      // ---------- share ----------
      if (method === 'POST' && url.pathname === '/share') {
        if (typeof b.def !== 'object' || !b.def) return send(res, 400, { error: 'bad-def' });
        const text = JSON.stringify(b.def);
        if (text.length > 16384) return send(res, 413, { error: 'too-large' });
        const code = randomBytes(6).toString('base64url');
        await store.putShare(code, { def: b.def, owner: ctx.userId, createdAt: now(), hits: 0 });
        return send(res, 200, { code });
      }
      m = /^\/share\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (method === 'GET' && m) {
        const s = await store.getShare(m[1]);
        if (!s) return send(res, 404, { error: 'unknown-share' });
        return send(res, 200, { def: s.def });
      }

      // ---------- public config ----------
      m = /^\/games\/([a-z-]+)\/config$/.exec(url.pathname);
      if (method === 'GET' && m) {
        return send(res, 200, { config: await store.getConfig(m[1]) });
      }

      // ---------- admin ----------
      if (url.pathname.startsWith('/admin/')) {
        if (!ctx.isAdmin) return send(res, 403, { error: 'forbidden' });
        const game = typeof b.game === 'string' ? b.game : 'plumber';
        if (method === 'GET' && url.pathname === '/admin/config/draft') {
          return send(res, 200, { draft: await store.getDraft(game) });
        }
        if (method === 'PUT' && url.pathname === '/admin/config/draft') {
          if (typeof b.draft !== 'object' || !b.draft) return send(res, 400, { error: 'bad-draft' });
          await store.putDraft(game, b.draft, ctx.userId, now());
          return send(res, 200, { ok: true });
        }
        if (method === 'POST' && url.pathname === '/admin/config/preview') {
          const seeds = Array.isArray(b.seeds) ? (b.seeds as unknown[]).filter((x): x is number => typeof x === 'number').slice(0, 8) : [1, 2, 3];
          return send(res, 200, { preview: { game, seeds, note: 'client validates seeds against draft before publish' } });
        }
        if (method === 'POST' && url.pathname === '/admin/config/publish') {
          const v = await store.publishConfig(game, ctx.userId, now());
          if (!v) return send(res, 409, { error: 'no-draft' });
          return send(res, 200, { version: v });
        }
        if (method === 'POST' && url.pathname === '/admin/config/rollback') {
          const v = await store.rollbackConfig(game, ctx.userId, now());
          if (!v) return send(res, 409, { error: 'no-history' });
          return send(res, 200, { version: v });
        }
        if (method === 'GET' && url.pathname === '/admin/audit') {
          return send(res, 200, { audit: await store.getAudit(100) });
        }
      }

      // ---------- telemetry (consent-gated, PII-stripped) ----------
      if (method === 'POST' && url.pathname === '/telemetry') {
        if (b.consent !== true) return send(res, 200, { ok: false, reason: 'no-consent' });
        if (typeof b.events !== 'undefined' && !Array.isArray(b.events)) return send(res, 400, { error: 'bad-events' });
        const clean = ((b.events ?? []) as Array<Record<string, unknown>>).slice(0, 100).map((e) => {
          const c: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(e ?? {})) {
            if (['password', 'otp', 'code', 'token', 'email', 'deviceId'].includes(k)) continue;
            if (typeof v === 'string' && v.length > 512) continue;
            c[k] = v;
          }
          return c;
        });
        await store.putTelemetry(ctx.userId, clean, now());
        return send(res, 200, { ok: true, accepted: clean.length });
      }

      return send(res, 404, { error: 'not-found' });
    } catch (err) {
      try {
        send(res, 500, { error: 'internal' });
      } catch {
        /* closed */
      }
      void err;
    }
  });

  return { server, auth, store };
}

function applyEvent(save: { data: Record<string, unknown> }, e: Record<string, unknown>): void {
  const d = save.data;
  if (e.kind === 'win') {
    const completed = Array.isArray(d.completed) ? (d.completed as number[]) : [];
    if (typeof e.level === 'number' && !completed.includes(e.level)) completed.push(e.level);
    d.completed = [...completed].sort((a, b) => a - b);
    if (typeof e.level === 'number' && typeof d.maxLevel === 'number') {
      d.maxLevel = Math.max(d.maxLevel, e.level + 1);
    }
    if (typeof e.level === 'number' && typeof e.stars === 'number' && d.stars && typeof d.stars === 'object') {
      const key = `${String(e.mode ?? 'normal')}:${e.level}`;
      (d.stars as Record<string, number>)[key] = Math.max((d.stars as Record<string, number>)[key] ?? 0, e.stars);
    }
    if (typeof e.family === 'string' && d.fams && typeof d.fams === 'object') {
      (d.fams as Record<string, unknown>)[String(e.level)] = { family: e.family, mode: String(e.mode ?? 'normal') };
    }
  } else if (e.kind === 'daily') {
    if (d.dailies && typeof d.dailies === 'object' && typeof e.day === 'string' && typeof e.stars === 'number') {
      (d.dailies as Record<string, number>)[e.day] = Math.max((d.dailies as Record<string, number>)[e.day] ?? 0, e.stars);
    }
  }
}

function deriveAchievements(save: { data: Record<string, unknown> }): Array<{ id: string; done: boolean }> {
  const completed = Array.isArray(save.data.completed) ? (save.data.completed as number[]) : [];
  const stars = save.data.stars && typeof save.data.stars === 'object'
    ? Object.values(save.data.stars as Record<string, number>).reduce((a, b) => a + b, 0)
    : 0;
  return [
    { id: 'first-win', done: completed.length >= 1 },
    { id: 'ten-wins', done: completed.length >= 10 },
    { id: 'star-10', done: stars >= 10 },
  ];
}

export function dayString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function challengeManifest(gameId: string, mode: string, nowMs: number): Array<{ id: string; kind: string; day: string }> {
  const day = dayString(nowMs);
  const monday = new Date(nowMs);
  const dow = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - dow);
  const week = monday.toISOString().slice(0, 10);
  void gameId;
  void mode;
  return [
    { id: `daily-${day}`, kind: 'daily', day },
    { id: `weekly-${week}`, kind: 'weekly', day: week },
  ];
}

function resolveChallenge(gameId: string, id: string): { id: string; game: string; seed: number; mode: string } | null {
  void gameId;
  let m = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (m) {
    let h = 0x811c9dc5;
    for (let i = 0; i < m[1].length; i++) {
      h ^= m[1].charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return { id, game: gameId, seed: h >>> 0, mode: 'normal' };
  }
  m = /^weekly-(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (m) {
    let h = 0x811c9dc5;
    const s = `week:${m[1]}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return { id, game: gameId, seed: h >>> 0, mode: 'expert' };
  }
  return null;
}
