// Storage: pluggable interface (memory/file now, Postgres in pg-store.ts), no
// runtime deps. FileStore is a durable local preview store: every mutating
// method is persisted atomically (temp file + rename) and the file is loaded
// before any read/write. Corrupted files are quarantined, never silently wiped.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

export interface UserRec {
  id: string;
  email: string | null;
  role: 'player' | 'admin';
  createdAt: number;
}

export interface SessionRec {
  tokenHash: string;
  userId: string;
  role: 'player' | 'admin';
  expiresAt: number;
}

export interface OtpRec {
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

export interface SaveRec {
  version: number;
  updatedAt: number;
  seen: string[];
  active: Record<string, unknown> | null;
  data: Record<string, unknown>;
}

export interface ShareRec {
  def: unknown;
  owner: string;
  createdAt: number;
  hits: number;
}

export interface Store {
  // users & sessions
  getUser(id: string): Promise<UserRec | null>;
  upsertUser(u: UserRec): Promise<void>;
  findUserByEmail(email: string): Promise<UserRec | null>;
  linkGuest(userId: string, guestId: string): Promise<UserRec | null>;
  putSession(s: SessionRec): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRec | null>;
  // otp
  getOtp(email: string): Promise<OtpRec | null>;
  putOtp(email: string, rec: OtpRec): Promise<void>;
  delOtp(email: string): Promise<void>;
  otpRequests(email: string): Promise<number[]>;
  pushOtpRequest(email: string, ts: number): Promise<void>;
  // saves
  getSave(userId: string, gameId: string): Promise<SaveRec>;
  putSave(userId: string, gameId: string, save: SaveRec): Promise<void>;
  /**
   * Apply sync events + optional active snapshot idempotently. The store
   * guarantees dedup on (userId, gameId, event.uuid) and returns how many
   * events were newly applied. Conflict is reported, never auto-merged.
   */
  syncSave(
    userId: string,
    gameId: string,
    events: Array<Record<string, unknown>>,
    active: Record<string, unknown> | null,
    baseVersion: number | null,
    now: number,
  ): Promise<{ applied: number; save: SaveRec; conflict: boolean }>;
  // share
  putShare(code: string, rec: ShareRec): Promise<void>;
  getShare(code: string): Promise<ShareRec | null>;
  // config & audit
  getConfig(gameId: string): Promise<{ version: number; config: unknown }>;
  getDraft(gameId: string): Promise<{ draft: unknown; updatedBy: string; updatedAt: number } | null>;
  putDraft(gameId: string, draft: unknown, by: string, ts: number): Promise<void>;
  publishConfig(gameId: string, by: string, ts: number): Promise<number | null>;
  rollbackConfig(gameId: string, by: string, ts: number): Promise<number | null>;
  getAudit(limit: number): Promise<Array<Record<string, unknown>>>;
  // telemetry
  putTelemetry(userId: string, events: Array<Record<string, unknown>>, ts: number): Promise<void>;
}

function blankSave(): SaveRec {
  return { version: 1, updatedAt: Date.now(), seen: [], active: null, data: { completed: [], maxLevel: 1, stars: {}, fams: {}, collections: [], dailies: {} } };
}

/** Monotonic merge of a single validated event into a save. Idempotent by caller. */
export function applyEvent(save: { data: Record<string, unknown> }, e: Record<string, unknown>): void {
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
    if (Array.isArray(e.collections) && d.collections && typeof d.collections === 'object') {
      const set = new Set([...(d.collections as string[]), ...(e.collections as string[]).filter((x) => typeof x === 'string')]);
      d.collections = [...set];
    }
  } else if (e.kind === 'daily') {
    if (d.dailies && typeof d.dailies === 'object' && typeof e.day === 'string' && typeof e.stars === 'number') {
      (d.dailies as Record<string, number>)[e.day] = Math.max((d.dailies as Record<string, number>)[e.day] ?? 0, e.stars);
    }
  }
}

