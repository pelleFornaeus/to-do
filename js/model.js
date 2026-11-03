// Core rules for tasks, schedules and daily lists.
// Everything here works on a plain state object so it can be tested without a browser.
//
// state = {
//   version, tasks: [Task], days: { "YYYY-MM-DD": DayRecord }, settings
// }
// Task = {
//   id, title, notes, order, createdAt, updatedAt, archived,
//   schedule: { type: 'once', date } | { type: 'daily' } | { type: 'weekly', days: [0..6] }
//           | { type: 'interval', every } | { type: 'monthly', day: 1..31 | 'last' }
//           | { type: 'monthly', by: 'weekday', nth: 1..4 | 'last', weekday },
//   startDate,                       // first day a repeating task applies
//   completedOn,                     // one-time tasks: day it was finished
//   levels: ['Light', ...],          // optional; empty means no levels
//   levelDefault, levelRules: [{ level, weekday, nth }],  (older: levelByDay)
//   subtasks: [{ id, title, from: 'default' | levelIndex }], // first level that includes the step
//   timeGoal: { minutes, byDay: { weekday: minutes } } | null,
//   spanDays, levelDays: { levelIndex: days },  // multi-day tasks
//   pauses: [{ from, to? }]                     // paused days don't show or count
// }
// DayRecord = { planned: [taskId], items: { taskId: Entry }, dayOff?: { note } }  (entries live on a run's first day)
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

// ---------- Pauses ----------
// task.pauses = [{ from, to }]; no `to` means paused until resumed.

export function isPaused(task, key) {
  return (task.pauses || []).some((p) => key >= p.from && (!p.to || key <= p.to));
}

export function activePause(task, key) {
  return (task.pauses || []).find((p) => key >= p.from && (!p.to || key <= p.to))
    || (task.pauses || []).find((p) => p.from > key); // or an upcoming one
}

export function pauseTask(task, from, to = null) {
  task.pauses = [...(task.pauses || []), { from, ...(to ? { to } : {}) }];
  task.updatedAt = Date.now();
}

// End any pause that covers `key` so the task is back from `key` on.
export function resumeTask(task, key) {
  task.pauses = (task.pauses || [])
    .map((p) => {
      if (key >= p.from && (!p.to || key <= p.to)) {
        return p.from >= key ? null : { ...p, to: addDays(key, -1) };
      }
      return p;
    })
    .filter(Boolean);
  task.updatedAt = Date.now();
}

// ---------- Days off ----------
// A day off (sick day, travel day...) never counts against you in history.

export function isDayOff(state, key) {
  return !!state.days[key]?.dayOff;
}

export function setDayOff(state, key, on, note = '') {
  if (!state.days[key]) state.days[key] = { planned: [], items: {} };
  if (on) state.days[key].dayOff = { note };
  else delete state.days[key].dayOff;
}

// ---------- Clearing history ----------
// Forget everything before `key` and start history fresh from that day.

export function clearHistoryBefore(state, key) {
  for (const k of Object.keys(state.days)) if (k < key) delete state.days[k];
  // One-time tasks finished before then are done with; drop them too.
  state.tasks = state.tasks.filter((t) => !(t.schedule?.type === 'once' && t.completedOn && t.completedOn < key));
  state.tasks = state.tasks.filter((t) => !(t.archived && !Object.values(state.days).some((d) => d.items?.[t.id])));
  state.settings.historyStart = key;
}

