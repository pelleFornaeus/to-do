import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, itemsForDay, setDone, startTrip, endTrip, activeTrip, isScheduledOn } from '../js/model.js';
import { weekReview, yearReview } from '../js/history.js';
import { addDays } from '../js/dates.js';

const MON = '2026-11-02';
const task = (extra) => ({ id: Math.random().toString(36).slice(2), title: 't', order: 1, subtasks: [], levels: [], timeGoal: null, ...extra });
const doOn = (s, t, k) => { const i = itemsForDay(s, k, k).find((x) => x.task.id === t.id); setDone(s, i.ref, t, true); };

test('travel mode pauses chosen tasks and plans the packing list', () => {
  const s = defaultState();
  const kitchen = task({ title: 'Kitchen', schedule: { type: 'daily' }, startDate: MON });
  const gym = task({ title: 'Gym', schedule: { type: 'daily' }, startDate: MON });
  const pack = task({ title: 'Pack', schedule: { type: 'whenever', dates: [] } });
  s.tasks.push(kitchen, gym, pack);
  startTrip(s, { from: addDays(MON, 2), to: addDays(MON, 5), taskIds: [kitchen.id], packId: pack.id, packDate: addDays(MON, 1) });
  assert.equal(isScheduledOn(kitchen, addDays(MON, 3)), false);
  assert.equal(isScheduledOn(gym, addDays(MON, 3)), true);
  assert.equal(isScheduledOn(pack, addDays(MON, 1)), true);
  assert.equal(isScheduledOn(kitchen, addDays(MON, 6)), true);
  assert.ok(activeTrip(s, MON));
  // Back early
  endTrip(s, addDays(MON, 4));
  assert.equal(isScheduledOn(kitchen, addDays(MON, 4)), true);
  assert.equal(isScheduledOn(kitchen, addDays(MON, 3)), false);
  assert.equal(activeTrip(s, MON), null);
  // Calling off a trip that hasn't started removes its pause
  startTrip(s, { from: addDays(MON, 10), to: addDays(MON, 12), taskIds: [gym.id] });
  endTrip(s, MON);
  assert.deepEqual(gym.pauses, []);
});

test('weekly and year reviews', () => {
  const s = defaultState();
  const gym = task({ title: 'Gym', schedule: { type: 'daily' }, startDate: MON });
  s.tasks.push(gym);
  for (let i = 0; i < 6; i++) doOn(s, gym, addDays(MON, i)); // misses Sunday
  const r = weekReview(s, addDays(MON, 7));
  assert.equal(r.from, MON);
  assert.equal(r.h.overall.done, 6);
  assert.equal(r.missed[0].task.title, 'Gym');
  assert.equal(r.ahead.length, 7);
  const y = yearReview(s, 2026, addDays(MON, 7));
  assert.equal(y.top.task.title, 'Gym');
  assert.equal(y.longest.bestStreak, 6);
  assert.equal(y.months.find((m) => m.month === 11).done, 6);
});
