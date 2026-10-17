import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/platform/settings/store';

// §15 telemetry: consent gating. The config module is mocked so SYNC_ENABLED is
// true here even though unit tests run without a backend URL.
vi.mock('../../src/platform/api/config', () => ({ API_BASE: 'http://api.test', SYNC_ENABLED: true }));

const base: Settings = { ...DEFAULT_SETTINGS };

describe('§15 telemetry consent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('analyticsConsentPayload is null without consent and versioned with it', async () => {
    const { analyticsConsentPayload } = await import('../../src/platform/telemetry');
    expect(analyticsConsentPayload(base)).toBeNull();
    const on = analyticsConsentPayload({ ...base, analyticsConsent: true });
    expect(on).toMatchObject({ granted: true, scope: 'analytics' });
  });

  it('drops analytics events entirely when consent is off', async () => {
    const { recordAnalytics, flushTelemetry } = await import('../../src/platform/telemetry');
    recordAnalytics(base, { type: 'game_open', gameId: 'plumber' });
    await flushTelemetry(base);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends an analytics event tagged with its channel only with consent', async () => {
    const { recordAnalytics, flushTelemetry } = await import('../../src/platform/telemetry');
    const on: Settings = { ...base, analyticsConsent: true };
    recordAnalytics(on, { type: 'level_start', gameId: 'plumber', mode: 'normal', level: 3 });
    await flushTelemetry(on);
    expect(fetch).toHaveBeenCalledTimes(1);
    const call = (fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0];
    expect(call[0]).toContain('/telemetry');
    const body = JSON.parse(call[1].body as string) as { events: Array<Record<string, unknown>>; consent?: Record<string, unknown> };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ type: 'level_start', channel: 'analytics', level: 3 });
    expect(body.consent).toMatchObject({ scope: 'analytics' });
  });

  it('revoking consent clears the queue so nothing stale is sent', async () => {
    const { recordAnalytics, flushTelemetry, clearTelemetryQueue } = await import('../../src/platform/telemetry');
    const on: Settings = { ...base, analyticsConsent: true };
    recordAnalytics(on, { type: 'game_open', gameId: 'plumber' });
    clearTelemetryQueue();
    recordAnalytics(on, { type: 'game_open', gameId: 'water-sort' });
    await flushTelemetry(base);
    expect(fetch).not.toHaveBeenCalled();
  });
});
