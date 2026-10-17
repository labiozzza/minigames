import { describe, expect, it } from 'vitest';
import { cacheName, deleteGameCache, gameOfflineStatus, precacheGame } from '../../src/platform/pwa/offline';

class FakeCache {
  store = new Map<string, Response>();
  async match(k: string): Promise<Response | undefined> { return this.store.get(k); }
  async put(k: string, v: Response): Promise<void> { this.store.set(k, v); }
}

class FakeCaches {
  map = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.map.has(name)) this.map.set(name, new FakeCache());
    return this.map.get(name) as FakeCache;
  }
  async keys(): Promise<string[]> { return [...this.map.keys()]; }
  async delete(name: string): Promise<boolean> { return this.map.delete(name); }
}

function withCaches(fn: () => Promise<void>): Promise<void> {
  const fake = new FakeCaches();
  (globalThis as unknown as { caches: unknown }).caches = fake;
  (globalThis as unknown as { fetch: unknown }).fetch = async (p: string) => new Response(`ok:${p}`);
  return fn().finally(() => { delete (globalThis as { caches?: unknown }).caches; });
}

describe('§13 per-game offline cache', () => {
  it('names caches per game + asset version and sanitizes ids', () => {
    expect(cacheName('plumber', '1')).toBe('mg-game-plumber-v1');
    expect(cacheName('water sort!', '2.0')).toBe('mg-game-watersort-v2.0');
  });

  it('reports missing -> ready after precache, then frees only that game', () =>
    withCaches(async () => {
      const paths = ['assets/plumber/atlas.png', 'assets/plumber/atlas.json'];
      expect(await gameOfflineStatus('plumber', '1', paths)).toMatchObject({ ready: false, cached: 0, total: 2 });
      expect(await precacheGame('plumber', '1', paths)).toMatchObject({ ready: true, cached: 2, missing: [] });
      const removed = await deleteGameCache('plumber');
      expect(removed).toEqual(['mg-game-plumber-v1']);
      expect(await gameOfflineStatus('plumber', '1', paths)).toMatchObject({ ready: false, cached: 0 });
    }));

  it('never reports ready for an empty asset list', () =>
    withCaches(async () => {
      expect(await gameOfflineStatus('plumber', '1', [])).toMatchObject({ ready: false, total: 0 });
    }));
});
