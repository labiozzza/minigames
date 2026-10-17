// Sync engine: owns the durable queue, backoff, login flow and the monotonic
// server<->local merge. Games only call the tiny ProgressSink surface.
import { ApiClient, ApiError } from '../api/client';
import { SYNC_ENABLED, API_BASE } from '../api/config';
import { getGuestId, getToken, isSignedIn, setToken } from '../auth/session';
import { kvGet, kvSet } from '../storage/idb';
import { mergeServerSnapshot, recordConflict, type SaveData } from '../storage/save';
import type { Mode } from '../../games/plumber/domain/progression';
import { dailyEvent, statsEvent, winEvent, type StatsDelta, type SyncEvent, type WinInput } from './events';
import { EventQueue } from './queue';
import { setStatus } from './status';

const VER_KEY = 'sync-server-version-v1';
const BATCH = 200;
const MAX_BACKOFF_MS = 30000;

export interface ProgressSink {
  win(i: WinInput): void;
  daily(i: { gameId: string; puzzleId: string; rulesetVersion: string; generatorVersion: string; day: string; stars: number; mode?: Mode }): void;
  stats(i: { gameId: string; puzzleId: string; rulesetVersion: string; generatorVersion: string; mode: Mode; delta: StatsDelta }): void;
}

export interface EngineDeps {
  save: SaveData;
  persist: () => Promise<void>;
  games: string[];
}

export class SyncEngine implements ProgressSink {
  private queue = new EventQueue();
  private client: ApiClient;
  private versions: Record<string, number> = {};
  private flushing = false;
  private backoff = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private online = typeof navigator === 'undefined' ? true : navigator.onLine;

  constructor(private deps: EngineDeps) {
    this.client = new ApiClient(API_BASE, getToken);
  }

  get enabled(): boolean {
    return SYNC_ENABLED;
  }