export class MemoryStore implements Store {
  private users = new Map<string, UserRec>();
  private byEmail = new Map<string, string>();
  private sessions = new Map<string, SessionRec>();
  private otps = new Map<string, OtpRec>();
  private otpLog = new Map<string, number[]>();
  private saves = new Map<string, SaveRec>();
  private shares = new Map<string, ShareRec>();
  private configs = new Map<string, { version: number; config: unknown }>();
  private drafts = new Map<string, { draft: unknown; updatedBy: string; updatedAt: number }>();
  private history = new Map<string, Array<{ version: number; config: unknown }>>();
  private audit: Array<Record<string, unknown>> = [];
  private telemetry: Array<Record<string, unknown>> = [];

  async getUser(id: string): Promise<UserRec | null> { return this.users.get(id) ?? null; }
  async upsertUser(u: UserRec): Promise<void> {
    this.users.set(u.id, u);
    if (u.email) this.byEmail.set(u.email, u.id);
  }
  async findUserByEmail(email: string): Promise<UserRec | null> {
    const id = this.byEmail.get(email);
    return id ? (this.users.get(id) ?? null) : null;
  }
  async linkGuest(userId: string, guestId: string): Promise<UserRec | null> {
    const u = this.users.get(userId) ?? null;
    if (!u) return null;
    (u as UserRec & { guestIds?: string[] }).guestIds = [...new Set([...(((u as unknown as Record<string, unknown>).guestIds as string[]) ?? []), guestId])];
    return u;
  }
  async putSession(s: SessionRec): Promise<void> { this.sessions.set(s.tokenHash, s); }
  async getSession(tokenHash: string): Promise<SessionRec | null> { return this.sessions.get(tokenHash) ?? null; }
  async getOtp(email: string): Promise<OtpRec | null> { return this.otps.get(email) ?? null; }
  async putOtp(email: string, rec: OtpRec): Promise<void> { this.otps.set(email, rec); }
  async delOtp(email: string): Promise<void> { this.otps.delete(email); }
  async otpRequests(email: string): Promise<number[]> { return this.otpLog.get(email) ?? []; }
  async pushOtpRequest(email: string, ts: number): Promise<void> {
    this.otpLog.set(email, [...(this.otpLog.get(email) ?? []), ts]);
  }
  async getSave(userId: string, gameId: string): Promise<SaveRec> {
    const k = `${userId}:${gameId}`;
    let s = this.saves.get(k);
    if (!s) {
      s = blankSave();
      this.saves.set(k, s);
    }
    return JSON.parse(JSON.stringify(s)) as SaveRec;
  }
  async putSave(userId: string, gameId: string, save: SaveRec): Promise<void> {
    this.saves.set(`${userId}:${gameId}`, JSON.parse(JSON.stringify(save)) as SaveRec);
  }
  async syncSave(
    userId: string,
    gameId: string,
    events: Array<Record<string, unknown>>,
    active: Record<string, unknown> | null,
    baseVersion: number | null,
    now: number,
  ): Promise<{ applied: number; save: SaveRec; conflict: boolean }> {
    const save = await this.getSave(userId, gameId);
    let applied = 0;
    for (const e of events) {
      if (!e || typeof e.uuid !== 'string' || e.uuid.length > 64) continue;
      if (save.seen.includes(e.uuid)) continue;
      save.seen.push(e.uuid);
      applied += 1;
      applyEvent(save, e);
    }
    if (active && typeof active === 'object' && !save.active) save.active = active;
    const conflict = typeof baseVersion === 'number' && baseVersion !== save.version;
    save.version += 1;
    save.updatedAt = now;
    await this.putSave(userId, gameId, save);
    return { applied, save, conflict };
  }
  async putShare(code: string, rec: ShareRec): Promise<void> { this.shares.set(code, rec); }
  async getShare(code: string): Promise<ShareRec | null> { return this.shares.get(code) ?? null; }
  async getConfig(gameId: string): Promise<{ version: number; config: unknown }> {
    return this.configs.get(gameId) ?? { version: 1, config: { game: gameId, families: 'default' } };
  }
  async getDraft(gameId: string) { return this.drafts.get(gameId) ?? null; }
  async putDraft(gameId: string, draft: unknown, by: string, ts: number): Promise<void> {
    this.drafts.set(gameId, { draft: JSON.parse(JSON.stringify(draft)), updatedBy: by, updatedAt: ts });
    this.audit.push({ ts, by, action: 'draft', game: gameId });
  }
  async publishConfig(gameId: string, by: string, ts: number): Promise<number | null> {
    const d = this.drafts.get(gameId);
    if (!d) return null;
    const cur = this.configs.get(gameId) ?? { version: 1, config: {} };
    const hist = this.history.get(gameId) ?? [];
    hist.push(cur);
    this.history.set(gameId, hist);
    const version = cur.version + 1;
    this.configs.set(gameId, { version, config: d.draft });
    this.drafts.delete(gameId);
    this.audit.push({ ts, by, action: 'publish', game: gameId, version });
    return version;
  }
  async rollbackConfig(gameId: string, by: string, ts: number): Promise<number | null> {
    const hist = this.history.get(gameId) ?? [];
    const prev = hist.pop();
    if (!prev) return null;
    this.history.set(gameId, hist);
    this.configs.set(gameId, prev);
    this.audit.push({ ts, by, action: 'rollback', game: gameId, version: prev.version });
    return prev.version;
  }
  async getAudit(limit: number) { return this.audit.slice(-limit); }
  async putTelemetry(userId: string, events: Array<Record<string, unknown>>, ts: number): Promise<void> {
    this.telemetry.push({ userId, ts, events });
  }
}

