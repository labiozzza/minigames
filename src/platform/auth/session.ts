// Auth session state: bearer token + stable guest id.
// Tokens live in localStorage (not in the save export, not in IndexedDB
// dumps) and are never written to logs.
const TOKEN_KEY = 'minigames:auth-token';
const GUEST_KEY = 'minigames:guest-id';

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
function lsDel(k: string): void {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

let token: string | null = lsGet(TOKEN_KEY);

export function getToken(): string | null {
  return token;
}

export function setToken(v: string | null): void {
  token = v;
  if (v) lsSet(TOKEN_KEY, v);
  else lsDel(TOKEN_KEY);
}

export function isSignedIn(): boolean {
  return !!token;
}

/** Stable anonymous id, so a guest's local progress can later be linked. */
export function getGuestId(): string {
  let g = lsGet(GUEST_KEY);
  if (!g) {
    let s = '';
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') s = crypto.randomUUID();
    } catch {
      /* ignore */
    }
    if (!s) s = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    g = s;
    lsSet(GUEST_KEY, g);
  }
  return g;
}
