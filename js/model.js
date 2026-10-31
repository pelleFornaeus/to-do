// Core rules for tasks, schedules and daily lists.
// Everything here works on a plain state object so it can be tested without a browser.
//
// state = {
//   version, tasks: [Task], days: { "YYYY-MM-DD": DayRecord }, settings
// }
// Task = {
//   id, title, notes, order, createdAt, updatedAt, archived,
//   schedule: { type: 'once', date } | { type: 'daily' } | { type: 'weekly', days: [0..6] }
//           | { type: 'interval', every } | { type: 'monthly', day },
//   startDate,                       // first day a repeating task applies
//   completedOn,                     // one-time tasks: day it was finished
//   levels: ['Light', ...],          // optional; empty means no levels
//   levelDefault, levelRules: [{ level, weekday, nth }],  (older: levelByDay)
//   subtasks: [{ id, title, in: [levelIndex] }], // which levels include the step (older: level)
//   timeGoal: { minutes, byDay: { weekday: minutes } } | null,
//   spanDays, levelDays: { levelIndex: days }  // multi-day tasks
// }
// DayRecord = { planned: [taskId], items: { taskId: Entry } }  (entries live on a run's first day)
// Entry = { done, doneOn, doneAt, skipped, level, goal, minutes, subs: { subId: true }, timerStartedAt }

import { weekday, diffDays, addDays } from './dates.js';

export const DEFAULT_LEVELS = ['Light', 'Normal', 'Deep', 'Complete'];

