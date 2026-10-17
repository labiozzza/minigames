// MiniGames server — shared modular backend (Stage 5, local/preview tier).
// node:http only, no runtime dependencies. Storage is pluggable (memory/file);
// Postgres adapter is a documented interface, not deployed here (no VPS action
// without approval). All game rules stay client-side; the server stores,
// deduplicates and audits.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { MemoryStore, type Store } from './store';
import { AuthService } from './auth';
import { cleanTelemetry, validConsent, validateShareDef, validateSyncEvents } from './validate';

export interface ServerOptions {
  store?: Store;
  now?: () => number;
  /** Expose OTP codes for tests. Must stay false in production. */
  exposeCodes?: boolean;
  /** Max request body in bytes (default 64 KiB). */
  maxBody?: number;
  /** Allowed CORS origin for local dev/E2E ('*' or explicit). null disables. */
  cors?: string | null;
}

interface Ctx {
  userId: string | null;
  isAdmin: boolean;
}

class BodyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function corsHeaders(origin: string | null, allow: string | null): Record<string, string> {
  if (!allow) return {};
  const value = allow === '*' ? '*' : origin && origin === allow ? allow : '';
  if (!value) return {};
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function readJson(req: IncomingMessage, maxBody: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let aborted = false;
    req.on('data', (c) => {
      buf += String(c);
      if (buf.length > maxBody) {
        aborted = true;
        reject(new BodyError(413, 'too large'));
        req.resume(); // drain so the connection can still deliver the response
      }
    });
    req.on('end', () => {
      if (aborted) return;
      if (!buf) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(buf));
      } catch {
        reject(new BodyError(400, 'bad json'));
      }
    });
    req.on('error', (e) => {
      if (!aborted) reject(e);
    });
  });
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function createApp(opts: ServerOptions = {}): { server: Server; auth: AuthService; store: Store } {
  const store = opts.store ?? new MemoryStore();
  const now = opts.now ?? Date.now;
  const maxBody = opts.maxBody ?? 65536;
  const auth = new AuthService(store, { now, exposeCodes: opts.exposeCodes ?? false });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    for (const [k, v] of Object.entries(corsHeaders(origin, opts.cors ?? null))) res.setHeader(k, v);
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';
      const body = (method === 'POST' || method === 'PUT') ? await readJson(req, maxBody) : {};
      const b = body as Record<string, unknown>;

      const token = bearer(req);
      const session = token ? await auth.sessionOf(token) : null;
      const ctx: Ctx = { userId: session?.userId ?? null, isAdmin: session?.role === 'admin' };

      // ---------- health (public, no auth) ----------
      if (method === 'GET' && url.pathname === '/health') {
        const ping = (store as unknown as { ping?: () => Promise<boolean> }).ping;
        let db: boolean | undefined;
        if (typeof ping === 'function') {
          try {
            db = await ping.call(store);
          } catch {
            db = false;
          }
        }
        const ok = db !== false;
        return send(res, ok ? 200 : 503, { ok, version: 1, ...(db !== undefined ? { db } : {}) });
      }

      // ---------- auth ----------
      if (method === 'POST' && url.pathname === '/auth/otp/request') {
        if (typeof b.email !== 'string' || b.email.length > 320) return send(res, 400, { error: 'bad-email' });
        const r = await auth.requestOtp(b.email.toLowerCase().trim(), clientIp(req));
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
        const { ok: events, rejected } = validateSyncEvents(b.events);
        const active = b.active && typeof b.active === 'object' ? (b.active as Record<string, unknown>) : null;
        const baseVersion = typeof b.baseVersion === 'number' && Number.isInteger(b.baseVersion) ? b.baseVersion : null;
        const { applied, save, conflict } = await store.syncSave(ctx.userId, gameId, events as unknown as Array<Record<string, unknown>>, active, baseVersion, now());
        // Server-side replay verification of rewards is not implemented yet, so
        // all accepted awards are explicitly marked provisional.
        return send(res, 200, { applied, rejected, save, conflict, provisional: true });
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
        const horizon = Number(url.searchParams.get('horizon') ?? '7');
        return send(res, 200, { version: CHALLENGE_VERSION, challenges: challengeManifest(m[1], mode, now(), horizon) });
      }
      m = /^\/games\/([a-z-]+)\/challenges\/([A-Za-z0-9-]+)$/.exec(url.pathname);
      if (method === 'GET' && m) {
        const mode = url.searchParams.get('mode') ?? undefined;
        const c = resolveChallenge(m[1], m[2], mode);
        if (!c) return send(res, 404, { error: 'unknown-challenge' });
        return send(res, 200, { challenge: c });
      }

      // ---------- share ----------
      if (method === 'POST' && url.pathname === '/share') {
        if (typeof b.def !== 'object' || !b.def) return send(res, 400, { error: 'bad-def' });
        const text = JSON.stringify(b.def);
        if (text.length > 16384) return send(res, 413, { error: 'too-large' });
        if (!validateShareDef(b.def)) return send(res, 400, { error: 'invalid-def' });
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

      // ---------- telemetry (versioned consent + strict allowlist) ----------
      if (method === 'POST' && url.pathname === '/telemetry') {
        if (!validConsent(b.consent)) return send(res, 200, { ok: false, reason: 'no-consent' });
        const clean = cleanTelemetry(b.events);
        if (clean.length === 0) return send(res, 200, { ok: true, accepted: 0 });
        await store.putTelemetry(ctx.userId, clean as unknown as Array<Record<string, unknown>>, now());
        return send(res, 200, { ok: true, accepted: clean.length });
      }

      return send(res, 404, { error: 'not-found' });
    } catch (err) {
      if (err instanceof BodyError) {
        try {
          send(res, err.status, { error: err.message });
        } catch {
          /* closed */
        }
        return;
      }
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

const CHALLENGE_VERSION = 'challenge/1';
const CHALLENGE_HORIZON_DAYS = 7;
const CHALLENGE_HORIZON_WEEKS = 2;
const CHALLENGE_MODES = ['child', 'normal', 'expert'];

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mondayString(ms: number): string {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface ChallengeEntry {
  id: string;
  kind: 'daily' | 'weekly';
  day: string;
  mode: string;
  seed: number;
  version: string;
  game?: string;
}

/** Deterministic manifest: today..+horizon daily tasks and this week..+2 weekly,
 *  validated and identical for every client (the source of truth after sync). */
function challengeManifest(gameId: string, mode: string, nowMs: number, horizon = CHALLENGE_HORIZON_DAYS): Array<Omit<ChallengeEntry, 'seed'> & { seed: number }> {
  const m = CHALLENGE_MODES.includes(mode) ? mode : 'normal';
  const days = Math.max(CHALLENGE_HORIZON_DAYS, Math.min(60, Math.floor(horizon) || CHALLENGE_HORIZON_DAYS));
  const base = Date.parse(`${dayString(nowMs)}T00:00:00.000Z`);
  const out: Array<Omit<ChallengeEntry, 'seed'> & { seed: number }> = [];
  for (let i = 0; i < days; i++) {
    const day = dayString(base + i * 86400000);
    out.push({ id: `daily-${day}`, kind: 'daily', day, mode: m, version: CHALLENGE_VERSION, seed: fnv(`daily:${m}:${day}`) });
  }
  const monday = Date.parse(`${mondayString(nowMs)}T00:00:00.000Z`);
  for (let w = 0; w <= CHALLENGE_HORIZON_WEEKS; w++) {
    const week = dayString(monday + w * 7 * 86400000);
    out.push({ id: `weekly-${week}`, kind: 'weekly', day: week, mode: m, version: CHALLENGE_VERSION, seed: fnv(`weekly:${m}:${week}`) });
  }
  void gameId;
  return out;
}

/** A challenge is fully determined by (kind, day, mode): same everywhere. */
function resolveChallenge(gameId: string, id: string, modeHint?: string): ChallengeEntry | null {
  const daily = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(id);
  const weekly = /^weekly-(\d{4}-\d{2}-\d{2})$/.exec(id);
  const day = daily?.[1] ?? weekly?.[1];
  if (!day || Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))) return null;
  const kind: 'daily' | 'weekly' = daily ? 'daily' : 'weekly';
  // Day must be a real date; weekly must be a Monday.
  const d = new Date(`${day}T00:00:00.000Z`);
  if (d.toISOString().slice(0, 10) !== day) return null;
  if (kind === 'weekly' && d.getUTCDay() !== 1) return null;
  const mode = modeHint && CHALLENGE_MODES.includes(modeHint) ? modeHint : kind === 'weekly' ? 'expert' : 'normal';
  return { id, kind, day, mode, seed: fnv(`${kind}:${mode}:${day}`), version: CHALLENGE_VERSION, game: gameId } as ChallengeEntry;
}
