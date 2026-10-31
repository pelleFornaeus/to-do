// Keeps this device in step with your other devices through Supabase.
// Everything still works offline: changes wait here and go up when you're back online.
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';
import { applyRecord, diff, remoteWins } from './records.js';

const SESSION_KEY = 'todo-app.session';
const META_KEY = 'todo-app.sync';
const PAGE = 1000;

const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const keep = (k, v) => {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ }
};

let session = load(SESSION_KEY);
// meta: what this device last saw of each record, and what still has to be sent.
let meta = load(META_KEY);
let store = null;
let onRemote = () => {};
let timer = null;
let running = null;
let again = false;

const status = { state: session ? 'idle' : 'off', lastSync: meta?.lastSync || null, error: '' };
const statusListeners = new Set();
function setStatus(state, error = '') {
  status.state = state;
  status.error = error;
  if (state === 'ok') { status.lastSync = Date.now(); if (meta) { meta.lastSync = status.lastSync; keep(META_KEY, meta); } }
  statusListeners.forEach((fn) => fn(status));
}

class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function errorText(data, code) {
  const m = data?.error_description || data?.msg || data?.message || data?.error || `Error ${code}`;
  if (/Could not find the table|relation .* does not exist|PGRST205/i.test(`${m} ${data?.code || ''}`)) {
    return 'The sync table isn’t set up in Supabase yet.';
  }
  if (/Invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first (check your inbox), then sign in.';
  return m;
}

async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}, retried = false) {
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...headers };
  if (auth) {
    if (!session) throw new ApiError('Not signed in', 401);
    if (session.expires_at && session.expires_at * 1000 < Date.now() + 60_000) await refresh();
    h.Authorization = `Bearer ${session.access_token}`;
  }
  const res = await fetch(SUPABASE_URL + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (res.status === 401 && auth && !retried) {
    await refresh();
    return request(path, { method, body, auth, headers }, true);
  }
  if (!res.ok) throw new ApiError(errorText(data, res.status), res.status);
  return data;
}

function setSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user?.id, email: data.user?.email },
  };
  keep(SESSION_KEY, session);
}

async function refresh() {
  try {
    const data = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', auth: false, body: { refresh_token: session.refresh_token },
    });
    setSession(data);
  } catch (e) {
    if (e instanceof ApiError) {
      // The sign-in has run out. Keep the data on this device and ask to sign in again.
      session = null;
      keep(SESSION_KEY, null);
      setStatus('off', 'Please sign in again to keep syncing.');
    }
    throw e;
  }
}

// ---------- Tracking local changes ----------

function freshMeta(userId) {
  return { userId, snap: {}, mods: {}, dirty: {}, lastPull: null, lastSync: null };
}

// Note what changed on this device since last time. Returns true if anything did.
function trackLocal(mod = Date.now()) {
  if (!meta || !store) return false;
  const { changed, removed, json } = diff(meta.snap, store.state);
  for (const k of changed) { meta.snap[k] = json[k]; meta.mods[k] = mod; meta.dirty[k] = true; }
  for (const k of removed) { delete meta.snap[k]; meta.mods[k] = mod; meta.dirty[k] = true; }
  if (changed.length || removed.length) { keep(META_KEY, meta); return true; }
  return false;
}

// First sync on this device: send what's here, but let what's already online win
// where both have the same thing.
function startTracking() {
  meta = freshMeta(session.user.id);
  trackLocal(0);
}

// ---------- Syncing ----------

