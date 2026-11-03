// Shows today's meals and the shopping list from the meal planner app on the Today tab.
// Read-only: it reads the meal planner's synced data (same Supabase account) and uses the
// meal planner's own code from the same website, so both apps agree on the shopping list.
import { sync } from './sync.js';

const CACHE_KEY = 'todo-app.meals';
export const MEAL_APP_URL = new URL('../../meal-planner/', import.meta.url).href;
const MEAL_JS = new URL('../../meal-planner/js/', import.meta.url).href;

const load = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch { return null; } };
let cache = load(); // { rows: [{key, data}], at, userId }
let mods = null;
let loading = null;
const listeners = new Set();

export const meals = {
  onChange(fn) { listeners.add(fn); },
  lastError: '',
};

async function code() {
  if (!mods) {
    const [model, records, shopping] = await Promise.all([
      import(`${MEAL_JS}model.js`), import(`${MEAL_JS}records.js`), import(`${MEAL_JS}shopping.js`),
    ]);
    mods = { model, records, shopping };
  }
  return mods;
}

// Fetch the latest meal plan (at most every few minutes unless forced).
export async function refreshMeals(force = false) {
  if (!sync.user) return;
  if (!force && cache?.userId === sync.user.id && Date.now() - (cache.at || 0) < 5 * 60_000) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      let rows = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await sync.request(`/rest/v1/meal_records?select=key,data&deleted=eq.false&order=key&limit=1000&offset=${offset}`);
        rows = rows.concat(page || []);
        if (!page || page.length < 1000) break;
      }
      cache = { rows, at: Date.now(), userId: sync.user.id };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* full: keep in memory */ }
      meals.lastError = '';
    } catch (e) {
      meals.lastError = e instanceof TypeError ? '' : (e.message || String(e)); // offline: keep the saved copy
    } finally {
      loading = null;
      listeners.forEach((fn) => fn());
    }
  })();
  return loading;
}

let built = null; // { at, state }
async function mealState() {
  if (!cache?.rows || cache.userId !== sync.user?.id) return null;
  if (built?.at === cache.at) return built.state;
  const { model, records } = await code();
  const state = model.defaultState();
  // Day plans last isn't needed here, but keep the same order the meal app uses.
  for (const r of cache.rows) records.applyRecord(state, r.key, r.data);
  built = { at: cache.at, state: model.migrate(state) };
  return built.state;
}

// What to show for a day: meals by slot, and how much is left on the shopping list.
export async function mealSummary(dayKey) {
  const state = await mealState();
  if (!state) return null;
  const { model, shopping } = await code();
  const slots = state.settings.slots || [];
  const slotName = (id) => slots.find((s) => s.id === id)?.name || '';
  const slotIndex = (id) => { const i = slots.findIndex((x) => x.id === id); return i < 0 ? 99 : i; };
  const entries = model.dayEntries(state, dayKey)
    .sort((a, b) => slotIndex(a.slot) - slotIndex(b.slot) || (a.order || 0) - (b.order || 0))
    .map((e) => ({
    slot: slotName(e.slot),
    name: model.entryName(state, e),
    kind: e.type, // cook, leftover, food
  }));
  const { from, to } = shopping.defaultRange(dayKey, state.settings.shopDays || 7);
  const list = shopping.shoppingList(state, from, to);
  const left = list.items.filter((i) => !i.atHome && !i.done).length
    + (state.shopping?.extras || []).filter((x) => !x.checked).length;
  return { entries, shopLeft: left, shopTo: to };
}

export function hasMealData() {
  return !!cache?.rows?.length && cache.userId === sync.user?.id;
}
