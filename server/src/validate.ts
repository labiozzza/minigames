// Server-side input validation. Nothing is written before passing these gates.
// These are structural checks (shape/type/range/limits), not full game replay.

const MODES = new Set(['child', 'normal', 'expert']);
const FAMILIES = new Set([
  'path', 'leakfix', 'valve', 'filter', 'mixer', 'program', 'carry', 'multiflow', 'exact',
]);

export interface SyncEvent {
  uuid: string;
  kind: 'win' | 'daily' | 'stats';
  t?: number;
  rulesetVersion?: string;
  generatorVersion?: string;
  puzzleId?: string;
  level?: number;
  stars?: number;
  mode?: string;
  family?: string;
  collections?: string[];
  day?: string;
  delta?: { attempts?: number; wins?: number; hints?: number; skips?: number };
}

export interface ValidationResult<T> {
  ok: T[];
  rejected: number;
}

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

function isStr(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function envelope(r: Record<string, unknown>, kind: SyncEvent['kind']): SyncEvent {
  const out: SyncEvent = { uuid: r.uuid as string, kind };
  if (isInt(r.t, 0, 9_000_000_000_000)) out.t = r.t;
  if (isStr(r.rulesetVersion, 64)) out.rulesetVersion = r.rulesetVersion;
  if (isStr(r.generatorVersion, 64)) out.generatorVersion = r.generatorVersion;
  if (isStr(r.puzzleId, 128)) out.puzzleId = r.puzzleId;
  return out;
}

/** Validate one event; return null when it must be rejected. */
export function validateSyncEvent(e: unknown): SyncEvent | null {
  if (!e || typeof e !== 'object') return null;
  const r = e as Record<string, unknown>;
  if (!isStr(r.uuid, 64)) return null;
  if (r.kind === 'win') {
    if (!isInt(r.level, 1, 1_000_000)) return null;
    if (!isInt(r.stars, 1, 3)) return null;
    if (!isStr(r.mode, 16) || !MODES.has(r.mode)) return null;
    const out = envelope(r, 'win');
    out.level = r.level;
    out.stars = r.stars;
    out.mode = r.mode;
    if (isStr(r.family, 32)) {
      if (!FAMILIES.has(r.family)) return null;
      out.family = r.family;
    }
    if (Array.isArray(r.collections)) {
      if (r.collections.length > 64) return null;
      if (!r.collections.every((c) => isStr(c, 32))) return null;
      out.collections = r.collections as string[];
    }
    return out;
  }
  if (r.kind === 'daily') {
    if (!isStr(r.day, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) return null;
    if (!isInt(r.stars, 1, 3)) return null;
    const out = envelope(r, 'daily');
    out.day = r.day;
    out.stars = r.stars;
    return out;
  }
  if (r.kind === 'stats') {
    if (!isStr(r.mode, 16) || !MODES.has(r.mode)) return null;
    const d = r.delta;
    if (!d || typeof d !== 'object') return null;
    const delta: SyncEvent['delta'] = {};
    let any = false;
    for (const k of ['attempts', 'wins', 'hints', 'skips'] as const) {
      const v = (d as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (!isInt(v, 1, 1000)) return null;
      delta[k] = v;
      any = true;
    }
    if (!any) return null;
    const out = envelope(r, 'stats');
    out.mode = r.mode;
    out.delta = delta;
    return out;
  }
  return null;
}

export function validateSyncEvents(list: unknown): ValidationResult<SyncEvent> {
  if (!Array.isArray(list)) return { ok: [], rejected: 0 };
  const ok: SyncEvent[] = [];
  let rejected = 0;
  for (const e of list.slice(0, 200)) {
    const v = validateSyncEvent(e);
    if (v) ok.push(v);
    else rejected += 1;
  }
  return { ok, rejected };
}

const RECEIVER_KINDS = new Set(['auto', 'overflow', 'exact', 'buffer']);

/** Structural gate for a shared LevelDefinition before it is stored. */
export function validateShareDef(def: unknown): boolean {
  if (!def || typeof def !== 'object') return false;
  const d = def as Record<string, unknown>;
  if (!isInt(d.seed, 0, 0xffffffff)) return false;
  if (typeof d.puzzleId !== 'string' || d.puzzleId.length > 128) return false;
  if (!isStr(d.mode, 16) || !MODES.has(d.mode)) return false;
  if (typeof d.rulesetVersion !== 'string' || typeof d.generatorVersion !== 'string') return false;
  if (!isInt(d.gridW, 1, 16) || !isInt(d.gridH, 1, 16)) return false;
  if (!Array.isArray(d.cells) || d.cells.length > 256) return false;
  if (!Array.isArray(d.sources) || d.sources.length > 32) return false;
  if (!Array.isArray(d.receivers) || d.receivers.length > 16) return false;
  for (const r of d.receivers as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') return false;
    if (typeof r.kind === 'string' && r.kind && !RECEIVER_KINDS.has(r.kind)) return false;
  }
  return true;
}

// Telemetry: allowlist, not denylist. Only these event types and fields pass.
// §15: two channels — `diag` (mandatory minimal technical diagnostics, no PII,
// allowed without consent) and `analytics` (optional gameplay analytics, only
// with explicit consent). Child mode gets a stricter analytics subset.
export const TELEMETRY_EVENTS = new Set([
  'app_open', 'game_open', 'level_start', 'level_win', 'level_fail',
  'hint_used', 'settings_change', 'sync_ok', 'sync_fail', 'perf_sample',
]);
export const TELEMETRY_FIELDS = new Set([
  'type', 'channel', 'gameId', 'mode', 'level', 'stars', 'ms', 'fps', 'reason', 'setting', 'value', 'count',
]);
/** Minimal technical diagnostics: allowed without consent, never PII. */
export const DIAG_EVENTS = new Set(['perf_sample', 'sync_ok', 'sync_fail']);
export const DIAG_FIELDS = new Set(['type', 'channel', 'gameId', 'ms', 'fps', 'count', 'reason']);
/** Analytics event types permitted in child mode (stricter by default). */
export const CHILD_ANALYTICS_EVENTS = new Set(['app_open', 'game_open', 'level_start']);
export const TELEMETRY_RETENTION_DAYS = 180;

export interface CleanEvent {
  type: string;
  channel: 'diag' | 'analytics';
  [k: string]: string | number | boolean;
}

const CHANNELS = new Set(['diag', 'analytics']);

/**
 * Drop any event/field outside the allowlist. Diagnostics do not require
 * consent; analytics require a valid consent object and, in child mode, must
 * be from the stricter child-safe subset. Nested objects/arrays are dropped.
 */
export function cleanTelemetry(list: unknown, opts: { consent: boolean; childMode?: boolean } = { consent: false }): CleanEvent[] {
  if (!Array.isArray(list)) return [];
  const out: CleanEvent[] = [];
  for (const e of list.slice(0, 100)) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (!isStr(r.type, 32) || !TELEMETRY_EVENTS.has(r.type)) continue;
    const channel = r.channel === 'diag' ? 'diag' : r.channel === 'analytics' ? 'analytics' : 'analytics';
    if (!CHANNELS.has(channel)) continue;
    if (channel === 'diag') {
      if (!DIAG_EVENTS.has(r.type)) continue;
    } else {
      if (!opts.consent) continue;
      if (opts.childMode && !CHILD_ANALYTICS_EVENTS.has(r.type)) continue;
    }
    const allowed = channel === 'diag' ? DIAG_FIELDS : TELEMETRY_FIELDS;
    const clean: CleanEvent = { type: r.type, channel };
    for (const [k, v] of Object.entries(r)) {
      if (k === 'type' || k === 'channel' || !allowed.has(k)) continue;
      if (typeof v === 'string' && v.length <= 64) clean[k] = v;
      else if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
      else if (typeof v === 'boolean') clean[k] = v;
    }
    out.push(clean);
  }
  return out;
}

export interface PushSubscriptionLike {
  endpoint: string;
  keys?: { p256dh: string; auth: string };
}

/** Structural validation for a stored push subscription (no live delivery here). */
export function validPushSubscription(v: unknown): v is PushSubscriptionLike {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  if (typeof s.endpoint !== 'string' || s.endpoint.length < 8 || s.endpoint.length > 1024) return false;
  if (!s.endpoint.startsWith('https://')) return false;
  if (s.keys === undefined) return true;
  if (!s.keys || typeof s.keys !== 'object') return false;
  const k = s.keys as Record<string, unknown>;
  return typeof k.p256dh === 'string' && typeof k.auth === 'string';
}

/** Versioned consent object (not a bare boolean). */
export function validConsent(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return c.granted === true && isStr(c.version, 16) && isStr(c.scope, 32);
}

/** Per-channel consent: analytics and notifications are independent opt-ins. */
export function consentFor(v: unknown, scope: string): boolean {
  if (!validConsent(v)) return false;
  const c = v as Record<string, unknown>;
  return c.scope === scope;
}
