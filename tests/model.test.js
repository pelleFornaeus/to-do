import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, isScheduledOn, itemsForDay, addQuickTask, setDone, toggleSub, setLevel,
  visibleSubtasks, getEntry, addMinutes, startTimer, stopTimer, deleteTask, snapshotPlanned,
  parseQuickAdd,
} from '../js/model.js';
import { logicalToday } from '../js/dates.js';

// 2026-11-01 is a Sunday.
const SUN = '2026-11-01';
const MON = '2026-11-02';
const TUE = '2026-11-03';

const task = (extra) => ({ id: Math.random().toString(36).slice(2), title: 't', order: 1, subtasks: [], levels: [], timeGoal: null, ...extra });

test('weekly schedule picks the right days', () => {
  const gym = task({ schedule: { type: 'weekly', days: [0, 2, 4] } });
  assert.equal(isScheduledOn(gym, SUN), true);
  assert.equal(isScheduledOn(gym, MON), false);
  assert.equal(isScheduledOn(gym, TUE), true);
});

test('interval and monthly schedules', () => {
  const every3 = task({ schedule: { type: 'interval', every: 3 }, startDate: SUN });
  assert.equal(isScheduledOn(every3, SUN), true);
  assert.equal(isScheduledOn(every3, MON), false);
  assert.equal(isScheduledOn(every3, '2026-11-04'), true);
  assert.equal(isScheduledOn(every3, '2026-10-29'), false); // before start
  const rent = task({ schedule: { type: 'monthly', day: 31 } });
  assert.equal(isScheduledOn(rent, '2026-11-30'), true); // last day of a short month
  assert.equal(isScheduledOn(rent, '2026-12-31'), true);
});

test('quick tasks carry over until done, then show only on the day finished', () => {
  const s = defaultState();
  const t = addQuickTask(s, 'Send package', SUN);
  const item = itemsForDay(s, MON, MON)[0];
  assert.equal(item.carried, true);
  setDone(s, item.ref, t, true);
  assert.equal(itemsForDay(s, MON, MON).length, 1);
  assert.equal(itemsForDay(s, TUE, TUE).length, 0);
});

test('finished repeating tasks do not show done the next day', () => {
  const s = defaultState();
  const t = task({ schedule: { type: 'daily' } });
  s.tasks.push(t);
  setDone(s, SUN, t, true);
  assert.equal(itemsForDay(s, MON, MON)[0].entry.done, false);
});

test('levels control which steps show, and finishing all steps finishes the task', () => {
  const s = defaultState();
  const kitchen = task({
    schedule: { type: 'daily' },
    levels: ['Light', 'Normal', 'Deep'],
    levelDefault: 0,
    levelByDay: { 0: 2 },
    subtasks: [
      { id: 'a', title: 'Dishes', level: 0 },
      { id: 'b', title: 'Counters', level: 1 },
      { id: 'c', title: 'Fridge', level: 2 },
    ],
  });
  s.tasks.push(kitchen);
  assert.equal(visibleSubtasks(kitchen, getEntry(s, MON, kitchen)).length, 1);
  assert.equal(visibleSubtasks(kitchen, getEntry(s, SUN, kitchen)).length, 3); // deep on Sunday
  toggleSub(s, MON, kitchen, 'a');
  assert.equal(getEntry(s, MON, kitchen).done, true);
  setLevel(s, MON, kitchen, 1); // more steps now, so not done anymore
  assert.equal(getEntry(s, MON, kitchen).done, false);
});

test('time goals per day, logging and the timer', () => {
  const s = defaultState();
  const study = task({ schedule: { type: 'daily' }, timeGoal: { minutes: 60, byDay: { 0: 30 } } });
  s.tasks.push(study);
  assert.equal(getEntry(s, SUN, study).goal, 30);
  assert.equal(getEntry(s, MON, study).goal, 60);
  addMinutes(s, MON, study, 45);
  assert.equal(getEntry(s, MON, study).done, false);
  startTimer(s, MON, study, 1000);
  stopTimer(s, MON, study, 1000 + 20 * 60000);
  const e = getEntry(s, MON, study);
  assert.equal(e.minutes, 65);
  assert.equal(e.done, true);
});

test('deleting a task with history keeps it hidden but available for reports', () => {
  const s = defaultState();
  const t = task({ schedule: { type: 'daily' } });
  s.tasks.push(t);
  setDone(s, SUN, t, true);
  deleteTask(s, t);
  assert.equal(s.tasks.length, 1);
  assert.equal(itemsForDay(s, MON, MON).length, 0);
  assert.equal(itemsForDay(s, SUN, MON).length, 1);
});

test('planned list is remembered for reports', () => {
  const s = defaultState();
  s.tasks.push(task({ id: 'x', schedule: { type: 'daily' } }));
  snapshotPlanned(s, MON, MON);
  assert.deepEqual(s.days[MON].planned, ['x']);
});

test('the day rolls over at the chosen hour', () => {
  assert.equal(logicalToday(3, new Date(2026, 10, 2, 2, 30)), SUN);
  assert.equal(logicalToday(3, new Date(2026, 10, 2, 3, 30)), MON);
});

