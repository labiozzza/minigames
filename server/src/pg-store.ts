// PostgreSQL store: production-grade persistent adapter implementing Store.
// Uses transactions for sync (dedup enforced by a unique key in the DB) and
// inserts history/audit atomically. Requires an explicit connection string —
// it never falls back to a fake in-memory store.
import { Pool, type PoolClient } from 'pg';
import { applyEvent, type ConfigRec, type OtpRec, type SaveRec, type SessionRec, type ShareRec, type Store, type UserRec } from './store';
import { migrate } from './migrate';

function blankSave(): SaveRec {
  return { version: 1, updatedAt: Date.now(), seen: [], active: null, data: { completed: [], maxLevel: 1, stars: {}, fams: {}, collections: [], dailies: {} } };
}

export interface PgStoreOptions {
  connectionString: string;
  /** Run migrations on construction (default true). */
  migrateOnStart?: boolean;
  max?: number;
}

export class PgStore implements Store {
  private pool: Pool;
  /** Extra instance state kept in memory only where durability is not required. */

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  static async create(opts: PgStoreOptions): Promise<PgStore> {
    const pool = new Pool({ connectionString: opts.connectionString, max: opts.max ?? 5 });
    if (opts.migrateOnStart !== false) await migrate(pool);
    return new PgStore(pool);
  }

