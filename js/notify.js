// Phone notifications for reminders. The server (Supabase function "todo-reminders")
// decides when to send them; this file turns them on or off for this device.
import { sync } from './sync.js';

const FN = '/functions/v1/todo-reminders';
const KEY = 'todo-app.push';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iPhone only allows notifications for apps opened from the home screen.
export function isHomeScreenApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function pushOn() {
  try { return localStorage.getItem(KEY) === 'on' && Notification.permission === 'granted'; } catch { return false; }
}

const fromB64url = (str) => {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

function friendly(e) {
  if (e instanceof TypeError) return 'Couldn’t reach the reminder service. Check that the “todo-reminders” function is set up in Supabase (see the README).';
  return e.message || String(e);
}

export async function enablePush() {
  if (!sync.user) throw new Error('Sign in under Sync first.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your phone’s Settings → Notifications → To-Do.');
  try {
    const { publicKey, error } = await sync.request(`${FN}?vapid`);
    if (!publicKey) throw new Error(error || 'The reminder service didn’t answer.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Make sure it belongs to this server's key.
      const key = sub.options?.applicationServerKey;
      if (key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(publicKey) });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    await sync.request('/rest/v1/push_subs?on_conflict=user_id,endpoint', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { user_id: sync.user.id, endpoint: sub.endpoint, sub: sub.toJSON(), tz },
    });
    localStorage.setItem(KEY, 'on');
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      if (sync.user) {
        await sync.request(`/rest/v1/push_subs?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(() => {});
      }
      await sub.unsubscribe();
    }
  } finally {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }
}

export async function testPush() {
  try {
    const res = await sync.request(FN, { method: 'POST', body: { action: 'test' } });
    if (res?.error) throw new Error(res.error);
    return res?.sent || 0;
  } catch (e) {
    throw new Error(friendly(e));
  }
}

// Keep the server's copy of this device's time zone current (e.g. after travel).
export async function refreshPush() {
  if (!pushOn() || !sync.user) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { localStorage.removeItem(KEY); return; }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    await sync.request('/rest/v1/push_subs?on_conflict=user_id,endpoint', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { user_id: sync.user.id, endpoint: sub.endpoint, sub: sub.toJSON(), tz },
    });
  } catch { /* try again next time */ }
}
