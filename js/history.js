// History and trends: works out how things went over a range of days.
// Pure functions on the saved state, so they can be tested without a browser.
import { addDays, diffDays, formatMinutes, fromKey } from './dates.js';
import { describeSchedule, getEntry, isDayOff, isRepeating, itemsForDay } from './model.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (key) => { const d = fromKey(key); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

// The first day anything was recorded, so "All time" has a start.
export function firstRecordedDay(state, todayKey) {
  const keys = Object.keys(state.days).filter((k) => k <= todayKey).sort();
  const created = state.tasks.map((t) => t.createdAt).filter(Boolean).sort((a, b) => a - b)[0];
  let first = keys[0] || todayKey;
  if (created) {
    const d = new Date(created);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (k < first) first = k;
  }
  return first;
}

// A day counts an item as done when it was finished that day.
function doneThatDay(item, key) {
  const e = item.entry;
  return e.done && (e.doneOn ? e.doneOn === key : item.ref.start === key);
}

export function computeHistory(state, fromKey, toKey, todayKey) {
  if (toKey > todayKey) toKey = todayKey;
  const historyStart = state.settings?.historyStart;
  if (historyStart && fromKey < historyStart) fromKey = historyStart;
  if (fromKey > toKey) fromKey = toKey;
  const days = [];
  const runs = new Map(); // one entry per run of a task (a multi-day run counts once)
  const firstSeen = new Map(); // first day each task was on the list in this range

  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
    const items = itemsForDay(state, key, todayKey);
    const dayOff = isDayOff(state, key);
    let total = 0;
    let done = 0;
    let skipped = 0;
    for (const item of items) {
      if (item.entry.skipped) skipped++;
      else {
        total++;
        if (doneThatDay(item, key)) done++;
      }
      if (!firstSeen.has(item.task.id)) firstSeen.set(item.task.id, key);
      const id = `${item.task.id}|${item.ref.start}`;
      const run = runs.get(id) || { task: item.task, start: item.ref.start, lastDay: key, dayOff: false };
      run.lastDay = key;
      if (dayOff) run.dayOff = true;
      runs.set(id, run);
    }
    // On a day off only what got done counts; nothing is missed.
    days.push({ key, total: dayOff ? done : total, done, skipped, dayOff });
  }

  // Per task results.
  const byTask = new Map();
  for (const run of runs.values()) {
    const entry = getEntry(state, run.start, run.task);
    const t = byTask.get(run.task.id) || {
      task: run.task, done: 0, missed: 0, skipped: 0, open: 0,
      levels: {}, minutes: 0, goal: 0, goalMet: 0, timeRuns: 0, doneDays: [], excused: 0,
    };
    const finished = entry.done && (!entry.doneOn || entry.doneOn <= toKey);
    if (entry.skipped) t.skipped++;
    else if (!finished && run.dayOff) t.excused++; // fell on a day off
    else if (entry.done && (!entry.doneOn || entry.doneOn <= toKey)) {
      t.done++;
      t.doneDays.push(entry.doneOn || run.start);
      if (run.task.levels?.length && entry.level != null) {
        const name = run.task.levels[entry.level] ?? `Level ${entry.level + 1}`;
        t.levels[name] = (t.levels[name] || 0) + 1;
      }
    } else if (run.lastDay === todayKey) t.open++; // still today's to-do, not missed yet
    else t.missed++;
    if (run.task.timeGoal && !(run.dayOff && !finished)) {
      t.timeRuns++;
      t.minutes += entry.minutes || 0;
      t.goal += entry.goal || 0;
      if (entry.goal && (entry.minutes || 0) >= entry.goal) t.goalMet++;
    }
    byTask.set(run.task.id, t);
  }

  const tasks = [...byTask.values()].map((t) => ({
    ...t,
    days: diffDays(firstSeen.get(t.task.id), toKey) + 1, // days the task existed in this range
    counted: t.done + t.missed,
    rate: t.done + t.missed ? t.done / (t.done + t.missed) : null,
  }));
  const repeating = tasks.filter((t) => isRepeating(t.task))
    .sort((a, b) => (a.task.order ?? 0) - (b.task.order ?? 0));
  const oneTime = tasks.filter((t) => !isRepeating(t.task));
  const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);

  const overallDone = sum(tasks, (t) => t.done);
  const overallMissed = sum(tasks, (t) => t.missed);
  const pastDays = days.filter((d) => d.key < todayKey);

  return {
    fromKey,
    toKey,
    dayCount: days.length,
    days,
    repeating,
    oneTime: {
      done: sum(oneTime, (t) => t.done),
      missed: sum(oneTime, (t) => t.missed),
      open: sum(oneTime, (t) => t.open),
      tasks: oneTime,
    },
    overall: {
      done: overallDone,
      missed: overallMissed,
      skipped: sum(tasks, (t) => t.skipped),
      open: sum(tasks, (t) => t.open),
      rate: overallDone + overallMissed ? overallDone / (overallDone + overallMissed) : null,
      perfectDays: pastDays.filter((d) => !d.dayOff && d.total > 0 && d.done === d.total).length,
      activeDays: pastDays.filter((d) => !d.dayOff && d.total > 0).length,
      daysOff: days.filter((d) => d.dayOff).length,
      minutes: sum(tasks, (t) => t.minutes),
      goalMinutes: sum(tasks, (t) => t.goal),
    },
  };
}

