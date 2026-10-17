// Thin typed wrapper over the MiniGames backend. No retries here (the sync
// engine owns backoff); this layer only does fetch + timeout + JSON.
export interface SyncResponse {
  applied: number;
  rejected?: unknown;
  save: ServerSave;
  conflict: boolean;
  provisional: boolean;
}

export interface ServerSave {
  version: number;
  updatedAt: number;
  seen: string[];
  active: Record<string, unknown> | null;
  data: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`api ${status}`);
  }
}

export class ApiClient {
  constructor(private base: string, private getToken: () => string | null) {}

  private async request(method: string, path: string, body?: unknown, timeoutMs = 10000): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) throw new ApiError(res.status, json);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<{ ok: boolean }> {
    return this.request('GET', '/health', undefined, 5000) as Promise<{ ok: boolean }>;
  }

  requestOtp(email: string): Promise<{ ok: boolean; retryAfter?: number; code?: string }> {
    return this.request('POST', '/auth/otp/request', { email }) as Promise<{ ok: boolean; retryAfter?: number; code?: string }>;
  }

  verifyOtp(email: string, code: string): Promise<{ token: string; userId: string }> {
    return this.request('POST', '/auth/otp/verify', { email, code }) as Promise<{ token: string; userId: string }>;
  }

  me(): Promise<{ user: { id: string; email?: string; role?: string } | null }> {
    return this.request('GET', '/me') as Promise<{ user: { id: string; email?: string; role?: string } | null }>;
  }

  linkGuest(guestId: string): Promise<{ user: { id: string; email?: string } }> {
    return this.request('POST', '/guest/link', { guestId }) as Promise<{ user: { id: string; email?: string } }>;
  }

  getSave(gameId: string): Promise<{ save: ServerSave }> {
    return this.request('GET', `/games/${encodeURIComponent(gameId)}/save`) as Promise<{ save: ServerSave }>;
  }

  sync(
    gameId: string,
    events: unknown[],
    active: Record<string, unknown> | null,
    baseVersion: number | null,
  ): Promise<SyncResponse> {
    return this.request('POST', `/games/${encodeURIComponent(gameId)}/sync`, {
      events,
      active,
      baseVersion,
    }) as Promise<SyncResponse>;
  }

  // §15 data rights + push (structure only; live push needs deployment creds).
  exportData(): Promise<{ export: Record<string, unknown> }> {
    return this.request('GET', '/me/export') as Promise<{ export: Record<string, unknown> }>;
  }

  eraseData(): Promise<{ ok: boolean; erased: Record<string, number> }> {
    return this.request('POST', '/me/erase', {}) as Promise<{ ok: boolean; erased: Record<string, number> }>;
  }

  pushStatus(): Promise<{ subscriptions: number }> {
    return this.request('GET', '/push/status') as Promise<{ subscriptions: number }>;
  }
}
