// Supabase Edge Function "todo-reminders": sends the to-do app's phone notifications.
// Deploy it in the Supabase dashboard (Edge Functions → Deploy a new function → Via Editor),
// name it exactly todo-reminders, paste this file in, and turn "Verify JWT" OFF.
//
// It uses the app's own code straight from the published site, so it always agrees with
// the app about what's on today's list. Redeploy it after big app updates.
//
//   GET  ?vapid              → { publicKey } (made on first use and kept in push_config)
//   POST { action: "test" }  → sends a test notification to the signed-in person's devices
//   POST from the scheduler  → sends whatever is due (needs the x-cron-secret header)

// @ts-nocheck
import { dueReminders, stateFromRows } from 'https://pellefornaeus.github.io/to-do/supabase/functions/todo-reminders/due.js';
import { makeVapidKeys, sendPush } from 'https://pellefornaeus.github.io/to-do/supabase/functions/todo-reminders/push.js';

const SITE = 'https://pellefornaeus.github.io/to-do';

const URL_BASE = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function config(key: string) {
  const rows = await db(`push_config?key=eq.${key}&select=value`);
  return rows[0]?.value ?? null;
}

async function vapidKeys() {
  const saved = await config('vapid');
  if (saved) return JSON.parse(saved);
  const keys = await makeVapidKeys();
  await db('push_config?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ key: 'vapid', value: JSON.stringify(keys) }),
  });
  return JSON.parse(await config('vapid')); // in case two requests raced
}

async function userFromToken(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const res = await fetch(`${URL_BASE}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: auth } });
  if (!res.ok) return null;
  return (await res.json())?.id ?? null;
}

async function rowsFor(userId: string) {
  let rows: { key: string; data: unknown }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db(`records?user_id=eq.${userId}&deleted=eq.false&select=key,data&order=key&limit=1000&offset=${offset}`);
    rows = rows.concat(page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function sendTo(subs: any[], data: unknown, vapid: any) {
  let sent = 0;
  for (const s of subs) {
    try {
      const status = await sendPush(s.sub, data, vapid);
      if (status === 404 || status === 410) {
        await db(`push_subs?user_id=eq.${s.user_id}&endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
      } else if (status < 300) sent++;
      else console.log('push failed', status);
    } catch (e) {
      console.log('push error', String(e));
    }
  }
  return sent;
}

async function runReminders() {
  const vapid = await vapidKeys();
  const subs = await db('push_subs?select=user_id,endpoint,sub,tz');
  const byUser = new Map<string, any[]>();
  for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) || []), s]);
  let total = 0;
  for (const [userId, userSubs] of byUser) {
    const state = stateFromRows(await rowsFor(userId));
    const due = dueReminders(state, new Date(), userSubs[0].tz || 'UTC');
    for (const n of due) {
      // Only once per reminder per day, even though this runs every 5 minutes.
      const fresh = await db('push_sent?on_conflict=user_id,tag', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ user_id: userId, tag: n.tag, day: n.day }),
      });
      if (!fresh?.length) continue;
      total += await sendTo(userSubs, { title: n.title, body: n.body, tag: n.tag, url: `${SITE}/` }, vapid);
    }
  }
  // Tidy up old "already sent" notes.
  const weekAgo = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10);
  await db(`push_sent?day=lt.${weekAgo}`, { method: 'DELETE' });
  return total;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.searchParams.has('vapid')) {
      return json({ publicKey: (await vapidKeys()).publicKey });
    }
    if (req.method !== 'POST') return json({ error: 'Not found' }, 404);

    const cronSecret = req.headers.get('x-cron-secret');
    if (cronSecret) {
      if (cronSecret !== (await config('cron_secret'))) return json({ error: 'Wrong secret' }, 401);
      return json({ sent: await runReminders() });
    }

    const body = await req.json().catch(() => ({}));
    if (body.action === 'test') {
      const userId = await userFromToken(req);
      if (!userId) return json({ error: 'Please sign in again.' }, 401);
      const subs = await db(`push_subs?user_id=eq.${userId}&select=user_id,endpoint,sub,tz`);
      if (!subs.length) return json({ error: 'No devices are set up for notifications yet.' }, 400);
      const sent = await sendTo(subs, { title: 'Notifications are on 🎉', body: 'Reminders from your to-do list will show up like this.', tag: 'test', url: `${SITE}/` }, await vapidKeys());
      return json({ sent });
    }
    return json({ error: 'Unknown request' }, 400);
  } catch (e) {
    console.log('error', String(e));
    return json({ error: String(e) }, 500);
  }
});