export function isScheduledOn(task, key) {
  const s = task.schedule || { type: 'once' };
  if (s.type === 'once') return s.date === key;
  if (task.archived) return false;
  if (task.startDate && key < task.startDate) return false;
  if (isPaused(task, key)) return false;
  switch (s.type) {
    case 'daily':
      return true;
    case 'weekly':
      return (s.days || []).includes(weekday(key));
    case 'interval': {
      const d = diffDays(task.startDate || key, key);
      return d >= 0 && d % Math.max(1, s.every || 1) === 0;
    }
    case 'whenever':
      return (s.dates || []).includes(key);
    case 'perweek':
      return true; // on the list every day until this week's goal is met (see itemsForDay)
    case 'monthly': {
      // By weekday, e.g. first or last Saturday of the month.
      if (s.by === 'weekday') return ruleMatches({ weekday: s.weekday ?? 6, nth: s.nth ?? 1 }, key);
      const [y, m, dd] = key.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      if (s.day === 'last') return dd === lastDay;
      return dd === Math.min(Number(s.day) || 1, lastDay);
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
    case 'whenever': return 'Whenever you need it';
    case 'perweek': return `${s.times || 1}× a week, any days`;
    case 'monthly': {
      if (s.by === 'weekday') {
        const nth = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', last: 'last' }[s.nth ?? 1];
        const long = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return `Monthly on the ${nth} ${long[s.weekday ?? 6]}`;
      }
      if (s.day === 'last') return 'Monthly on the last day';
      return `Monthly on day ${s.day}`;
    }
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

// Whether a step is part of a level. A step has a starting level (`from`) and shows
// at that level and every level above it. 'default' means the task's usual level,
// so changing the usual level moves those steps along with it.
// Older formats: `in` (a list of levels) or `level` (a starting level number).
export function stepStart(step, task) {
  if (step.from === 'default') return task?.levelDefault ?? 0;
  if (step.from != null) return Number(step.from);
  if (Array.isArray(step.in)) return step.in.length ? Math.min(...step.in) : Infinity;
  return step.level ?? 0;
}

export function stepInLevel(step, level, task) {
  if (step.from == null && Array.isArray(step.in)) return step.in.includes(level);
  return stepStart(step, task) <= level;
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
  return subs.filter((s) => stepInLevel(s, lvl, task));
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

// ---------- A few times a week ----------
// schedule { type: 'perweek', times }: on the list every day until done `times` times
// this week. Not doing it on a given day isn't a miss; only falling short for the week is.

export function weekStart(key, startDay = 1) {
  return addDays(key, -((weekday(key) - startDay + 7) % 7));
}

// How many times it was done in the week containing `key` (leaving out `except`).
export function weekDone(state, task, key, except = null) {
  const start = weekStart(key, state.settings?.weekStart ?? 1);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const k = addDays(start, i);
    if (k === except) continue;
    const e = state.days[k]?.items?.[task.id];
    if (e?.done) n++;
  }
  return n;
}

export function isPerWeek(task) {
  return task.schedule?.type === 'perweek';
}

// ---------- Streaks ----------
// Runs done in a row. Skips, days off and pauses don't break a streak,
// and today's unfinished run doesn't either. "A few times a week" tasks count weeks.

export function streak(state, task, todayKey) {
  if (!isRepeating(task) || task.schedule.type === 'whenever') return 0;
  const first = task.startDate || '2000-01-01';
  if (isPerWeek(task)) {
    const times = task.schedule.times || 1;
    let n = 0;
    let wk = weekStart(todayKey, state.settings?.weekStart ?? 1);
    if (weekDone(state, task, todayKey) >= times) n++; // this week already counts once met
    for (let i = 0; i < 260; i++) {
      wk = addDays(wk, -7);
      if (addDays(wk, 6) < first) break;
      const done = weekDone(state, task, wk);
      if (done >= times) n++;
      else if (!weekExcused(state, task, wk)) break;
    }
    return n;
  }
  let n = 0;
  const seen = new Set();
  for (let i = 0, k = todayKey; i < 730 && k >= first; i++, k = addDays(k, -1)) {
    const run = repeatingRunOn(state, task, k);
    if (!run || seen.has(run.start)) continue;
    seen.add(run.start);
    const e = run.entry;
    if (e.done) n++;
    else if (e.skipped || isDayOff(state, k) || run.start === todayKey || run.start > todayKey) continue;
    else if (k === todayKey) continue; // a multi-day run still in progress
    else break;
  }
  return n;
}

// A week with days off or a pause doesn't break a weekly streak.
export function weekExcused(state, task, wk) {
  for (let i = 0; i < 7; i++) {
    const k = addDays(wk, i);
    if (isDayOff(state, k) || isPaused(task, k)) return true;
  }
  return false;
}

// ---------- Ordering ----------
// Put the given tasks in this order, keeping everything else where it was.
export function reorderTasks(state, ids) {
  const all = [...state.tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  all.forEach((t, i) => { t.order = i + 1; });
  const moving = ids.map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  const slots = moving.map((t) => t.order).sort((a, b) => a - b);
  const now = Date.now();
  moving.forEach((t, i) => { if (t.order !== slots[i]) { t.order = slots[i]; t.updatedAt = now; } });
  // Renumbering can touch other tasks too; mark them changed only if they moved.
}

// ---------- Whenever tasks ----------
// A saved task (like a packing list) with no schedule. Add it to a day when you need it;
// each time starts with a fresh checklist.

export function isWhenever(task) {
  return task.schedule?.type === 'whenever';
}

export function addWheneverDate(task, key) {
  const dates = new Set(task.schedule.dates || []);
  dates.add(key);
  task.schedule.dates = [...dates].sort();
  task.updatedAt = Date.now();
}

export function removeWheneverDate(task, key) {
  task.schedule.dates = (task.schedule.dates || []).filter((d) => d !== key);
  task.updatedAt = Date.now();
}

export function nextWheneverDate(task, todayKey) {
  return (task.schedule.dates || []).find((d) => d >= todayKey) || null;
}

// ---------- Coming up ----------
// The next time each task is due in the coming days, so it can be done early.
// Tasks already on today's list are left out.

export function upcomingItems(state, todayKey, days = 7) {
  const onToday = new Set(itemsForDay(state, todayKey, todayKey).map((i) => i.task.id));
  const last = addDays(todayKey, days);
  const out = [];
  for (const task of state.tasks) {
    if (task.archived || onToday.has(task.id) || isPerWeek(task)) continue;
    const s = task.schedule || { type: 'once' };
    let due = null;
    if (s.type === 'once') {
      if (s.date > todayKey && s.date <= last) due = s.date;
    } else {
      for (let k = addDays(todayKey, 1); k <= last; k = addDays(k, 1)) {
        if (isScheduledOn(task, k)) { due = k; break; }
      }
    }
    if (!due) continue;
    const entry = getEntry(state, due, task);
    if (entry.skipped || (entry.done && entry.doneOn && entry.doneOn < todayKey)) continue;
    out.push({ task, entry, ref: { start: due, on: todayKey }, dayNum: 1, span: spanFor(task, entry.level), carried: false, due });
  }
  out.sort((a, b) => a.due.localeCompare(b.due) || (a.task.order ?? 0) - (b.task.order ?? 0));
  return out;
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
      // Done early: still shows (as done) on the day it was due.
      if (finishedBefore(entry, key) && !(key === s.date && entry.doneOn < s.date)) continue;
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
      if (s.type === 'perweek' && !run.entry.done && weekDone(state, task, key, key) >= (s.times || 1)) continue;
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
// Understands a day at the start or end: "tomorrow ship package", "friday call mom",
// "pay rent on the 1st"... Also "in 3 days", "next week", "nov 12", "12/24".
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_WORD = '(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)';
const MONTH_WORD = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const DAY_FULL = '(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)';
// At the end of a task, short day names need "on" ("fix the mon" stays as typed).
const when = (atEnd) => [
  `(?:today|tonight)`,
  `(?:tomorrow|tmrw|tmr)`,
  atEnd ? `(?:on\\s+(?:next\\s+|this\\s+)?${DAY_WORD}|(?:next\\s+|this\\s+)?${DAY_FULL})` : `(?:on\\s+)?(?:next\\s+|this\\s+)?${DAY_WORD}`,
  `in\\s+(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:days?|weeks?)`,
  `next\\s+week`,
  `(?:on\\s+)?${MONTH_WORD}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?`,
  `(?:on\\s+)?(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)`,
  `(?:on\\s+)?\\d{1,2}\\/\\d{1,2}`,
].join('|');
const START_RE = new RegExp(`^(${when(false)})\\b[\\s,:-]+(.+)$`, 'i');
const END_RE = new RegExp(`^(.+?)[\\s,-]+(${when(true)})$`, 'i');

function whenToKey(when, key) {
  const w = when.toLowerCase().replace(/^on\s+/, '').replace(/^the\s+/, '').trim();
  if (w === 'today' || w === 'tonight') return key;
  if (/^(tomorrow|tmrw|tmr)$/.test(w)) return addDays(key, 1);
  if (w === 'next week') return addDays(key, ((1 - weekday(key) + 7) % 7) || 7); // next Monday
  let m = w.match(/^in\s+(\S+)\s+(day|week)s?$/);
  if (m) {
    const n = Number(m[1]) || NUM_WORDS[m[1]] || 1;
    return addDays(key, n * (m[2] === 'week' ? 7 : 1));
  }
  m = w.match(/^(next\s+|this\s+)?([a-z]+)$/);
  if (m && DAY_NAMES.includes(m[2].slice(0, 3))) {
    const target = DAY_NAMES.indexOf(m[2].slice(0, 3));
    // "friday" is the coming Friday (today if it's Friday); "next friday" is a week later than that.
    let ahead = (target - weekday(key) + 7) % 7;
    if (m[1]?.startsWith('next')) ahead += 7;
    return addDays(key, ahead);
  }
  const [y, mo, d] = key.split('-').map(Number);
  const pick = (month, day) => {
    // The next time that date comes around.
    let year = y;
    const k = (yy) => `${yy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (k(year) < key) year++;
    return k(year);
  };
  m = w.match(/^([a-z]+)\.?\s+(\d{1,2})/);
  if (m) {
    const month = MONTH_NAMES.indexOf(m[1].slice(0, 3)) + 1;
    const day = Number(m[2]);
    if (month && day >= 1 && day <= 31) return pick(month, day);
  }
  m = w.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return pick(month, day);
  }
  m = w.match(/^(\d{1,2})(st|nd|rd|th)$/);
  if (m) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return null;
    let month = mo;
    let year = y;
    if (day < d) { month++; if (month > 12) { month = 1; year++; } }
    const last = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  }
  return null;
}

export function parseQuickAdd(text, key) {
  const t = text.trim();
  let m = t.match(START_RE);
  if (m) {
    const k = whenToKey(m[1], key);
    if (k && m[2].trim()) return { title: m[2].trim(), key: k };
  }
  m = t.match(END_RE);
  if (m) {
    const k = whenToKey(m[2], key);
    if (k && m[1].trim()) return { title: m[1].trim(), key: k };
  }
  return { title: t, key };
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
