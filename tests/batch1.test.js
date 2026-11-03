import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, itemsForDay, setDone, setSkipped, setDayOff, streak, weekDone, reorderTasks, parseQuickAdd,
} from '../js/model.js';
import { computeHistory } from '../js/history.js';
import { addDays } from '../js/dates.js';

// 2026-11-02 is a Monday.
const MON = '2026-11-02';
const task = (extra) => ({ id: Math.random().toString(36).slice(2), title: 't', order: 1, subtasks: [], levels: [], timeGoal: null, ...extra });
const doOn = (s, t, k) => { const i = itemsForDay(s, k, k).find((x) => x.task.id === t.id); setDone(s, i.ref, t, true); };

test('quick add understands days and dates', () => {
  const TUE = '2026-11-03';
  const cases = {
    'friday ship package': ['ship package', '2026-11-06'],
    'ship package friday': ['ship package', '2026-11-06'],
    'call mom in 3 days': ['call mom', '2026-11-06'],
    'pay rent on the 1st': ['pay rent', '2026-12-01'],
    'nov 12 haircut': ['haircut', '2026-11-12'],
    'party next friday': ['party', '2026-11-13'],
    'fix the mon': ['fix the mon', TUE],
    'read chapter 12': ['read chapter 12', TUE],
    'thursday': ['thursday', TUE],
  };
  for (const [text, [title, key]] of Object.entries(cases)) assert.deepEqual(parseQuickAdd(text, TUE), { title, key }, text);
});

test('3 times a week: on the list until met, misses counted per week', () => {
  const s = defaultState();
  const gym = task({ title: 'Gym', schedule: { type: 'perweek', times: 3 }, startDate: MON });
  s.tasks.push(gym);
  doOn(s, gym, MON);
  doOn(s, gym, addDays(MON, 2));
  assert.equal(weekDone(s, gym, addDays(MON, 3)), 2);
  doOn(s, gym, addDays(MON, 4));
  // Met on Friday: gone Saturday, but still shows as done on Friday
  assert.equal(itemsForDay(s, addDays(MON, 5), addDays(MON, 5)).length, 0);
  assert.equal(itemsForDay(s, addDays(MON, 4), addDays(MON, 5))[0].entry.done, true);
  // Next week only once
  doOn(s, gym, addDays(MON, 8));
  const h = computeHistory(s, MON, addDays(MON, 13), addDays(MON, 14));
  const g = h.repeating[0];
  assert.equal(g.done, 4);
  assert.equal(g.missed, 2);
  assert.equal(g.weeksMet, 1);
  assert.equal(h.days.find((d) => d.key === addDays(MON, 1)).total, 0); // a day without it isn't a miss
  assert.equal(streak(s, gym, addDays(MON, 14)), 0);
  assert.equal(streak(s, gym, addDays(MON, 9)), 1);
});

test('streaks count runs in a row; skips and days off do not break them', () => {
  const s = defaultState();
  const t = task({ schedule: { type: 'daily' }, startDate: MON });
  s.tasks.push(t);
  doOn(s, t, MON);
  doOn(s, t, addDays(MON, 1));
  const sk = itemsForDay(s, addDays(MON, 2), addDays(MON, 2))[0];
  setSkipped(s, sk.ref, t, true);
  setDayOff(s, addDays(MON, 3), true);
  doOn(s, t, addDays(MON, 4));
  assert.equal(streak(s, t, addDays(MON, 5)), 3); // today still open
  assert.equal(streak(s, t, addDays(MON, 6)), 0); // missed yesterday
});

test('reorder moves only the given tasks into their slots', () => {
  const s = defaultState();
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id, i) => task({ id, order: i + 1 }));
  s.tasks.push(a, b, c, d);
  reorderTasks(s, ['d', 'b']); // d moves above b
  const sorted = [...s.tasks].sort((x, y) => x.order - y.order).map((x) => x.id);
  assert.deepEqual(sorted, ['a', 'd', 'c', 'b']);
});
