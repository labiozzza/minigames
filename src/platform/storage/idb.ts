// Minimal async key-value store: IndexedDB with localStorage fallback.
const LS_PREFIX = 'minigames:';

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(LS_PREFIX + key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  localStorage.setItem(LS_PREFIX + key, value);
}
function lsDel(key: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch { /* ignore */ }
}

function idbSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('minigames', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
let idbFailed = false;

async function idbTx(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> {
  if (!dbPromise) dbPromise = openDb();
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const store = tx.objectStore('kv');
    let req: IDBRequest;
    try {
      req = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb request failed'));
  });
}

export async function kvGet(key: string): Promise<string | null> {
  if (idbSupported() && !idbFailed) {
    try {
      const v = (await idbTx('readonly', (s) => s.get(key))) as string | undefined;
      if (typeof v === 'string') return v;
      // Migrate legacy localStorage value forward.
      const legacy = lsGet(key);
      if (legacy !== null) {
        try {
          await kvSet(key, legacy);
        } catch { /* keep legacy readable */ }
      }
      return legacy;
    } catch {
      idbFailed = true;
    }
  }
  return lsGet(key);
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (idbSupported() && !idbFailed) {
    try {
      await idbTx('readwrite', (s) => s.put(value, key));
      return;
    } catch (e) {
      idbFailed = true;
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'UnknownError')) {
        throw new Error('storage-quota');
      }
    }
  }
  try {
    lsSet(key, value);
  } catch {
    throw new Error('storage-quota');
  }
}

export async function kvDel(key: string): Promise<void> {
  if (idbSupported() && !idbFailed) {
    try {
      await idbTx('readwrite', (s) => s.delete(key));
    } catch {
      idbFailed = true;
    }
  }
  lsDel(key);
}
