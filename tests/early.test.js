import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, itemsForDay, setDone, upcomingItems, addWheneverDate, removeWheneverDate,
  isScheduledOn, toggleSub, getEntry,
} from '../js/model.js';
import { computeHistory } from '../js/history.js';

const FRI = '2026-11-06';
const SAT = '2026-11-07';
const SUN = '2026-11-08';
const task = (extra) => ({ id: Math.random().toString(36).slice(2), title: 't', order: 1, subtasks: [], levels: [], timeGoal: null, ...extra });

test('a task due Sunday can be checked off on Friday', () => {
  const s = defaultState();
  const gym = task({ title: 'Gym', schedule: { type: 'weekly', days: [0] }, startDate: '2026-11-01' });
  const ship = task({ title: 'Ship package', schedule: { type: 'once', date: SUN } });
  s.tasks.push(gym, ship);
  const up = upcomingItems(s, FRI);
  assert.deepEqual(up.map((i) => [i.task.title, i.due]), [['Gym', SUN], ['Ship package', SUN]]);
  for (const i of up) setDone(s, i.ref, i.task, true);
  // Still listed today as done early, gone after that
  assert.equal(upcomingItems(s, FRI).every((i) => i.entry.done), true);
  assert.equal(upcomingItems(s, SAT).length, 0);
  // Shows as done on Sunday
  const sun = itemsForDay(s, SUN, SUN);
  assert.deepEqual(sun.map((i) => [i.task.title, i.entry.done]), [['Gym', true], ['Ship package', true]]);
  // History counts it as done on Sunday, not missed
  const h = computeHistory(s, FRI, SUN, '2026-11-09');
  assert.equal(h.days.find((d) => d.key === SUN).done, 2);
  assert.equal(h.repeating[0].done, 1);
  assert.equal(h.oneTime.done, 1);
});

test('tasks already on today are not in coming up', () => {
  const s = defaultState();
  s.tasks.push(task({ title: 'Daily', schedule: { type: 'daily' }, startDate: FRI }));
  assert.equal(upcomingItems(s, FRI).length, 0);
});

test('whenever tasks show only on days they are added, with a fresh checklist', () => {
  const s = defaultState();
  const pack = task({ title: 'Pack', schedule: { type: 'whenever', dates: [] }, subtasks: [{ id: 'a', title: 'Socks' }, { id: 'b', title: 'Charger' }] });
  s.tasks.push(pack);
  assert.equal(itemsForDay(s, FRI, FRI).length, 0);
  addWheneverDate(pack, FRI);
  addWheneverDate(pack, SUN);
  assert.equal(isScheduledOn(pack, FRI), true);
  const [item] = itemsForDay(s, FRI, FRI);
  toggleSub(s, item.ref, pack, 'a');
  assert.equal(getEntry(s, FRI, pack).subs.a, true);
  assert.equal(itemsForDay(s, SUN, SUN)[0].entry.subs.a, undefined);
  removeWheneverDate(pack, SUN);
  assert.equal(itemsForDay(s, SUN, SUN).length, 0);
});
