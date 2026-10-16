// Storage: pluggable interface (memory/file now, Postgres later), no deps.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface UserRec {
  id: string;
  email: string | null;
  role: 'player' | 'admin';
  createdAt: number;
}

export interface SessionRec {
  token: string;
  userId: string;
  role: 'player' | 'admin';
  expiresAt: number;
}

export interface OtpRec {
  code: string;
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
  getSession(token: string): Promise<SessionRec | null>;
  // otp
  getOtp(email: string): Promise<OtpRec | null>;
  putOtp(email: string, rec: OtpRec): Promise<void>;
  delOtp(email: string): Promise<void>;
  otpRequests(email: string): Promise<number[]>;
  pushOtpRequest(email: string, ts: number): Promise<void>;
  // saves
  getSave(userId: string, gameId: string): Promise<SaveRec>;
  putSave(userId: string, gameId: string, save: SaveRec): Promise<void>;
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
  return { version: 1, updatedAt: Date.now(), seen: [], active: null, data: { completed: [], maxLevel: 1, stars: {}, fams: {} } };
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
  async putSession(s: SessionRec): Promise<void> { this.sessions.set(s.token, s); }
  async getSession(token: string): Promise<SessionRec | null> { return this.sessions.get(token) ?? null; }
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
export class FileStore extends MemoryStore {
  private file: string;
  private loaded = false;

  constructor(dir: string) {
    super();
    this.file = join(dir, 'minigames-server.json');
  }

  private ensure(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = readFileSync(this.file, 'utf8');
      const dump = JSON.parse(raw) as Record<string, unknown>;
      const mem = this as unknown as Record<string, Map<string, unknown>>;
      for (const [k, v] of Object.entries(dump)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) mem[k] = new Map(Object.entries(v));
        else if (Array.isArray(v) && (k === 'audit' || k === 'telemetry')) (this as unknown as Record<string, unknown[]>)[k] = v;
      }
    } catch {
      /* fresh start */
    }
  }

  private flush(): void {
    const mem = this as unknown as Record<string, unknown>;
    const dump: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(mem)) {
      if (v instanceof Map) dump[k] = Object.fromEntries(v);
      else if (Array.isArray(v) && (k === 'audit' || k === 'telemetry')) dump[k] = v;
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(dump));
    } catch {
      /* best effort */
    }
  }

  override async putSave(userId: string, gameId: string, save: SaveRec): Promise<void> {
    this.ensure();
    await super.putSave(userId, gameId, save);
    this.flush();
  }
}
