import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/platform/api/config', () => ({ API_BASE: 'http://api.test', SYNC_ENABLED: true }));

function setGlobals(opts: { navigator?: unknown; window?: unknown; Notification?: unknown }): void {
  if ('navigator' in opts) vi.stubGlobal('navigator', opts.navigator);
  if ('window' in opts) vi.stubGlobal('window', opts.window);
  if ('Notification' in opts) vi.stubGlobal('Notification', opts.Notification);
}

describe('§15 notifications: honest, explicit-only', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('reports unsupported without throwing when the browser lacks push', async () => {
    setGlobals({ navigator: {}, window: {}, Notification: undefined });
    const { pushState, enableNotifications } = await import('../../src/platform/notifications');
    const st = await pushState();
    expect(st.supported).toBe(false);
    expect(['no-service-worker', 'no-push-manager', 'no-notification-api']).toContain(st.reason);
    const r = await enableNotifications();
    expect(r.ok).toBe(false);
  });

  it('importing the module never requests notification permission', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    setGlobals({
      navigator: { serviceWorker: { getRegistration: async () => undefined } },
      window: { PushManager: function PushManager() {} },
      Notification: { permission: 'default', requestPermission },
    });
    await import('../../src/platform/notifications');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('does not fake a subscription when no VAPID key is configured', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://x' }) }));
    setGlobals({
      navigator: { serviceWorker: { getRegistration: async () => undefined, ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe } }) } },
      window: { PushManager: function PushManager() {} },
      Notification: { permission: 'default', requestPermission },
    });
    const { enableNotifications } = await import('../../src/platform/notifications');
    const r = await enableNotifications();
    // Permission is asked from the explicit call, but no VAPID => no subscribe.
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).not.toHaveBeenCalled();
    expect(r.reason).toBe('no-vapid');
    expect(r.state.delivery).toBe('pending-deployment');
  });
});