/** File-backed store for local preview (atomic writes, JSON). Not for production. */
const FILE_MAP_FIELDS = ['users', 'byEmail', 'sessions', 'otps', 'otpLog', 'saves', 'shares', 'configs', 'drafts', 'history'] as const;
const FILE_ARRAY_FIELDS = ['audit', 'telemetry'] as const;
const FILE_MUTATORS = new Set<string>([
  'upsertUser', 'linkGuest', 'putSession', 'putOtp', 'delOtp', 'pushOtpRequest',
  'putSave', 'putShare', 'putDraft', 'publishConfig', 'rollbackConfig', 'putTelemetry',
]);

export class FileStore extends MemoryStore {
  private filePath: string;
  private ensureDone = false;
  /** Set when the on-disk file was unreadable; used by readiness probes. */
  lastLoadError: string | null = null;
  /** Set when the last persist failed; used by readiness probes. */
  lastWriteError: string | null = null;

  constructor(dir: string) {
    super();
    this.filePath = join(dir, 'minigames-server.json');
    // Load eagerly and persist after every mutating call. Lazy-load inside the
    // proxy guards against a store being constructed before its dir exists.
    this.ensure();
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== 'function') return value;
        const name = String(prop);
        return (...args: unknown[]): unknown => {
          target.ensure();
          const out = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (FILE_MUTATORS.has(name)) target.flush();
          return out;
        };
      },
    }) as FileStore;
  }

  private self(): Record<string, unknown> {
    return this as unknown as Record<string, unknown>;
  }

  /** Load the dump once. A corrupt file is quarantined, not deleted. */
  private ensure(): void {
    if (this.ensureDone) return;
    this.ensureDone = true;
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return; // fresh start (no file yet)
    }
    try {
      const dump = JSON.parse(raw) as Record<string, unknown>;
      const rec = this.self();
      for (const k of FILE_MAP_FIELDS) {
        const v = dump[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) rec[k] = new Map(Object.entries(v as Record<string, unknown>));
      }
      for (const k of FILE_ARRAY_FIELDS) {
        if (Array.isArray(dump[k])) rec[k] = dump[k];
      }
    } catch (err) {
      this.lastLoadError = err instanceof Error ? err.message : 'parse-error';
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch {
        /* quarantine best-effort */
      }
    }
  }

  /** Atomically persist all state (temp file + rename). */
  private flush(): void {
    const rec = this.self();
    const dump: Record<string, unknown> = {};
    for (const k of FILE_MAP_FIELDS) {
      const v = rec[k];
      if (v instanceof Map) dump[k] = Object.fromEntries(v);
    }
    for (const k of FILE_ARRAY_FIELDS) {
      const v = rec[k];
      if (Array.isArray(v)) dump[k] = v;
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp-${randomBytes(6).toString('hex')}`;
      writeFileSync(tmp, JSON.stringify(dump));
      renameSync(tmp, this.filePath);
      this.lastWriteError = null;
    } catch (err) {
      this.lastWriteError = err instanceof Error ? err.message : 'write-error';
    }
  }
}
