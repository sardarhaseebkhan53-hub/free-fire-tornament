// Web Push client (PHASE 19) — permission, subscription, and the server handshake.
//
// Three separate things are negotiated here, and conflating them is how push code
// usually rots:
//   1. does the browser support push at all          (feature detection)
//   2. does the deployment want to send it           (GET /api/push/config — VAPID keys)
//   3. did THIS user allow notifications on THIS device (Notification.permission)
// Only when all three are true do we subscribe. Anything else is reported back to the
// caller as a plain, honest message — no "success" toasts on a channel that never fires.
import { api, apiGet } from '@/lib/client-api';

export interface PushConfig {
  enabled: boolean;
  publicKey?: string | null;
}

export interface PushActionResult {
  ok: boolean;
  message: string;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushConfig(): Promise<PushConfig> {
  // apiGet never throws: an unreachable API must not break the page that asked.
  return (await apiGet<PushConfig>('/push/config')) ?? { enabled: false, publicKey: null };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Backed by an explicit ArrayBuffer: since TS 5.7 the default `Uint8Array` alias is
  // `Uint8Array<ArrayBufferLike>`, which `pushManager.subscribe` rejects at compile time.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function keysOf(sub: PushSubscription): { p256dh: string; auth: string } | null {
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
  if (!json.keys?.p256dh || !json.keys?.auth) return null;
  return { p256dh: json.keys.p256dh, auth: json.keys.auth };
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // Prefer the app shell's existing registration; only register if there is none, so
  // this module never fights the platform over who owns /sw.js.
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.pushManager) return existing;
  if (!existing) {
    try {
      return (await navigator.serviceWorker.register('/sw.js')) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Ask for permission, subscribe this device, register the endpoint.
 * Idempotent: an already-subscribed device just re-POSTs the same endpoint (the server
 * upserts by endpoint), so a second click is a repair, never a duplicate.
 */
export async function enablePush(): Promise<PushActionResult> {
  if (!pushSupported()) return { ok: false, message: 'This browser does not support push alerts.' };
  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) {
    return { ok: false, message: 'Device alerts are not enabled on this deployment yet.' };
  }
  if (Notification.permission === 'denied') {
    return {
      ok: false,
      message: 'Your browser is blocking notifications for this site. Re-enable them in site settings, then try again.',
    };
  }
  if (Notification.permission !== 'granted') {
    const asked = await Notification.requestPermission();
    if (asked !== 'granted') return { ok: false, message: 'Notification permission was not granted.' };
  }
  const reg = await registration();
  if (!reg?.pushManager) return { ok: false, message: 'The offline service worker is not available in this browser.' };

  try {
    const existingSub = await reg.pushManager.getSubscription();
    const sub =
      existingSub ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      }));
    const keys = keysOf(sub);
    if (!keys) return { ok: false, message: 'The browser returned an incomplete subscription key set.' };
    await api('/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint, ...keys } });
    return { ok: true, message: 'Device alerts are on — match and room alerts will reach you.' };
  } catch (e) {
    // Surface the real reason (a blocked/incompatible push service is a common one on
    // desktop Linux and hardened browsers) rather than a generic failure.
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Could not subscribe this device: ${detail}` };
  }
}

/** Unsubscribe this device: drop the local subscription AND tell the server, so the
 * row does not linger as a dead address that the sender has to prune later. */
export async function disablePush(): Promise<PushActionResult> {
  if (!pushSupported()) return { ok: false, message: 'This browser does not support push alerts.' };
  let endpoint: string | null = null;
  try {
    const reg = await registration();
    const sub = reg?.pushManager ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      endpoint = sub.endpoint;
      await sub.unsubscribe();
    }
  } catch {
    /* the local side failed — still ask the server to forget us */
  }
  try {
    await api('/push/subscribe', { method: 'DELETE', body: endpoint ? { endpoint } : {} });
  } catch {
    /* the server prunes dead endpoints on its own; a lost row here is not user-visible */
  }
  return { ok: true, message: 'Device alerts are off.' };
}

/**
 * Re-announce an already-granted subscription (app boot, or after the server told us the
 * endpoint expired). Never asks for permission — a background sync that pops a prompt is
 * the classic way apps lose users' trust.
 */
export async function resyncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const config = await getPushConfig();
    if (!config.enabled || !config.publicKey) return;
    const reg = await registration();
    const sub = reg?.pushManager ? await reg.pushManager.getSubscription() : null;
    if (!sub) {
      const fresh = await reg!.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      });
      const keys = keysOf(fresh);
      if (keys) await api('/push/subscribe', { method: 'POST', body: { endpoint: fresh.endpoint, ...keys } });
      return;
    }
    const keys = keysOf(sub);
    if (keys) await api('/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint, ...keys } });
  } catch {
    /* boot-time best effort; the toggle in the bell panel stays the manual path */
  }
}
