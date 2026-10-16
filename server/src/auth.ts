// OTP auth with rate limits and anti-enumeration. No real mailer here:
// codes are returned to the test harness via lastCodeFor (dev preview only).
import { randomBytes, randomInt } from 'node:crypto';
import type { Store } from './store';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const REQ_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQ_PER_WINDOW = 5;

export class AuthService {
  private lastCodes = new Map<string, string>();

  constructor(private store: Store, private now: () => number = Date.now) {}

  /** Dev hook: read the last issued code (preview/testing only, never prod). */
  lastCodeFor(email: string): string | undefined {
    return this.lastCodes.get(email);
  }

  async requestOtp(email: string): Promise<{ ok: true; retryAfter?: number }> {
    const ts = this.now();
    const log = (await this.store.otpRequests(email)).filter((t) => ts - t < REQ_WINDOW_MS);
    if (log.length >= MAX_REQ_PER_WINDOW) {
      const retryAfter = Math.ceil((log[0] + REQ_WINDOW_MS - ts) / 1000);
      return { ok: true, retryAfter }; // same shape: no enumeration
    }
    await this.store.pushOtpRequest(email, ts);
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await this.store.putOtp(email, { code, expiresAt: ts + CODE_TTL_MS, attempts: 0 });
    this.lastCodes.set(email, code);
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
    if (rec.code !== code) {
      await this.store.putOtp(email, { ...rec, attempts: rec.attempts + 1 });
      return null;
    }
    await this.store.delOtp(email);
    let user = await this.store.findUserByEmail(email);
    if (!user) {
      user = { id: `u_${randomBytes(8).toString('hex')}`, email, role: 'player', createdAt: ts };
      await this.store.upsertUser(user);
    }
    const token = randomBytes(32).toString('base64url');
    await this.store.putSession({ token, userId: user.id, role: user.role, expiresAt: ts + 30 * 86400000 });
    return { token, userId: user.id };
  }

  async sessionOf(token: string): Promise<{ userId: string; role: string } | null> {
    const s = await this.store.getSession(token);
    if (!s || s.expiresAt < this.now()) return null;
    return { userId: s.userId, role: s.role };
  }
}
