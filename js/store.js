// Saves the app's data in this browser. Sync between devices comes in a later step.
import { defaultState, migrate } from './model.js';

const KEY = 'todo-app.v1';
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {
    console.error('Could not read saved data', e);
  }
  return defaultState();
}

export const store = {
  state: load(),
  save() {
    this.state.updatedAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch (e) {
      alert('Could not save. Your browser storage may be full.');
    }
    listeners.forEach((fn) => fn());
  },
  replace(newState) {
    this.state = migrate(newState);
    this.save();
  },
  subscribe(fn) {
    listeners.add(fn);
  },
};

// Ask the browser not to clear this data when space runs low.
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