export function defaultState() {
  return {
    version: 1,
    tasks: [],
    days: {},
    settings: { dayStartHour: 3, carryOver: true },
  };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function isRepeating(task) {
  return task.schedule && task.schedule.type !== 'once';
}

export function isScheduledOn(task, key) {
  const s = task.schedule || { type: 'once' };
  if (s.type === 'once') return s.date === key;
  if (task.archived) return false;
  if (task.startDate && key < task.startDate) return false;
  switch (s.type) {
    case 'daily':
      return true;
    case 'weekly':
      return (s.days || []).includes(weekday(key));
    case 'interval': {
      const d = diffDays(task.startDate || key, key);
      return d >= 0 && d % Math.max(1, s.every || 1) === 0;
    }
    case 'monthly': {
      const [y, m, dd] = key.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      return dd === Math.min(s.day || 1, lastDay);
    }
    default:
      return false;
  }
}

export function describeSchedule(task) {
  const s = task.schedule || { type: 'once' };
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (s.type) {
    case 'once': return s.date ? `One time · ${s.date}` : 'One time';
    case 'daily': return 'Every day';
    case 'weekly': {
      const days = [...(s.days || [])].sort();
      if (days.length === 7) return 'Every day';
      if (days.join() === '1,2,3,4,5') return 'Weekdays';
      if (days.join() === '0,6') return 'Weekends';
      return days.map((d) => names[d]).join(', ') || 'No days picked';
    }
    case 'interval': return s.every === 1 ? 'Every day' : `Every ${s.every} days`;
    case 'monthly': return `Monthly on day ${s.day}`;
    default: return '';
  }
}

export function hasLevels(task) {
  return Array.isArray(task.levels) && task.levels.length > 0;
}

// Level rules, e.g. { level: 2, weekday: 6, nth: 'every' } = deep clean every Saturday,
// { level: 3, weekday: 6, nth: 'last' } = complete clean on the last Saturday of the month.
// nth is 'every', 1-4 (first..fourth of the month) or 'last'.
export function levelRules(task) {
  if (Array.isArray(task.levelRules)) return task.levelRules;
  // older format: { weekday: level }
  return Object.entries(task.levelByDay || {}).map(([wd, level]) => ({ level, weekday: Number(wd), nth: 'every' }));
}

export function ruleMatches(rule, key) {
  if (weekday(key) !== Number(rule.weekday)) return false;
  const nth = rule.nth ?? 'every';
  if (nth === 'every') return true;
  const [y, m, d] = key.split('-').map(Number);
  if (nth === 'last') return d + 7 > new Date(y, m, 0).getDate();
  return Math.ceil(d / 7) === Number(nth);
}

export function plannedLevel(task, key) {
  if (!hasLevels(task)) return null;
  let idx = task.levelDefault ?? 0;
  let best = -1;
  // A "first/last Saturday" rule beats an "every Saturday" rule; otherwise the later rule wins.
  for (const r of levelRules(task)) {
    if (!ruleMatches(r, key)) continue;
    const score = (r.nth ?? 'every') === 'every' ? 0 : 1;
    if (score >= best) { best = score; idx = Number(r.level); }
  }
  return Math.min(Math.max(0, idx), task.levels.length - 1);
}

export function describeRule(rule, levels) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const nthName = { every: 'Every', 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', last: 'Last' }[rule.nth ?? 'every'];
  const day = days[rule.weekday];
  const when = (rule.nth ?? 'every') === 'every' ? `Every ${day}` : `${nthName} ${day} of the month`;
  return `${levels[rule.level] ?? ''}: ${when}`;
}

// Whether a step is part of a level. Steps either list their levels (`in`),
// or (older format) start at a level and carry on to every level above it.
export function stepInLevel(step, level) {
  if (Array.isArray(step.in)) return step.in.includes(level);
  return (step.level ?? 0) <= level;
}

export function plannedGoal(task, key) {
  if (!task.timeGoal) return null;
  const byDay = task.timeGoal.byDay || {};
  const v = byDay[weekday(key)];
  return v != null && v !== '' ? Number(v) : Number(task.timeGoal.minutes) || 0;
}

// How many days one run of a task takes. A level can take longer than the task
// normally does, e.g. a "Complete" kitchen clean spread over 3 days.
export function spanFor(task, level) {
  if (hasLevels(task) && level != null) {
    const d = Number(task.levelDays?.[level]);
    if (d > 1) return Math.min(d, MAX_SPAN);
  }
  return Math.min(Math.max(1, Number(task.spanDays) || 1), MAX_SPAN);
}

export const MAX_SPAN = 14;

function maxSpanOf(task) {
  let m = spanFor(task, null);
  if (hasLevels(task)) task.levels.forEach((_, i) => { m = Math.max(m, spanFor(task, i)); });
  return m;
}

// Progress for one run of a task is stored on the day the run started (its "start" key),
// so steps and minutes carry across every day of a multi-day task.
export function getEntry(state, start, task) {
  const stored = state.days[start]?.items?.[task.id];
  const base = {
    done: false,
    doneOn: null,
    skipped: false,
    level: plannedLevel(task, start),
    goal: plannedGoal(task, start),
    minutes: 0,
    subs: {},
    timerStartedAt: null,
  };
  return stored ? { ...base, ...stored, subs: { ...(stored.subs || {}) } } : base;
}

function ensureEntry(state, start, task) {
  if (!state.days[start]) state.days[start] = { planned: [], items: {} };
  const day = state.days[start];
  if (!day.items[task.id]) day.items[task.id] = getEntry(state, start, task);
  return day.items[task.id];
}

export function visibleSubtasks(task, entry) {
  const subs = task.subtasks || [];
  if (!hasLevels(task)) return subs;
  const lvl = entry.level ?? 0;
  return subs.filter((s) => stepInLevel(s, lvl));
}

// How a stored entry looks on a particular day: a task finished later shows as
// still open on the earlier days.
function entryAsOf(entry, key) {
  const doneOn = entry.doneOn;
  if (entry.done && doneOn && doneOn > key) return { ...entry, done: false };
  return entry;
}

function finishedBefore(entry, key) {
  return entry.done && entry.doneOn && entry.doneOn < key;
}

// Which run of a repeating task (if any) is on the list for this day.
function repeatingRunOn(state, task, key) {
  // A multi-day run that started earlier and is still going takes priority.
  const max = maxSpanOf(task);
  for (let k = 1; k < max; k++) {
    const start = addDays(key, -k);
    if (!isScheduledOn(task, start)) continue;
    const entry = getEntry(state, start, task);
    const span = spanFor(task, entry.level);
    if (k < span && !finishedBefore(entry, key) && !entry.skipped) {
      return { start, entry, dayNum: k + 1, span };
    }
  }
  if (isScheduledOn(task, key) ||
      // keep history visible for tasks that were deleted later
      (task.archived && state.days[key]?.items?.[task.id])) {
    const entry = getEntry(state, key, task);
    return { start: key, entry, dayNum: 1, span: spanFor(task, entry.level) };
  }
  return null;
}

// Which tasks show on a given day, in display order.
// Each item: { task, entry, ref: { start, on }, dayNum, span, carried }
export function itemsForDay(state, key, todayKey) {
  const out = [];
  const carryOver = state.settings?.carryOver !== false;
  for (const task of state.tasks) {
    const s = task.schedule || { type: 'once' };
    if (s.type === 'once') {
      if (task.archived || !s.date || s.date > key) continue;
      const entry = getEntry(state, s.date, task);
      if (finishedBefore(entry, key)) continue;
      const span = spanFor(task, entry.level);
      const dayNum = diffDays(s.date, key) + 1;
      const doneToday = entry.done && entry.doneOn === key;
      const inSpan = dayNum <= span;
      const carried = !inSpan;
      if (!inSpan && !doneToday && !(carryOver && key === todayKey && !entry.done)) continue;
      out.push({ task, entry: entryAsOf(entry, key), ref: { start: s.date, on: key }, dayNum, span, carried });
    } else {
      const run = repeatingRunOn(state, task, key);
      if (!run) continue;
      out.push({
        task, entry: entryAsOf(run.entry, key), ref: { start: run.start, on: key },
        dayNum: run.dayNum, span: run.span, carried: false,
      });
    }
  }
  out.sort((a, b) => (a.task.order ?? 0) - (b.task.order ?? 0));
  return out;
}

// Remember what was on the list for a day, so later reports know what was planned
// even if a schedule changes afterwards.
export function snapshotPlanned(state, key, todayKey) {
  const ids = itemsForDay(state, key, todayKey).map((i) => i.task.id);
  const day = state.days[key] || { planned: [], items: {} };
  const merged = [...new Set([...(day.planned || []), ...ids])];
  if (!state.days[key] || merged.length !== (day.planned || []).length) {
    state.days[key] = { ...day, planned: merged };
    return true;
  }
  return false;
}

// The actions below take ref = { start, on }: the day the run started (where progress
// is stored) and the day being looked at (when it was finished).
const R = (ref) => (typeof ref === 'string' ? { start: ref, on: ref } : ref);

export function setDone(state, ref, task, done) {
  ref = R(ref);
  const e = ensureEntry(state, ref.start, task);
  e.done = done;
  e.doneOn = done ? ref.on : null;
  e.doneAt = done ? Date.now() : null;
  if (done) e.skipped = false;
  if (task.schedule?.type === 'once') task.completedOn = done ? ref.on : null;
  task.updatedAt = Date.now();
}

export function setSkipped(state, ref, task, skipped) {
  ref = R(ref);
  const e = ensureEntry(state, ref.start, task);
  e.skipped = skipped;
  if (skipped) { e.done = false; e.doneOn = null; e.doneAt = null; }
}

function syncDoneWithSteps(state, ref, task, e) {
  const visible = visibleSubtasks(task, e);
  if (!visible.length) return;
  const allDone = visible.every((s) => e.subs[s.id]);
  if (allDone && !e.done) setDone(state, ref, task, true);
  else if (!allDone && e.done) setDone(state, ref, task, false);
}

export function toggleSub(state, ref, task, subId) {
  ref = R(ref);
  const e = ensureEntry(state, ref.start, task);
  if (e.subs[subId]) delete e.subs[subId];
  else e.subs[subId] = true;
  if (e.skipped) e.skipped = false;
  // Finishing every step finishes the task; unchecking a step reopens it.
  syncDoneWithSteps(state, ref, task, e);
}

export function setLevel(state, ref, task, level) {
  ref = R(ref);
  const e = ensureEntry(state, ref.start, task);
  e.level = level;
  syncDoneWithSteps(state, ref, task, e);
}

export function addMinutes(state, ref, task, minutes) {
  ref = R(ref);
  const e = ensureEntry(state, ref.start, task);
  setMinutes(state, ref, task, (e.minutes || 0) + minutes);
}

export function setMinutes(state, ref, task, minutes) {
  ref = R(ref);
  const e = ensureEntry(state, ref.start, task);
  e.minutes = Math.max(0, Math.round(minutes));
  if (e.goal && e.minutes >= e.goal && !e.done) setDone(state, ref, task, true);
}

export function setGoal(state, ref, task, minutes) {
  ref = R(ref);
  const e = ensureEntry(state, ref.start, task);
  e.goal = Math.max(0, Math.round(minutes));
}

export function startTimer(state, ref, task, now = Date.now()) {
  ref = R(ref);
  ensureEntry(state, ref.start, task).timerStartedAt = now;
}

export function stopTimer(state, ref, task, now = Date.now()) {
  ref = R(ref);
  const e = ensureEntry(state, ref.start, task);
  if (e.timerStartedAt == null) return;
  const mins = (now - e.timerStartedAt) / 60000;
  e.timerStartedAt = null;
  addMinutes(state, ref, task, mins);
}

export function addQuickTask(state, title, key) {
  const task = {
    id: uid(),
    title: title.trim(),
    notes: '',
    order: nextOrder(state),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    schedule: { type: 'once', date: key },
    subtasks: [],
    levels: [],
    timeGoal: null,
  };
  state.tasks.push(task);
  return task;
}

// "tomorrow ship the package" -> { title: "ship the package", key: tomorrow }
export function parseQuickAdd(text, key) {
  const m = text.trim().match(/^(tomorrow|tmrw|tmr)\b[\s,:-]*(.+)$/i);
  if (m) return { title: m[2].trim(), key: addDays(key, 1) };
  return { title: text.trim(), key };
}

export function nextOrder(state) {
  return state.tasks.reduce((m, t) => Math.max(m, t.order ?? 0), 0) + 1;
}

// Move a one-time task to another day, bringing any progress with it.
export function moveOnceTask(state, task, newKey) {
  const old = task.schedule.date;
  const entry = state.days[old]?.items?.[task.id];
  if (entry && old !== newKey) {
    delete state.days[old].items[task.id];
    if (!state.days[newKey]) state.days[newKey] = { planned: [], items: {} };
    state.days[newKey].items[task.id] = entry;
  }
  task.schedule = { ...task.schedule, date: newKey };
  task.updatedAt = Date.now();
}

export function deleteTask(state, task) {
  const used = Object.values(state.days).some((d) => d.items?.[task.id]);
  if (used) {
    // Keep it for history and reports, just hide it.
    task.archived = true;
    task.updatedAt = Date.now();
  } else {
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    for (const d of Object.values(state.days)) {
      if (d.planned) d.planned = d.planned.filter((id) => id !== task.id);
    }
  }
}

export function migrate(s) {
  const base = defaultState();
  return {
    ...base,
    ...s,
    settings: { ...base.settings, ...(s.settings || {}) },
    tasks: Array.isArray(s.tasks) ? s.tasks : [],
    days: s.days && typeof s.days === 'object' ? s.days : {},
  };
}
