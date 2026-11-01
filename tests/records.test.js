import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecord, diff, flatten, remoteWins } from '../js/records.js';
import { defaultState } from '../js/model.js';

const sample = () => ({
  ...defaultState(),
  tasks: [{ id: 'a', title: 'Gym' }, { id: 'b', title: 'Kitchen' }],
  days: { '2026-11-01': { planned: ['a'], items: { a: { done: true } }, dayOff: { note: 'sick' } } },
});

test('flatten splits state into records', () => {
  const r = flatten(sample());
  assert.deepEqual(Object.keys(r).sort(), ['d|2026-11-01', 'e|2026-11-01|a', 's', 't|a', 't|b']);
  assert.deepEqual(r['d|2026-11-01'], { planned: ['a'], dayOff: { note: 'sick' } });
});

test('applying every record rebuilds the same state', () => {
  const src = sample();
  const out = defaultState();
  for (const [k, v] of Object.entries(flatten(src))) applyRecord(out, k, structuredClone(v));
  assert.deepEqual(out.tasks, src.tasks);
  assert.deepEqual(out.days, src.days);
});

test('diff finds changes and removals', () => {
  const s = sample();
  const { json } = diff({}, s);
  s.tasks[0].title = 'Gym!';
  s.tasks.splice(1, 1);
  const d = diff(json, s);
  assert.deepEqual(d.changed, ['t|a']);
  assert.deepEqual(d.removed, ['t|b']);
});

test('remote entries merge into a day without losing local ones', () => {
  const s = sample();
  applyRecord(s, 'e|2026-11-01|b', { done: true });
  applyRecord(s, 'd|2026-11-01', { planned: ['b'] });
  assert.deepEqual(Object.keys(s.days['2026-11-01'].items).sort(), ['a', 'b']);
  assert.deepEqual(s.days['2026-11-01'].planned.sort(), ['a', 'b']);
  applyRecord(s, 'e|2026-11-01|a', undefined);
  applyRecord(s, 'e|2026-11-01|b', undefined);
  applyRecord(s, 'd|2026-11-01', undefined);
  assert.equal(s.days['2026-11-01'], undefined);
});

test('newer unsent local change beats an older remote one', () => {
  const meta = { dirty: { k: true }, mods: { k: 200 } };
  assert.equal(remoteWins(meta, 'k', 100), false);
  assert.equal(remoteWins(meta, 'k', 300), true);
  assert.equal(remoteWins({ dirty: {}, mods: { k: 500 } }, 'k', 100), true);
});
