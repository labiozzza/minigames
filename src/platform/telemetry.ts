// §15 telemetry client. Two independent channels:
//   * diag      — mandatory minimal technical diagnostics, no PII, no consent.
//   * analytics — optional gameplay analytics, only sent with explicit consent.
// Nothing is sent when sync is disabled (offline/local-only build), and the
// server re-validates every field against a hard allowlist.
import { API_BASE, SYNC_ENABLED } from './api/config';
import type { Settings } from './settings/store';

export interface DiagEvent {
  type: 'perf_sample' | 'sync_ok' | 'sync_fail';
  gameId?: string;
  fps?: number;
  ms?: number;
  count?: number;
  reason?: string;
}

export type AnalyticsType =
  | 'app_open'
  | 'game_open'
  | 'level_start'
  | 'level_win'
  | 'level_fail'
  | 'hint_used'
  | 'settings_change'
  | 'sync_ok'
  | 'sync_fail'
  | 'perf_sample';

export interface AnalyticsEvent {
  type: AnalyticsType;
  gameId?: string;
  mode?: string;
  level?: number;
  stars?: number;
  setting?: string;
  value?: string | number | boolean;
  count?: number;
}

const ANALYTICS_VERSION = '1';

let queue: Array<Record<string, unknown>> = [];
let diagQueue: DiagEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;
// Last settings we were told about, so the deferred flush carries the same consent.
let lastSettings: Settings | null = null;

/** Consent object sent to the server (scope-specific, never a bare boolean). */
export function analyticsConsentPayload(settings: Settings): { granted: true; version: string; scope: 'analytics' } | null {
  if (!settings.analyticsConsent) return null;
  return { granted: true, version: ANALYTICS_VERSION, scope: 'analytics' };
}

function schedule(): void {
  if (!SYNC_ENABLED || timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushTelemetry(lastSettings ?? undefined);
  }, 2000);
}

/** Always-allowed anonymous diagnostics (never caller PII). */
export function recordDiag(e: DiagEvent): void {
  if (!SYNC_ENABLED) return;
  diagQueue.push(e);
  if (diagQueue.length > 50) diagQueue = diagQueue.slice(-50);
  schedule();
}

/**
 * Optional analytics. A no-op unless the caller passes the *current* settings
 * with analytics consent on — so a revoked consent stops events immediately.
 */
export function recordAnalytics(settings: Settings, e: AnalyticsEvent): void {
  if (!SYNC_ENABLED) return;
  lastSettings = settings;
  if (!analyticsConsentPayload(settings)) return;
  queue.push({ ...e });
  if (queue.length > 100) queue = queue.slice(-100);
  schedule();
}

export async function flushTelemetry(settings?: Settings): Promise<void> {
  if (!SYNC_ENABLED || sending) return;
  sending = true;
  try {
    const consent = settings ? analyticsConsentPayload(settings) : null;
    // Consent revoked: never transmit analytics, not even ones queued earlier.
    if (settings && !consent) queue = [];
    const events: Array<Record<string, unknown>> = [
      ...diagQueue.map((d) => ({ ...d, channel: 'diag' })),
      ...(consent || !settings ? queue.map((a) => ({ ...a, channel: 'analytics' })) : []),
    ];
    if (events.length === 0) return;
    const body: Record<string, unknown> = { events };
    if (consent) body.consent = consent;
    const res = await fetch(`${API_BASE}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean };
      // Keep analytics queued when the server refused (no consent): they will
      // be dropped on revoke, never resent implicitly.
      if (data.ok !== false) {
        diagQueue = [];
        queue = [];
      } else {
        diagQueue = [];
        queue = [];
      }
    }
  } catch {
    /* offline: keep the queue for the next flush */
  } finally {
    sending = false;
  }
}

/** Drop every queued event (used on consent revoke / erase). */
export function clearTelemetryQueue(): void {
  queue = [];
  diagQueue = [];
}