  async init(): Promise<void> {
    if (!this.enabled) {
      setStatus({ state: 'local', pending: 0 });
      return;
    }
    try {
      const raw = await kvGet(VER_KEY);
      if (raw) this.versions = JSON.parse(raw) as Record<string, number>;
    } catch {
      /* ignore */
    }
    await this.queue.load();
    await this.queue.prune(30 * 86400000);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.online = true;
        void this.flush();
      });
      window.addEventListener('offline', () => {
        this.online = false;
        this.refreshStatus();
      });
    }
    this.refreshStatus();
    if (isSignedIn()) void this.flush();
  }

  private refreshStatus(patch: Partial<{ state: string; message: string }> = {}): void {
    const pending = this.queue.size();
    if (!this.enabled) {
      setStatus({ state: 'local', pending, ...patch } as never);
      return;
    }
    if (!isSignedIn()) {
      setStatus({ state: 'guest', pending, ...patch } as never);
      return;
    }
    if (!this.online) {
      setStatus({ state: 'offline', pending, ...patch } as never);
      return;
    }
    setStatus({ state: pending > 0 ? 'pending' : 'synced', pending, ...patch } as never);
  }

  private async persistVersions(): Promise<void> {
    try {
      await kvSet(VER_KEY, JSON.stringify(this.versions));
    } catch {
      /* ignore */
    }
  }

  // ---------- ProgressSink ----------

  win(i: WinInput): void {
    void this.enqueue(winEvent(i));
  }

  daily(i: Parameters<ProgressSink['daily']>[0]): void {
    void this.enqueue(dailyEvent(i));
  }

  stats(i: Parameters<ProgressSink['stats']>[0]): void {
    void this.enqueue(statsEvent(i));
  }

  private async enqueue(e: SyncEvent): Promise<void> {
    if (!this.enabled) {
      setStatus({ state: 'local' });
      return;
    }
    await this.queue.enqueue(e);
    this.refreshStatus();
    void this.flush();
  }

  // ---------- auth ----------

  async requestOtp(email: string): Promise<{ ok: boolean; retryAfter?: number; code?: string }> {
    return this.client.requestOtp(email);
  }

  async login(email: string, code: string): Promise<boolean> {
    try {
      const r = await this.client.verifyOtp(email, code);
      setToken(r.token);
      setStatus({ state: 'pending', user: { id: r.userId, email } });
      await this.linkGuest();
      await this.fullSync();
      return true;
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setStatus({ state: 'error', message: status === 401 ? 'invalid-code' : 'network' });
      return false;
    }
  }

  async linkGuest(): Promise<void> {
    if (!isSignedIn()) return;
    try {
      await this.client.linkGuest(getGuestId());
    } catch {
      /* linking is best-effort; retried on next sync */
    }
  }

  logout(): void {
    setToken(null);
    this.refreshStatus();
  }

  /** §15 data rights: full server-side export of the signed-in user's data. */
  async exportData(): Promise<Record<string, unknown>> {
    const r = await this.client.exportData();
    return r.export;
  }

  /** §15 data rights: irreversible erasure; the server also drops sessions. */
  async eraseData(): Promise<{ ok: boolean; erased: Record<string, number> }> {
    const r = await this.client.eraseData();
    setToken(null);
    this.refreshStatus();
    return r;
  }

  async me(): Promise<{ id: string; email?: string } | null> {
    if (!isSignedIn()) return null;
    try {
      const r = await this.client.me();
      return r.user ? { id: r.user.id, email: r.user.email } : null;
    } catch {
      return null;
    }
  }

  // ---------- flushing ----------

  /** Push all queued events for every game, then pull + merge server truth. */
  async fullSync(): Promise<void> {
    if (!this.enabled || !isSignedIn()) return;
    this.refreshStatus({ state: 'syncing' });
    await this.pushAll();
    for (const g of this.deps.games) await this.pull(g);
    await this.deps.persist();
    this.backoff = 1000;
    this.refreshStatus();
  }

  async flush(): Promise<void> {
    if (!this.enabled || this.flushing) return;
    if (!isSignedIn() || !this.online) {
      this.refreshStatus();
      return;
    }
    if (this.queue.size() === 0) {
      this.refreshStatus();
      return;
    }
    this.flushing = true;
    try {
      this.refreshStatus({ state: 'syncing' });
      await this.pushAll();
      await this.deps.persist();
      this.backoff = 1000;
      this.refreshStatus();
    } catch {
      this.scheduleRetry();
    } finally {
      this.flushing = false;
    }
  }

  private scheduleRetry(): void {
    if (this.timer) return;
    const delay = Math.min(MAX_BACKOFF_MS, this.backoff);
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    setStatus({ state: this.online ? 'error' : 'offline', pending: this.queue.size(), message: 'retry' });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private async pushAll(): Promise<void> {
    for (const gameId of this.deps.games) {
      const events = this.queue.byGame(gameId);
      const active = (this.deps.save.games[gameId] as { active?: unknown } | undefined)?.active ?? null;
      if (events.length === 0 && !active) continue;
      await this.pushGame(gameId, events);
    }
  }

  private async pushGame(gameId: string, events: SyncEvent[]): Promise<void> {
    if (events.length === 0) {
      await this.pushChunk(gameId, []);
      this.refreshStatus();
      return;
    }
    for (let i = 0; i < events.length; i += BATCH) {
      await this.pushChunk(gameId, events.slice(i, i + BATCH));
    }
    this.refreshStatus();
  }

  private async pushChunk(gameId: string, chunk: SyncEvent[]): Promise<void> {
    const active = ((this.deps.save.games[gameId] as { active?: unknown } | undefined)?.active ?? null) as Record<string, unknown> | null;
    const baseVersion = this.versions[gameId] ?? null;
    const res = await this.client.sync(gameId, chunk, active, baseVersion);
    this.versions[gameId] = res.save.version;
    await this.persistVersions();
    if (chunk.length > 0) await this.queue.ack(chunk.map((e) => e.uuid));
    if (res.conflict) await this.handleConflict(gameId, res.save.active);
  }

  private async pull(gameId: string): Promise<void> {
    const { save } = await this.client.getSave(gameId);
    mergeServerSnapshot(this.deps.save, gameId, save.data);
    this.versions[gameId] = Math.max(this.versions[gameId] ?? 0, save.version);
    await this.persistVersions();
  }

  private async handleConflict(gameId: string, remoteActive: Record<string, unknown> | null): Promise<void> {
    const localActive = (this.deps.save.games[gameId] as { active?: unknown } | undefined)?.active ?? null;
    // Monotonic data merges automatically; only unfinished sessions conflict.
    if (localActive && remoteActive && JSON.stringify(localActive) !== JSON.stringify(remoteActive)) {
      recordConflict(this.deps.save, gameId, localActive, remoteActive);
    }
    mergeServerSnapshot(this.deps.save, gameId, {}); // no-op keeps shape stable
    setStatus({ state: 'conflict', pending: this.queue.size() });
  }
}