async function pull() {
  let since = meta.lastPull;
  // A little overlap, so nothing saved at the same moment is missed. Repeats are skipped.
  if (since) since = new Date(new Date(since).getTime() - 10_000).toISOString();
  let rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = `/rest/v1/records?select=key,data,deleted,mod,server_at&order=server_at.asc,key.asc&limit=${PAGE}&offset=${offset}${since ? `&server_at=gt.${encodeURIComponent(since)}` : ''}`;
    const page = await request(q);
    rows = rows.concat(page);
    if (page.length < PAGE) break;
  }
  // Day info last, so a cleared day isn't brought back by its own entries.
  rows.sort((a, b) => (a.key.startsWith('d|') ? 1 : 0) - (b.key.startsWith('d|') ? 1 : 0));
  let changed = false;
  for (const row of rows) {
    if (!meta.lastPull || row.server_at > meta.lastPull) meta.lastPull = row.server_at;
    const known = meta.mods[row.key] === Number(row.mod) && !meta.dirty[row.key];
    if (known || !remoteWins(meta, row.key, Number(row.mod))) continue;
    applyRecord(store.state, row.key, row.deleted ? undefined : row.data);
    if (row.deleted) delete meta.snap[row.key];
    else meta.snap[row.key] = JSON.stringify(row.data);
    meta.mods[row.key] = Number(row.mod);
    delete meta.dirty[row.key];
    changed = true;
  }
  keep(META_KEY, meta);
  return changed;
}

async function push() {
  const keys = Object.keys(meta.dirty);
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500).map((key) => ({
      user_id: meta.userId,
      key,
      data: key in meta.snap ? JSON.parse(meta.snap[key]) : null,
      deleted: !(key in meta.snap),
      mod: meta.mods[key] ?? 0,
    }));
    await request('/rest/v1/records?on_conflict=user_id,key', {
      method: 'POST',
      body: batch,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    // Only clear what didn't change again while it was being sent.
    for (const row of batch) if (meta.mods[row.key] === row.mod) delete meta.dirty[row.key];
    keep(META_KEY, meta);
  }
}

async function runSync() {
  if (!session || !store) return;
  if (!meta || meta.userId !== session.user.id) startTracking();
  if (!navigator.onLine) { setStatus('offline'); return; }
  setStatus('syncing');
  try {
    trackLocal();
    const changed = await pull();
    if (changed) {
      onRemote(); // saves and redraws
      trackLocal(); // anything merged (like a combined list) goes back up
    }
    await push();
    setStatus('ok');
  } catch (e) {
    if (e instanceof ApiError) {
      if (session) setStatus('error', e.message);
    } else setStatus('offline');
  }
}

function syncNow() {
  if (running) { again = true; return running; }
  running = runSync().finally(() => {
    running = null;
    if (again) { again = false; syncNow(); }
  });
  return running;
}

function schedule(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export const sync = {
  get user() { return session?.user || null; },
  get status() { return status; },
  onStatus(fn) { statusListeners.add(fn); },

  init(s, onRemoteChange) {
    store = s;
    onRemote = onRemoteChange;
    store.subscribe(() => { if (session && trackLocal()) schedule(); });
    window.addEventListener('online', () => syncNow());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    // Pick up changes from your other devices while the app is open.
    setInterval(() => { if (session && document.visibilityState === 'visible') syncNow(); }, 30_000);
    if (session) syncNow();
  },

  async signIn(email, password) {
    const data = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', auth: false, body: { email, password },
    });
    setSession(data);
    if (meta?.userId !== session.user.id) startTracking();
    return syncNow();
  },

  // Returns { confirm: true } when Supabase wants the email confirmed first.
  async signUp(email, password) {
    const data = await request('/auth/v1/signup', { method: 'POST', auth: false, body: { email, password } });
    if (!data?.access_token) return { confirm: true };
    setSession(data);
    startTracking();
    await syncNow();
    return { confirm: false };
  },

  async signOut() {
    try { await request('/auth/v1/logout', { method: 'POST' }); } catch { /* signed out here anyway */ }
    session = null;
    meta = null;
    keep(SESSION_KEY, null);
    keep(META_KEY, null);
    setStatus('off');
  },

  syncNow,
  pending() { return meta ? Object.keys(meta.dirty).length : 0; },
};
