import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueReminders, localNow, stateFromRows } from '../supabase/functions/todo-reminders/due.js';
import { flatten } from '../js/records.js';
import { defaultState, itemsForDay, setDone } from '../js/model.js';

const task = (extra) => ({ id: Math.random().toString(36).slice(2), title: 't', order: 1, subtasks: [], levels: [], timeGoal: null, ...extra });

test('local time in a time zone', () => {
  const d = new Date('2026-11-03T23:30:00Z');
  assert.deepEqual(localNow(d, 'America/Chicago'), { key: '2026-11-03', minutes: 17 * 60 + 30 });
  assert.deepEqual(localNow(d, 'Europe/Stockholm'), { key: '2026-11-04', minutes: 30 });
});

test('task reminders fire in their window, only while not done', () => {
  const s = defaultState();
  const gym = task({ title: 'Gym', schedule: { type: 'daily' }, startDate: '2026-11-01', remind: '18:00' });
  s.tasks.push(gym);
  s.settings.summaryAt = '08:00';
  const tz = 'America/Chicago'; // UTC-6 in November
  const at = (hhmm) => new Date(`2026-11-03T${hhmm}:00-06:00`);
  assert.deepEqual(dueReminders(s, at('17:55'), tz), []);
  assert.equal(dueReminders(s, at('18:05'), tz)[0].title, 'Gym');
  assert.deepEqual(dueReminders(s, at('18:40'), tz), []);
  assert.equal(dueReminders(s, at('08:03'), tz)[0].title, '1 thing on your list today');
  const [item] = itemsForDay(s, '2026-11-03', '2026-11-03');
  setDone(s, item.ref, gym, true);
  assert.deepEqual(dueReminders(s, at('18:05'), tz), []);
});

test('rebuilds state from synced rows', () => {
  const s = defaultState();
  s.tasks.push(task({ id: 'a', title: 'A', schedule: { type: 'daily' } }));
  s.days['2026-11-03'] = { planned: ['a'], items: { a: { done: true } } };
  const rows = Object.entries(flatten(s)).map(([key, data]) => ({ key, data }));
  const back = stateFromRows(rows);
  assert.equal(back.tasks[0].title, 'A');
  assert.equal(back.days['2026-11-03'].items.a.done, true);
});