// Group days into weeks for long ranges so the chart stays readable.
export function weeklyBuckets(days) {
  const out = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    out.push({
      key: chunk[0].key,
      endKey: chunk[chunk.length - 1].key,
      total: chunk.reduce((n, d) => n + d.total, 0),
      done: chunk.reduce((n, d) => n + d.done, 0),
    });
  }
  return out;
}

export function perWeek(count, dayCount) {
  return dayCount ? (count / dayCount) * 7 : 0;
}

const pct = (r) => (r == null ? 'n/a' : `${Math.round(r * 100)}%`);

// Plain-text report to paste into Claude (or anywhere) for a written summary.
export function reportText(h) {
  const lines = [];
  const y1 = fromKey(h.fromKey).getFullYear();
  const y2 = fromKey(h.toKey).getFullYear();
  const from = y1 === y2 ? shortDate(h.fromKey) : `${shortDate(h.fromKey)}, ${y1}`;
  lines.push(`My to-do history: ${from} to ${shortDate(h.toKey)}, ${y2} (${h.dayCount} days)`);
  lines.push('');
  const o = h.overall;
  lines.push(`Overall: ${pct(o.rate)} of tasks done (${o.done} done, ${o.missed} missed, ${o.skipped} skipped${o.open ? `, ${o.open} still open today` : ''}).`);
  lines.push(`Everything done on ${o.perfectDays} of ${o.activeDays} days.`);
  if (o.daysOff) lines.push(`Days off (sick, travel, etc., not counted): ${o.daysOff}.`);
  if (o.goalMinutes) lines.push(`Time logged: ${formatMinutes(o.minutes)} of ${formatMinutes(o.goalMinutes)} planned.`);
  lines.push('');
  lines.push('Repeating tasks:');
  for (const t of h.repeating) {
    const bits = [`${t.done} of ${t.counted} done (${pct(t.rate)})`];
    bits.push(`about ${perWeek(t.done, t.days).toFixed(1)} times per week`);
    if (t.skipped) bits.push(`${t.skipped} skipped`);
    const lv = Object.entries(t.levels);
    if (lv.length) bits.push(`levels done: ${lv.map(([n, c]) => `${n} ${c}`).join(', ')}`);
    if (t.task.timeGoal) bits.push(`time: ${formatMinutes(t.minutes)} of ${formatMinutes(t.goal)} goal, goal met ${t.goalMet} of ${t.timeRuns} times`);
    lines.push(`- ${t.task.title} (${describeSchedule(t.task)}): ${bits.join('; ')}.`);
  }
  if (!h.repeating.length) lines.push('- none');
  lines.push('');
  const ot = h.oneTime;
  lines.push(`One-time tasks: ${ot.done} done, ${ot.missed} not done${ot.open ? `, ${ot.open} open today` : ''}.`);
  const missedOnce = ot.tasks.filter((t) => t.missed).map((t) => t.task.title);
  if (missedOnce.length) lines.push(`Not done: ${missedOnce.join(', ')}.`);
  lines.push('');
  if (h.dayCount > 60) {
    lines.push('Week by week (done / on the list):');
    lines.push(weeklyBuckets(h.days).filter((w) => w.total).map((w) => `week of ${shortDate(w.key)} ${w.done}/${w.total}`).join(', ') || 'no tasks yet');
  } else {
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    lines.push('Day by day (done / on the list):');
    lines.push(h.days.filter((d) => d.total).map((d) => `${wd[fromKey(d.key).getDay()]} ${shortDate(d.key)} ${d.done}/${d.total}`).join(', ') || 'no tasks yet');
  }
  lines.push('');
  lines.push('Please write a short summary of how I did: what went well, which tasks I keep missing, any patterns (like weekdays vs weekends), and one or two practical suggestions.');
  return lines.join('\n');
}

// Never start before the app was first used, so long ranges aren't padded with empty days.
export function rangeStart(range, todayKey, state) {
  const first = firstRecordedDay(state, todayKey);
  if (range === 'all') return first;
  const start = addDays(todayKey, -(Number(range) - 1));
  return start < first ? first : start;
}

export { diffDays };
