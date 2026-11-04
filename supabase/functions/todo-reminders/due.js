// Works out which reminders are due for one person right now.
// Shared by the server function and the tests; uses the app's own logic.
import { itemsForDay, migrate, defaultState } from '../../../js/model.js';
import { applyRecord } from '../../../js/records.js';
import { addDays } from '../../../js/dates.js';

// Rebuild the app's data from synced rows [{ key, data }].
export function stateFromRows(rows) {
  const state = defaultState();
  const sorted = [...rows].sort((a, b) => (a.key.startsWith('d|') ? 1 : 0) - (b.key.startsWith('d|') ? 1 : 0));
  for (const r of sorted) applyRecord(state, r.key, r.data);
  return migrate(state);
}

// Local date and minutes past midnight in a time zone.
export function localNow(date, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    return localNow(date, 'UTC');
  }
  const get = (t) => parts.find((p) => p.type === t).value;
  return { key: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// A reminder fires once, in the 30 minutes after its time (the server checks every 5).
const WINDOW = 30;

export function dueReminders(state, now, timeZone) {
  const { key: calKey, minutes } = localNow(now, timeZone);
  const startHour = state.settings?.dayStartHour ?? 3;
  // Before the day rolls over, it's still the previous day's list.
  const today = minutes < startHour * 60 ? addDays(calKey, -1) : calKey;
  const nowMin = minutes < startHour * 60 ? minutes + 24 * 60 : minutes;
  const inWindow = (hhmm) => {
    let t = toMinutes(hhmm);
    if (t == null) return false;
    if (t < startHour * 60) t += 24 * 60;
    return nowMin >= t && nowMin < t + WINDOW;
  };
  const items = itemsForDay(state, today, today);
  const open = items.filter((i) => !i.entry.done && !i.entry.skipped);
  const out = [];
  if (inWindow(state.settings?.summaryAt) && open.length) {
    const names = open.map((i) => i.task.title);
    const body = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
    out.push({ tag: `summary|${today}`, day: today, title: `${open.length} thing${open.length === 1 ? '' : 's'} on your list today`, body });
  }
  for (const i of open) {
    if (!inWindow(i.task.remind)) continue;
    const steps = (i.task.subtasks || []).length;
    out.push({
      tag: `task|${i.task.id}|${today}`,
      day: today,
      title: i.task.title,
      body: i.span > 1 ? `Day ${i.dayNum} of ${i.span}` : steps ? `${steps} steps` : 'Still on your list today',
    });
  }
  return out;
}
