// OTP auth with rate limits and anti-enumeration.
// Secrets are hashed at rest (sha256): session tokens and OTP codes never hit
// storage in plaintext. `lastCodeFor` exists ONLY when exposeCodes=true (test
// config); production app instances use exposeCodes=false and never see codes.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Store } from './store';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const REQ_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQ_PER_WINDOW = 5;
const MAX_REQ_PER_IP = 20;

export function hashSecret(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface AuthOptions {
  /** When true, issued codes are readable via lastCodeFor (test builds only). */
  exposeCodes?: boolean;
  now?: () => number;
  /** Emails that receive the admin role on login (never hard-coded). */
  adminEmails?: string[];
  /** Test/E2E only: skip the per-email request window (never in production). */
  noRateLimit?: boolean;
}

export class AuthService {
  private lastCodes = new Map<string, string>();
  private ipLog = new Map<string, number[]>();
  private now: () => number;
  private exposeCodes: boolean;
  private adminEmails: Set<string>;
  private noRateLimit: boolean;

  constructor(private store: Store, opts: AuthOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.exposeCodes = opts.exposeCodes ?? false;
    this.adminEmails = new Set((opts.adminEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
    this.noRateLimit = opts.noRateLimit ?? false;
  }

  /** Dev/test hook. Returns undefined in production configuration. */
  lastCodeFor(email: string): string | undefined {
    if (!this.exposeCodes) return undefined;
    return this.lastCodes.get(email);
  }

  private ipLimited(ip: string, ts: number): boolean {
    const log = (this.ipLog.get(ip) ?? []).filter((t) => ts - t < REQ_WINDOW_MS);
    if (log.length >= MAX_REQ_PER_IP) return true;
    this.ipLog.set(ip, [...log, ts]);
    return false;
  }

  async requestOtp(email: string, ip = 'unknown'): Promise<{ ok: true; retryAfter?: number; code?: string }> {
    const ts = this.now();
    // Only an explicit test flag skips the window limit (so repeated E2E runs
    // against a persistent store can obtain a fresh code). Production and the
    // rate-limit unit tests keep the guard.
    if (!this.noRateLimit) {
      if (this.ipLimited(ip, ts)) return { ok: true, retryAfter: 3600 };
      const log = (await this.store.otpRequests(email)).filter((t) => ts - t < REQ_WINDOW_MS);
      if (log.length >= MAX_REQ_PER_WINDOW) {
        const retryAfter = Math.ceil((log[0] + REQ_WINDOW_MS - ts) / 1000);
        return { ok: true, retryAfter }; // same shape: no enumeration
      }
    }
    await this.store.pushOtpRequest(email, ts);
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await this.store.putOtp(email, { codeHash: hashSecret(code), expiresAt: ts + CODE_TTL_MS, attempts: 0 });
    if (this.exposeCodes) {
      this.lastCodes.set(email, code);
      // Test configuration only: surface the code so automated E2E can log in.
      // Production instances run with exposeCodes=false and never return it.
      return { ok: true, code };
    }
    return { ok: true };
  }

  async verifyOtp(email: string, code: string): Promise<{ token: string; userId: string } | null> {
    const rec = await this.store.getOtp(email);
    const ts = this.now();
    if (!rec || rec.expiresAt < ts) return null;
    if (rec.attempts >= MAX_ATTEMPTS) {
      await this.store.delOtp(email);
      return null;
    }
    if (!safeEqual(rec.codeHash, hashSecret(code))) {
      await this.store.putOtp(email, { ...rec, attempts: rec.attempts + 1 });
      return null;
    }
    await this.store.delOtp(email); // single-use
    let user = await this.store.findUserByEmail(email);
    const role = this.adminEmails.has(email.trim().toLowerCase()) ? 'admin' : 'player';
    if (!user) {
      user = { id: `u_${randomBytes(8).toString('hex')}`, email, role, createdAt: ts };
      await this.store.upsertUser(user);
    } else if (user.role !== role) {
      user = { ...user, role };
      await this.store.upsertUser(user);
    }
    const token = randomBytes(32).toString('base64url');
    await this.store.putSession({ tokenHash: hashSecret(token), userId: user.id, role: user.role, expiresAt: ts + 30 * 86400000 });
    return { token, userId: user.id };
  }

  async sessionOf(token: string): Promise<{ userId: string; role: string } | null> {
    const s = await this.store.getSession(hashSecret(token));
    if (!s || s.expiresAt < this.now()) return null;
    return { userId: s.userId, role: s.role };
  }
}
