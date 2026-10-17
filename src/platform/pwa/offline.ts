// §13 per-game offline readiness and cache management.
// A game is "offline-ready" when its code chunks, atlas/manifest and icons are
// present in the Cache Storage. Deleting a game's cache NEVER touches the
// IndexedDB save, so progress and settings survive "free up space".

export interface OfflineStatus {
  ready: boolean;
  cached: number;
  total: number;
  missing: string[];
}

export function cacheName(gameId: string, assetsVersion: string): string {
  const safe = gameId.replace(/[^a-z0-9-]/gi, '');
  return `mg-game-${safe}-v${assetsVersion.replace(/[^a-z0-9.-]/gi, '')}`;
}

function cacheStorage(): CacheStorage | null {
  return typeof caches !== 'undefined' ? caches : null;
}

/** Report which of a game's own assets are already cached (works offline). */
export async function gameOfflineStatus(gameId: string, assetsVersion: string, assetPaths: string[]): Promise<OfflineStatus> {
  const cs = cacheStorage();
  if (!cs || assetPaths.length === 0) return { ready: false, cached: 0, total: assetPaths.length, missing: [...assetPaths] };
  const cache = await cs.open(cacheName(gameId, assetsVersion));
  const missing: string[] = [];
  let cached = 0;
  for (const p of assetPaths) {
    const hit = await cache.match(p);
    if (hit) cached += 1;
    else missing.push(p);
  }
  return { ready: missing.length === 0 && assetPaths.length > 0, cached, total: assetPaths.length, missing };
}

/** Precache a game's own assets into its versioned cache (survives SW update). */
export async function precacheGame(gameId: string, assetsVersion: string, assetPaths: string[]): Promise<OfflineStatus> {
  const cs = cacheStorage();
  if (!cs) return { ready: false, cached: 0, total: assetPaths.length, missing: [...assetPaths] };
  const cache = await cs.open(cacheName(gameId, assetsVersion));
  for (const p of assetPaths) {
    if (await cache.match(p)) continue;
    try {
      const res = await fetch(p, { cache: 'reload' });
      if (res.ok) await cache.put(p, res.clone());
    } catch {
      /* offline before first download: reported as missing, not fatal */
    }
  }
  return gameOfflineStatus(gameId, assetsVersion, assetPaths);
}

/** Delete only this game's asset caches. The IndexedDB save is left untouched. */
export async function deleteGameCache(gameId: string): Promise<string[]> {
  const cs = cacheStorage();
  if (!cs) return [];
  const prefix = `mg-game-${gameId.replace(/[^a-z0-9-]/gi, '')}-v`;
  const names = await cs.keys();
  const removed: string[] = [];
  for (const name of names) {
    if (name.startsWith(prefix)) {
      await cs.delete(name);
      removed.push(name);
    }
  }
  return removed;
}