test('quick tasks finished later show as open on earlier days', () => {
  const s = defaultState();
  const t = addQuickTask(s, 'Vote', SUN);
  setDone(s, { start: SUN, on: MON }, t, true);
  assert.equal(itemsForDay(s, SUN, MON)[0].entry.done, false);
  assert.equal(itemsForDay(s, MON, MON)[0].entry.done, true);
  assert.equal(itemsForDay(s, TUE, TUE).length, 0);
});

test('a multi-day level stays on the list and keeps step progress', () => {
  const s = defaultState();
  const kitchen = task({
    id: 'k',
    schedule: { type: 'weekly', days: [0] }, // Sundays
    levels: ['Normal', 'Complete'],
    levelDefault: 1,
    levelDays: { 1: 3 },
    subtasks: [{ id: 'a', title: 'Counters', level: 0 }, { id: 'b', title: 'Drawers', level: 1 }],
  });
  s.tasks.push(kitchen);
  const sun = itemsForDay(s, SUN, SUN)[0];
  assert.equal(sun.span, 3);
  toggleSub(s, sun.ref, kitchen, 'a');
  const mon = itemsForDay(s, MON, MON)[0];
  assert.equal(mon.dayNum, 2);
  assert.equal(mon.entry.subs.a, true);
  toggleSub(s, mon.ref, kitchen, 'b');
  assert.equal(itemsForDay(s, MON, MON)[0].entry.done, true);
  assert.equal(itemsForDay(s, TUE, TUE).length, 0); // finished early, so gone on day 3
  assert.equal(itemsForDay(s, '2026-11-04', '2026-11-04').length, 0); // span over
});

test('a multi-day run takes the place of the daily version while it lasts', () => {
  const s = defaultState();
  const kitchen = task({
    schedule: { type: 'daily' }, levels: ['Normal', 'Complete'], levelDefault: 0, levelByDay: { 0: 1 }, levelDays: { 1: 2 },
  });
  s.tasks.push(kitchen);
  const mon = itemsForDay(s, MON, MON);
  assert.equal(mon.length, 1);
  assert.equal(mon[0].ref.start, SUN);
  assert.equal(mon[0].dayNum, 2);
  assert.equal(itemsForDay(s, TUE, TUE)[0].ref.start, TUE);
});

test('"tomorrow ..." in quick add schedules for the next day', () => {
  assert.deepEqual(parseQuickAdd('tomorrow ship this package', SUN), { title: 'ship this package', key: MON });
  assert.deepEqual(parseQuickAdd('Tomorrow: vote', SUN), { title: 'vote', key: MON });
  assert.deepEqual(parseQuickAdd('tomorrowland tickets', SUN), { title: 'tomorrowland tickets', key: SUN });
});

test('level rules: deep every Saturday, complete on the last Saturday', async () => {
  const { plannedLevel } = await import('../js/model.js');
  const kitchen = task({
    schedule: { type: 'daily' },
    levels: ['Light', 'Normal', 'Deep', 'Complete'],
    levelDefault: 1,
    levelRules: [{ level: 3, weekday: 6, nth: 'last' }, { level: 2, weekday: 6, nth: 'every' }],
  });
  assert.equal(plannedLevel(kitchen, '2026-11-02'), 1); // Monday: normal
  assert.equal(plannedLevel(kitchen, '2026-11-21'), 2); // a Saturday: deep
  assert.equal(plannedLevel(kitchen, '2026-11-28'), 3); // last Saturday: complete
  kitchen.levelRules = [{ level: 2, weekday: 6, nth: 1 }];
  assert.equal(plannedLevel(kitchen, '2026-11-07'), 2); // first Saturday
  assert.equal(plannedLevel(kitchen, '2026-11-14'), 1);
});

test('steps can belong to any set of levels', () => {
  const s = defaultState();
  const kitchen = task({
    schedule: { type: 'daily' },
    levels: ['Light', 'Normal', 'Deep'],
    levelDefault: 1,
    subtasks: [
      { id: 'a', title: 'Dishes', in: [0, 1, 2] },
      { id: 'b', title: 'Quick wipe', in: [0] },
      { id: 'c', title: 'Fridge', in: [2] },
    ],
  });
  s.tasks.push(kitchen);
  const names = (lvl) => visibleSubtasks(kitchen, { level: lvl }).map((x) => x.id).join();
  assert.equal(names(0), 'a,b');
  assert.equal(names(1), 'a');
  assert.equal(names(2), 'a,c');
});

test('older saved tasks (per-weekday levels, "from level" steps) still work', async () => {
  const { plannedLevel } = await import('../js/model.js');
  const old = task({ levels: ['L', 'N', 'D'], levelDefault: 0, levelByDay: { 6: 2 }, subtasks: [{ id: 'x', level: 1 }] });
  assert.equal(plannedLevel(old, '2026-11-07'), 2);
  assert.equal(visibleSubtasks(old, { level: 0 }).length, 0);
  assert.equal(visibleSubtasks(old, { level: 2 }).length, 1);
});
