// Observable sync status shared by the shell UI. Pure, no side effects.
export type SyncState = 'local' | 'guest' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  user?: { id: string; email?: string } | null;
  message?: string;
}

type Listener = (s: SyncStatus) => void;

const listeners = new Set<Listener>();
let current: SyncStatus = { state: 'local', pending: 0 };

export function getStatus(): SyncStatus {
  return current;
}

export function setStatus(patch: Partial<SyncStatus>): void {
  current = { ...current, ...patch };
  for (const l of listeners) {
    try {
      l(current);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function subscribeStatus(l: Listener): () => void {
  listeners.add(l);
  l(current);
  return () => listeners.delete(l);
}
