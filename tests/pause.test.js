import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, isScheduledOn, itemsForDay, setDone, pauseTask, resumeTask, isPaused,
  setDayOff, isDayOff, clearHistoryBefore, addQuickTask,
} from '../js/model.js';
import { computeHistory } from '../js/history.js';
import { addDays } from '../js/dates.js';

const D1 = '2026-11-02';
const task = (extra) => ({ id: Math.random().toString(36).slice(2), title: 't', order: 1, subtasks: [], levels: [], timeGoal: null, ...extra });

test('a paused task is off the list and does not count as missed', () => {
  const s = defaultState();
  const kitchen = task({ title: 'Kitchen', schedule: { type: 'daily' }, startDate: D1 });
  const gym = task({ title: 'Gym', schedule: { type: 'daily' }, startDate: D1 });
  s.tasks.push(kitchen, gym);
  pauseTask(kitchen, addDays(D1, 1), addDays(D1, 2));
  assert.equal(isScheduledOn(kitchen, D1), true);
  assert.equal(isScheduledOn(kitchen, addDays(D1, 1)), false);
  assert.equal(isScheduledOn(kitchen, addDays(D1, 3)), true);
  assert.deepEqual(itemsForDay(s, addDays(D1, 1), addDays(D1, 1)).map((i) => i.task.title), ['Gym']);
  const today = addDays(D1, 4);
  for (let k = D1; k < today; k = addDays(k, 1)) {
    for (const i of itemsForDay(s, k, k)) setDone(s, i.ref, i.task, true);
  }
  const h = computeHistory(s, D1, addDays(D1, 3), today);
  const k = h.repeating.find((t) => t.task.title === 'Kitchen');
  assert.equal(k.done, 2);
  assert.equal(k.missed, 0);
});

test('resume ends an open-ended pause the day before', () => {
  const t = task({ schedule: { type: 'daily' } });
  pauseTask(t, D1);
  assert.equal(isPaused(t, addDays(D1, 10)), true);
  resumeTask(t, addDays(D1, 3));
  assert.deepEqual(t.pauses, [{ from: D1, to: addDays(D1, 2) }]);
  assert.equal(isPaused(t, addDays(D1, 3)), false);
  // Resuming on the first paused day removes the pause.
  const u = task({ schedule: { type: 'daily' } });
  pauseTask(u, D1);
  resumeTask(u, D1);
  assert.deepEqual(u.pauses, []);
});

test('a day off excuses unfinished tasks', () => {
  const s = defaultState();
  const gym = task({ title: 'Gym', schedule: { type: 'daily' }, startDate: D1 });
  s.tasks.push(gym);
  const sick = addDays(D1, 1);
  setDayOff(s, sick, true, 'sick');
  assert.equal(isDayOff(s, sick), true);
  for (const k of [D1, addDays(D1, 2)]) for (const i of itemsForDay(s, k, k)) setDone(s, i.ref, i.task, true);
  const h = computeHistory(s, D1, addDays(D1, 2), addDays(D1, 3));
  const g = h.repeating[0];
  assert.equal(g.done, 2);
  assert.equal(g.missed, 0);
  assert.equal(g.excused, 1);
  assert.equal(g.rate, 1);
  assert.equal(h.overall.daysOff, 1);
  assert.equal(h.overall.perfectDays, 2);
  setDayOff(s, sick, false);
  assert.equal(computeHistory(s, D1, addDays(D1, 2), addDays(D1, 3)).repeating[0].missed, 1);
});

test('clearing history forgets earlier days', () => {
  const s = defaultState();
  const gym = task({ title: 'Gym', schedule: { type: 'daily' }, startDate: D1 });
  s.tasks.push(gym);
  const old = addQuickTask(s, 'Old errand', D1);
  for (const i of itemsForDay(s, D1, D1)) setDone(s, i.ref, i.task, true);
  const cut = addDays(D1, 2);
  clearHistoryBefore(s, cut);
  assert.equal(s.settings.historyStart, cut);
  assert.equal(s.days[D1], undefined);
  assert.equal(s.tasks.some((t) => t.id === old.id), false);
  assert.equal(s.tasks.some((t) => t.id === gym.id), true);
  const h = computeHistory(s, D1, addDays(D1, 3), addDays(D1, 4));
  assert.equal(h.fromKey, cut);
  assert.equal(h.repeating[0].missed, 2);
});