  /** Readiness probe used by health checks. */
  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getUser(id: string): Promise<UserRec | null> {
    const r = await this.pool.query('SELECT id, email, role, created_at, guest_ids FROM users WHERE id=$1', [id]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return { id: row.id, email: row.email, role: row.role, createdAt: Number(row.created_at), ...(row.guest_ids?.length ? { guestIds: row.guest_ids } : {}) } as UserRec;
  }
  async upsertUser(u: UserRec): Promise<void> {
    await this.pool.query(
      `INSERT INTO users(id, email, role, created_at) VALUES($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, role=EXCLUDED.role`,
      [u.id, u.email, u.role, u.createdAt],
    );
  }
  async findUserByEmail(email: string): Promise<UserRec | null> {
    const r = await this.pool.query('SELECT id, email, role, created_at, guest_ids FROM users WHERE email=$1', [email]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return { id: row.id, email: row.email, role: row.role, createdAt: Number(row.created_at), ...(row.guest_ids?.length ? { guestIds: row.guest_ids } : {}) } as UserRec;
  }
  async linkGuest(userId: string, guestId: string): Promise<UserRec | null> {
    const r = await this.pool.query(
      `UPDATE users SET guest_ids = (SELECT to_jsonb(array_agg(DISTINCT g)) FROM jsonb_array_elements_text(guest_ids) g WHERE g <> $2) || to_jsonb($2::text) WHERE id=$1 RETURNING id, email, role, created_at, guest_ids`,
      [userId, guestId],
    );
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return { id: row.id, email: row.email, role: row.role, createdAt: Number(row.created_at), guestIds: row.guest_ids } as UserRec;
  }
  async putSession(s: SessionRec): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions(token_hash, user_id, role, expires_at) VALUES($1,$2,$3,$4)
       ON CONFLICT (token_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at`,
      [s.tokenHash, s.userId, s.role, s.expiresAt],
    );
  }
  async getSession(tokenHash: string): Promise<SessionRec | null> {
    const r = await this.pool.query('SELECT token_hash, user_id, role, expires_at FROM sessions WHERE token_hash=$1', [tokenHash]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return { tokenHash: row.token_hash, userId: row.user_id, role: row.role, expiresAt: Number(row.expires_at) };
  }
  async getOtp(email: string): Promise<OtpRec | null> {
    const r = await this.pool.query('SELECT code_hash, expires_at, attempts FROM otps WHERE email=$1', [email]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return { codeHash: row.code_hash, expiresAt: Number(row.expires_at), attempts: row.attempts };
  }
  async putOtp(email: string, rec: OtpRec): Promise<void> {
    await this.pool.query(
      `INSERT INTO otps(email, code_hash, expires_at, attempts) VALUES($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET code_hash=EXCLUDED.code_hash, expires_at=EXCLUDED.expires_at, attempts=EXCLUDED.attempts`,
      [email, rec.codeHash, rec.expiresAt, rec.attempts],
    );
  }
  async delOtp(email: string): Promise<void> {
    await this.pool.query('DELETE FROM otps WHERE email=$1', [email]);
  }
  async otpRequests(email: string): Promise<number[]> {
    const r = await this.pool.query('SELECT ts FROM otp_requests WHERE email=$1 ORDER BY ts', [email]);
    return r.rows.map((x) => Number(x.ts));
  }
  async pushOtpRequest(email: string, ts: number): Promise<void> {
    await this.pool.query('INSERT INTO otp_requests(email, ts) VALUES($1,$2)', [email, ts]);
  }
  async getSave(userId: string, gameId: string): Promise<SaveRec> {
    const r = await this.pool.query('SELECT version, updated_at, active, data FROM saves WHERE user_id=$1 AND game_id=$2', [userId, gameId]);
    if (!r.rowCount) return blankSave();
    const row = r.rows[0];
    return { version: row.version, updatedAt: Number(row.updated_at), seen: [], active: row.active ?? null, data: row.data };
  }
  async putSave(userId: string, gameId: string, save: SaveRec): Promise<void> {
    await this.pool.query(
      `INSERT INTO saves(user_id, game_id, version, updated_at, active, data) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, game_id) DO UPDATE SET version=EXCLUDED.version, updated_at=EXCLUDED.updated_at, active=EXCLUDED.active, data=EXCLUDED.data`,
      [userId, gameId, save.version, save.updatedAt, save.active, JSON.stringify(save.data)],
    );
  }
  async syncSave(
    userId: string,
    gameId: string,
    events: Array<Record<string, unknown>>,
    active: Record<string, unknown> | null,
    baseVersion: number | null,
    now: number,
  ): Promise<{ applied: number; save: SaveRec; conflict: boolean }> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const blank = blankSave();
      await client.query(
        `INSERT INTO saves(user_id, game_id, version, updated_at, active, data) VALUES($1,$2,1,$3,NULL,$4)
         ON CONFLICT (user_id, game_id) DO NOTHING`,
        [userId, gameId, now, JSON.stringify(blank.data)],
      );
      const cur = await client.query('SELECT version, active, data FROM saves WHERE user_id=$1 AND game_id=$2 FOR UPDATE', [userId, gameId]);
      const row = cur.rows[0];
      const save: SaveRec = { version: row.version, updatedAt: now, seen: [], active: row.active ?? null, data: row.data };
      let applied = 0;
      for (const e of events) {
        const uuid = e && typeof e.uuid === 'string' ? e.uuid : null;
        if (!uuid) continue;
        const ins = await client.query(
          'INSERT INTO seen_events(user_id, game_id, event_uuid, ts) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [userId, gameId, uuid, now],
        );
        if (ins.rowCount === 1) {
          applied += 1;
          applyEvent(save, e);
        }
      }
      if (active && typeof active === 'object' && !save.active) save.active = active;
      const conflict = typeof baseVersion === 'number' && baseVersion !== save.version;
      save.version += 1;
      await client.query('UPDATE saves SET version=$3, updated_at=$4, active=$5, data=$6 WHERE user_id=$1 AND game_id=$2', [
        userId, gameId, save.version, now, save.active, JSON.stringify(save.data),
      ]);
      await client.query('COMMIT');
      return { applied, save, conflict };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async putShare(code: string, rec: ShareRec): Promise<void> {
    await this.pool.query('INSERT INTO shares(code, def, owner, created_at, hits) VALUES($1,$2,$3,$4,$5)', [code, JSON.stringify(rec.def), rec.owner, rec.createdAt, rec.hits]);
  }
  async getShare(code: string): Promise<ShareRec | null> {
    const r = await this.pool.query('SELECT def, owner, created_at, hits FROM shares WHERE code=$1', [code]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    await this.pool.query('UPDATE shares SET hits=hits+1 WHERE code=$1', [code]);
    return { def: row.def, owner: row.owner, createdAt: Number(row.created_at), hits: row.hits };
  }
  async getConfig(gameId: string): Promise<ConfigRec> {
    const r = await this.pool.query('SELECT version, checksum, config, changes, by_id, at FROM configs WHERE game_id=$1', [gameId]);
    if (!r.rowCount)
      return { version: 1, checksum: '', config: { game: gameId, families: 'default' }, changes: [], by: 'system', at: 0 };
    const row = r.rows[0];
    return {
      version: row.version,
      checksum: row.checksum ?? '',
      config: row.config,
      changes: Array.isArray(row.changes) ? row.changes : [],
      by: row.by_id ?? 'system',
      at: Number(row.at ?? 0),
    };
  }
  async getHistory(gameId: string): Promise<ConfigRec[]> {
    const r = await this.pool.query(
      'SELECT version, checksum, config, changes, by_id, at FROM config_history WHERE game_id=$1 ORDER BY version ASC',
      [gameId],
    );
    return r.rows.map((row) => ({
      version: row.version,
      checksum: row.checksum ?? '',
      config: row.config,
      changes: Array.isArray(row.changes) ? row.changes : [],
      by: row.by_id ?? 'system',
      at: Number(row.at ?? 0),
    }));
  }
  async getDraft(gameId: string): Promise<{ draft: unknown; updatedBy: string; updatedAt: number } | null> {
    const r = await this.pool.query('SELECT draft, updated_by, updated_at FROM config_drafts WHERE game_id=$1', [gameId]);
    if (!r.rowCount) return null;
    return { draft: r.rows[0].draft, updatedBy: r.rows[0].updated_by, updatedAt: Number(r.rows[0].updated_at) };
  }
  async putDraft(gameId: string, draft: unknown, by: string, ts: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO config_drafts(game_id, draft, updated_by, updated_at) VALUES($1,$2,$3,$4)
         ON CONFLICT (game_id) DO UPDATE SET draft=EXCLUDED.draft, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at`,
        [gameId, JSON.stringify(draft), by, ts],
      );
      await client.query('INSERT INTO audit(ts, actor, action, game, detail) VALUES($1,$2,$3,$4,$5)', [ts, by, 'draft', gameId, null]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async publishConfig(gameId: string, by: string, ts: number, meta: { checksum: string; changes: string[] } = { checksum: '', changes: [] }): Promise<number | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const d = await client.query('SELECT draft FROM config_drafts WHERE game_id=$1 FOR UPDATE', [gameId]);
      if (!d.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      const cur = await client.query('SELECT version, checksum, config, changes, by_id, at FROM configs WHERE game_id=$1 FOR UPDATE', [gameId]);
      const curVersion = cur.rowCount ? cur.rows[0].version : 1;
      const curConfig = cur.rowCount ? cur.rows[0].config : {};
      const curChecksum = cur.rowCount ? cur.rows[0].checksum ?? '' : '';
      const curChanges = cur.rowCount && Array.isArray(cur.rows[0].changes) ? cur.rows[0].changes : [];
      const curBy = cur.rowCount ? cur.rows[0].by_id ?? 'system' : 'system';
      const curAt = cur.rowCount ? Number(cur.rows[0].at ?? 0) : 0;
      await client.query(
        'INSERT INTO config_history(game_id, version, config, checksum, changes, by_id, at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [gameId, curVersion, JSON.stringify(curConfig), curChecksum, JSON.stringify(curChanges), curBy, curAt],
      );
      const version = curVersion + 1;
      await client.query(
        `INSERT INTO configs(game_id, version, checksum, config, changes, by_id, at) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (game_id) DO UPDATE SET version=EXCLUDED.version, checksum=EXCLUDED.checksum, config=EXCLUDED.config, changes=EXCLUDED.changes, by_id=EXCLUDED.by_id, at=EXCLUDED.at`,
        [gameId, version, meta.checksum, JSON.stringify(d.rows[0].draft), JSON.stringify(meta.changes), by, ts],
      );
      await client.query('DELETE FROM config_drafts WHERE game_id=$1', [gameId]);
      await client.query('INSERT INTO audit(ts, actor, action, game, detail) VALUES($1,$2,$3,$4,$5)', [ts, by, 'publish', gameId, JSON.stringify({ version, checksum: meta.checksum, changes: meta.changes })]);
      await client.query('COMMIT');
      return version;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async rollbackConfig(gameId: string, by: string, ts: number): Promise<number | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const prev = await client.query(
        'SELECT version, checksum, config, changes, by_id, at FROM config_history WHERE game_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE',
        [gameId],
      );
      if (!prev.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      const p = prev.rows[0];
      const cur = await client.query('SELECT version, checksum, config, changes, by_id, at FROM configs WHERE game_id=$1 FOR UPDATE', [gameId]);
      const curVersion = cur.rowCount ? cur.rows[0].version : 1;
      // Keep the restored snapshot in history too: rollback never deletes audit trail.
      await client.query('DELETE FROM config_history WHERE game_id=$1 AND version=$2', [gameId, p.version]);
      const curChanges = cur.rowCount && Array.isArray(cur.rows[0].changes) ? cur.rows[0].changes : [];
      await client.query(
        'INSERT INTO config_history(game_id, version, config, checksum, changes, by_id, at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [gameId, curVersion, JSON.stringify(cur.rowCount ? cur.rows[0].config : {}), cur.rowCount ? cur.rows[0].checksum ?? '' : '', JSON.stringify(curChanges), cur.rowCount ? cur.rows[0].by_id ?? 'system' : 'system', cur.rowCount ? Number(cur.rows[0].at ?? 0) : 0],
      );
      const version = curVersion + 1;
      await client.query(
        `INSERT INTO configs(game_id, version, checksum, config, changes, by_id, at) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (game_id) DO UPDATE SET version=EXCLUDED.version, checksum=EXCLUDED.checksum, config=EXCLUDED.config, changes=EXCLUDED.changes, by_id=EXCLUDED.by_id, at=EXCLUDED.at`,
        [gameId, version, p.checksum ?? '', JSON.stringify(p.config), JSON.stringify([`rollback→v${p.version}`]), by, ts],
      );
      await client.query('INSERT INTO audit(ts, actor, action, game, detail) VALUES($1,$2,$3,$4,$5)', [ts, by, 'rollback', gameId, JSON.stringify({ version, restored: p.version })]);
      await client.query('COMMIT');
      return version;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async getAudit(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query('SELECT ts, actor, action, game, detail FROM audit ORDER BY id DESC LIMIT $1', [limit]);
    return r.rows.map((x) => ({ ts: Number(x.ts), by: x.actor, action: x.action, game: x.game, ...(x.detail ?? {}) }));
  }
  async putTelemetry(userId: string, events: Array<Record<string, unknown>>, ts: number): Promise<void> {
    await this.pool.query('INSERT INTO telemetry(user_id, ts, events) VALUES($1,$2,$3)', [userId, ts, JSON.stringify(events)]);
  }
}
