// §15 notifications. Real browser push only: it never fabricates a success
// toast and never requests permission on load — permission is requested from an
// explicit user action. Without deployment VAPID credentials live delivery is
// honestly reported as pending (BLOCKED_EXTERNAL); the subscribe/unsubscribe
// path and permission handling are fully implemented and testable.
import { API_BASE, SYNC_ENABLED } from './api/config';

export interface PushState {
  supported: boolean;
  reason?: 'no-service-worker' | 'no-push-manager' | 'no-notification-api';
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  configured: boolean;
  delivery: 'ready' | 'pending-deployment' | 'unsupported';
}

const VAPID_PUBLIC = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';

function notificationApi(): typeof Notification | undefined {
  return typeof Notification !== 'undefined' ? Notification : undefined;
}

export function vapidKey(): string {
  return VAPID_PUBLIC;
}

export function isConfigured(): boolean {
  return VAPID_PUBLIC.length > 0 && SYNC_ENABLED;
}

export async function pushState(): Promise<PushState> {
  const n = notificationApi();
  const permission: PushState['permission'] = n ? n.permission : 'unsupported';
  if (!('serviceWorker' in navigator)) return { supported: false, reason: 'no-service-worker', permission, subscribed: false, configured: isConfigured(), delivery: 'unsupported' };
  if (!('PushManager' in window)) return { supported: false, reason: 'no-push-manager', permission, subscribed: false, configured: isConfigured(), delivery: 'unsupported' };
  if (!n) return { supported: false, reason: 'no-notification-api', permission, subscribed: false, configured: isConfigured(), delivery: 'unsupported' };
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    subscribed = !!sub;
  } catch {
    subscribed = false;
  }
  const configured = isConfigured();
  return { supported: true, permission, subscribed, configured, delivery: configured ? (subscribed ? 'ready' : 'pending-deployment') : 'pending-deployment' };
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Explicit opt-in. Requests permission only here, subscribes via the real
 * PushManager, and registers the subscription with the server. Returns an
 * honest result: `pending-deployment` when no VAPID key is configured.
 */
export async function enableNotifications(): Promise<{ ok: boolean; state: PushState; reason?: string }> {
  const before = await pushState();
  if (!before.supported) return { ok: false, state: before, reason: before.reason };
  const n = notificationApi()!;
  let permission = n.permission;
  if (permission === 'default') permission = await n.requestPermission();
  if (permission !== 'granted') return { ok: false, state: { ...(await pushState()), permission }, reason: 'permission-denied' };
  if (!isConfigured()) {
    // Permission granted, but live delivery needs server credentials. We do not
    // fake a subscription; the UI shows the pending state honestly.
    return { ok: true, state: { ...(await pushState()), delivery: 'pending-deployment' }, reason: 'no-vapid' };
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as unknown as BufferSource }));
    const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
    await fetch(`${API_BASE}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: { endpoint: json.endpoint, keys: json.keys } }),
    });
    return { ok: true, state: await pushState() };
  } catch (err) {
    return { ok: false, state: await pushState(), reason: err instanceof Error ? err.name : 'subscribe-failed' };
  }
}

export async function disableNotifications(): Promise<{ ok: boolean; state: PushState }> {
  if (!('serviceWorker' in navigator)) return { ok: true, state: await pushState() };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      if (SYNC_ENABLED) {
        await fetch(`${API_BASE}/push/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
      }
    }
  } catch {
    /* ignore: unsubscribe is best-effort */
  }
  return { ok: true, state: await pushState() };
}
