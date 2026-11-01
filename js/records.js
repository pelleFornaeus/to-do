// Splits the saved data into small records so two devices can change different
// things at the same time without overwriting each other.
//   t|<taskId>          a task
//   s                   settings
//   d|<date>            a day's list info (planned, day off), without its entries
//   e|<date>|<taskId>   one task's progress on a day
// Pure functions, so they can be tested without a browser.

export function flatten(state) {
  const out = {};
  for (const t of state.tasks || []) out[`t|${t.id}`] = t;
  out.s = state.settings || {};
  for (const [date, day] of Object.entries(state.days || {})) {
    const { items, ...meta } = day || {};
    out[`d|${date}`] = meta;
    for (const [id, entry] of Object.entries(items || {})) out[`e|${date}|${id}`] = entry;
  }
  return out;
}

// Put one record into the state (value undefined removes it). Keeps task order.
export function applyRecord(state, key, value) {
  const [kind, a, b] = key.split('|');
  if (kind === 't') {
    const i = state.tasks.findIndex((t) => t.id === a);
    if (value === undefined) { if (i >= 0) state.tasks.splice(i, 1); }
    else if (i >= 0) state.tasks[i] = value;
    else state.tasks.push(value);
  } else if (kind === 's') {
    if (value !== undefined) state.settings = { ...value };
  } else if (kind === 'd') {
    const items = state.days[a]?.items || {};
    if (value === undefined) {
      if (Object.keys(items).length) state.days[a] = { planned: [], items };
      else delete state.days[a];
    } else {
      const local = state.days[a]?.planned || [];
      // Both devices only ever add to "planned", so keep everything either one saw.
      const planned = [...new Set([...(value.planned || []), ...local])];
      state.days[a] = { ...value, planned, items };
    }
  } else if (kind === 'e') {
    if (value === undefined) {
      if (state.days[a]?.items) delete state.days[a].items[b];
    } else {
      if (!state.days[a]) state.days[a] = { planned: [], items: {} };
      if (!state.days[a].items) state.days[a].items = {};
      state.days[a].items[b] = value;
    }
  }
}

// What changed locally since the last look. `snap` maps key -> JSON text.
export function diff(snap, state) {
  const now = flatten(state);
  const changed = [];
  const json = {};
  for (const [k, v] of Object.entries(now)) {
    json[k] = JSON.stringify(v);
    if (snap[k] !== json[k]) changed.push(k);
  }
  const removed = Object.keys(snap).filter((k) => !(k in now));
  return { changed, removed, json, records: now };
}

// Decide what to do with a record from the server.
// Local wins only when it has an unsent change that is newer.
export function remoteWins(meta, key, remoteMod) {
  return !(meta.dirty[key] && (meta.mods[key] ?? 0) > remoteMod);
}
