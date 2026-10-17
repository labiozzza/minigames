// Durable IndexedDB-backed event queue. Survives PWA close/reopen: pending
// events are persisted as JSON and only removed after the server acknowledges
// them (server dedups by uuid, so re-sending is always safe).
import { kvGet, kvSet } from '../storage/idb';
import type { SyncEvent } from './events';

const QUEUE_KEY = 'sync-queue-v1';
const MAX_QUEUE = 2000;

export class EventQueue {
  private items: SyncEvent[] = [];
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await kvGet(QUEUE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) this.items = parsed.filter(isEvent).slice(-MAX_QUEUE) as SyncEvent[];
    } catch {
      this.items = [];
    }
  }

  private async persist(): Promise<void> {
    try {
      await kvSet(QUEUE_KEY, JSON.stringify(this.items.slice(-MAX_QUEUE)));
    } catch {
      /* storage full/unavailable: keep in-memory so the session still syncs */
    }
  }

  async enqueue(e: SyncEvent): Promise<void> {
    await this.load();
    this.items.push(e);
    if (this.items.length > MAX_QUEUE) this.items = this.items.slice(-MAX_QUEUE);
    await this.persist();
  }

  size(): number {
    return this.items.length;
  }

  all(): SyncEvent[] {
    return [...this.items];
  }

  byGame(gameId: string): SyncEvent[] {
    return this.items.filter((e) => e.gameId === gameId);
  }

  /** Remove the given uuids (after a successful, server-acknowledged send). */
  async ack(uuids: string[]): Promise<void> {
    if (uuids.length === 0) return;
    const set = new Set(uuids);
    this.items = this.items.filter((e) => !set.has(e.uuid));
    await this.persist();
  }

  /** Drop events older than maxAge (safety valve against a stuck queue). */
  async prune(maxAgeMs: number, now = Date.now()): Promise<void> {
    const before = this.items.length;
    this.items = this.items.filter((e) => now - e.t <= maxAgeMs);
    if (this.items.length !== before) await this.persist();
  }
}

function isEvent(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.uuid === 'string' && typeof o.gameId === 'string' && typeof o.kind === 'string' && typeof o.t === 'number';
}
