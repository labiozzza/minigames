// §14: fetch the published admin config revision so a level can pin it. Fully
// optional — offline or with sync disabled this resolves to null and the game
// runs exactly as before (local revision 1).
import { API_BASE, SYNC_ENABLED } from '../../platform/api/config';

export interface RemoteConfigPin {
  revision: number;
  checksum: string;
}

let cached: RemoteConfigPin | null = null;
let inflight: Promise<RemoteConfigPin | null> | null = null;

export function loadRemoteConfig(gameId: string, timeoutMs = 1500): Promise<RemoteConfigPin | null> {
  if (!SYNC_ENABLED) return Promise.resolve(null);
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`${API_BASE}/games/${gameId}/config`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const body = (await res.json()) as { config?: { revision?: unknown; checksum?: unknown } };
      const revision = typeof body.config?.revision === 'number' && body.config.revision > 0 ? body.config.revision : 1;
      const checksum = typeof body.config?.checksum === 'string' ? body.config.checksum : '';
      cached = { revision, checksum };
      return cached;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test/mount hook: forget the cached revision (e.g. after a publish). */
export function resetRemoteConfig(): void {
  cached = null;
  inflight = null;
}
