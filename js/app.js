import { store } from './store.js';
import {
  WEEKDAYS, addDays, formatDay, formatLongDate, formatMinutes, logicalToday,
} from './dates.js';
import {
  DEFAULT_LEVELS, levelRules, addMinutes, addQuickTask, deleteTask, describeSchedule, getEntry,
  hasLevels, isRepeating, itemsForDay, moveOnceTask, nextOrder, setDone, setLevel,
  parseQuickAdd, setGoal, setMinutes, setSkipped, snapshotPlanned, startTimer, stopTimer,
  toggleSub, uid, visibleSubtasks,
} from './model.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const ui = {
  tab: 'today',
  viewKey: null, // day shown on the Today tab
  expanded: new Set(),
  doneOpen: false,
  editor: null, // draft task being edited
};

const S = () => store.state;
const today = () => logicalToday(S().settings.dayStartHour);
const findTask = (id) => S().tasks.find((t) => t.id === id);

// ---------- Rendering ----------

function render() {
  const t = today();
  if (!ui.viewKey) ui.viewKey = t;
  if (snapshotPlanned(S(), t, t)) store.save();

  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === ui.tab);
  });
  const main = $('#main');
  if (ui.tab === 'today') main.innerHTML = renderToday();
  else if (ui.tab === 'tasks') main.innerHTML = renderTasks();
  else main.innerHTML = renderSettings();
  renderEditor();
}

function renderToday() {
  const t = today();
  const key = ui.viewKey;
  const items = itemsForDay(S(), key, t);
  const open = items.filter((i) => !i.entry.done && !i.entry.skipped);
  const closed = items.filter((i) => i.entry.done || i.entry.skipped);
  const doneCount = items.filter((i) => i.entry.done).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const isPast = key < t;

  return `
    <header class="day-header">
      <button class="icon-btn" data-action="prev-day" aria-label="Previous day">‹</button>
      <div class="day-title">
        <h1>${esc(formatDay(key, t))}</h1>
        <div class="day-sub">${esc(formatLongDate(key))}${key !== t ? ` · <button class="link" data-action="go-today">Back to today</button>` : ''}</div>
      </div>
      <button class="icon-btn" data-action="next-day" aria-label="Next day">›</button>
    </header>

    ${items.length ? `
      <div class="progress-row">
        <div class="bar"><span style="width:${pct}%"></span></div>
        <span class="muted">${doneCount} of ${items.length} done</span>
      </div>` : ''}

    <form class="quick-add" data-form="quick-add">
      <input id="quick-input" type="text" placeholder="${isPast ? 'Add a task to this day' : key === t ? 'Add a task (or “tomorrow …”)' : 'Add a task for this day'}" autocomplete="off" enterkeyhint="done" />
      <button type="submit" class="btn primary" aria-label="Add">Add</button>
    </form>

    <ul class="items">
      ${open.map((i) => renderItem(i, key)).join('')}
    </ul>

    ${!items.length ? `<p class="empty">Nothing planned. Add a task above, or set up repeating tasks in the Tasks tab.</p>` : ''}
    ${items.length && !open.length ? `<p class="empty">All done for ${key === t ? 'today' : 'this day'}. 🎉</p>` : ''}

    ${closed.length ? `
      <button class="section-toggle" data-action="toggle-done">
        ${ui.doneOpen ? '▾' : '▸'} Done (${closed.length})
      </button>
      ${ui.doneOpen ? `<ul class="items done-list">${closed.map((i) => renderItem(i, key)).join('')}</ul>` : ''}
      ${key === t ? '<p class="hint">Finished tasks clear off at the end of the day.</p>' : ''}
    ` : ''}
  `;
}

function renderItem({ task, entry, carried, ref, dayNum, span }, key) {
  const expanded = ui.expanded.has(task.id);
  const subs = visibleSubtasks(task, entry);
  const subsDone = subs.filter((s) => entry.subs[s.id]).length;
  const badges = [];
  if (span > 1 && !carried) badges.push(`<span class="badge multi">Day ${dayNum} of ${span}</span>`);
  if (carried) badges.push('<span class="badge warn">Carried over</span>');
  if (hasLevels(task)) badges.push(`<span class="badge">${esc(task.levels[entry.level ?? 0])}</span>`);
  if (subs.length) badges.push(`<span class="badge">${subsDone}/${subs.length} steps</span>`);
  if (task.timeGoal) {
    badges.push(`<span class="badge ${entry.timerStartedAt ? 'live' : ''}">${formatMinutes(entry.minutes)}${entry.goal ? ` / ${formatMinutes(entry.goal)}` : ''}${entry.timerStartedAt ? ' ⏱' : ''}</span>`);
  }
  if (entry.skipped) badges.push('<span class="badge">Skipped</span>');

  return `
    <li class="item ${entry.done ? 'is-done' : ''} ${entry.skipped ? 'is-skipped' : ''}" data-id="${task.id}" data-start="${ref.start}">
      <div class="item-row">
        <button class="check ${entry.done ? 'on' : ''}" data-action="toggle" aria-label="${entry.done ? 'Mark not done' : 'Mark done'}">
          <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </button>
        <button class="item-main" data-action="expand">
          <span class="title">${esc(task.title)}</span>
          ${badges.length ? `<span class="badges">${badges.join('')}</span>` : ''}
        </button>
        <span class="chev">${expanded ? '▾' : '▸'}</span>
      </div>
      ${expanded ? renderDetails(task, entry, key, subs, span) : ''}
    </li>
  `;
}

function renderDetails(task, entry, key, subs, span) {
  const parts = [];
  if (hasLevels(task)) {
    parts.push(`
      <div class="levels" role="group" aria-label="Level">
        ${task.levels.map((name, i) => `
          <button class="chip ${entry.level === i ? 'on' : ''}" data-action="level" data-level="${i}">${esc(name)}</button>
        `).join('')}
      </div>`);
  }
  if (subs.length) {
    parts.push(`
      <ul class="subs">
        ${subs.map((s) => `
          <li>
            <button class="sub ${entry.subs[s.id] ? 'on' : ''}" data-action="sub" data-sub="${s.id}">
              <span class="mini-check"></span>
              <span>${esc(s.title)}</span>
            </button>
          </li>`).join('')}
      </ul>`);
  }
  if (task.timeGoal) {
    const pct = entry.goal ? Math.min(100, Math.round((entry.minutes / entry.goal) * 100)) : 0;
    parts.push(`
      <div class="timebox">
        <div class="time-head">
          <strong>${formatMinutes(entry.minutes)}</strong>
          <span class="muted">${entry.goal ? `of ${formatMinutes(entry.goal)} goal` : 'logged'}</span>
        </div>
        ${entry.goal ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ''}
        <div class="time-btns">
          <button class="btn small" data-action="mins" data-mins="-5">−5m</button>
          <button class="btn small" data-action="mins" data-mins="15">+15m</button>
          <button class="btn small" data-action="mins" data-mins="30">+30m</button>
          <button class="btn small" data-action="mins" data-mins="60">+1h</button>
        </div>
        <div class="time-btns">
          ${entry.timerStartedAt
            ? `<button class="btn small primary" data-action="timer-stop">Stop timer · <span class="timer" data-start="${entry.timerStartedAt}">${timerText(entry.timerStartedAt)}</span></button>`
            : '<button class="btn small" data-action="timer-start">▶ Start timer</button>'}
          <button class="btn small" data-action="set-mins">Set total…</button>
          <button class="btn small" data-action="set-goal">Change goal…</button>
        </div>
      </div>`);
  }
  if (task.notes) parts.push(`<p class="notes">${esc(task.notes)}</p>`);

  const actions = [];
  if (isRepeating(task)) {
    actions.push(entry.skipped
      ? '<button class="link" data-action="unskip">Undo skip</button>'
      : `<button class="link" data-action="skip">${span > 1 ? 'Skip this time' : 'Skip this day'}</button>`);
  } else {
    actions.push('<button class="link" data-action="tomorrow">Move to next day</button>');
  }
  actions.push('<button class="link" data-action="edit">Edit task</button>');
  if (!isRepeating(task)) actions.push('<button class="link danger" data-action="delete">Delete</button>');
  parts.push(`<div class="item-actions">${actions.join('')}</div>`);

  return `<div class="details">${parts.join('')}</div>`;
}

function timerText(start) {
  const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function renderTasks() {
  const t = today();
  const repeating = S().tasks.filter((x) => isRepeating(x) && !x.archived)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const upcoming = S().tasks.filter((x) => !isRepeating(x) && !x.archived && !x.completedOn)
    .sort((a, b) => (a.schedule.date || '').localeCompare(b.schedule.date || ''));

  const row = (task, sub) => `
    <li class="task-row ${ui.editor?.id === task.id ? 'selected' : ''}" data-id="${task.id}">
      <button class="task-open" data-action="edit">
        <span class="title">${esc(task.title)}</span>
        <span class="muted small">${esc(sub)}</span>
      </button>
    </li>`;

  const extras = (task) => {
    const bits = [describeSchedule(task)];
    if (task.subtasks?.length) bits.push(`${task.subtasks.length} steps`);
    if (hasLevels(task)) bits.push(`${task.levels.length} levels`);
    if (task.timeGoal) bits.push(`${formatMinutes(task.timeGoal.minutes)} goal`);
    if ((task.spanDays || 1) > 1) bits.push(`takes ${task.spanDays} days`);
    return bits.join(' · ');
  };

  return `
    <header class="page-header">
      <h1>Tasks</h1>
      <button class="btn primary" data-action="new-task">+ New task</button>
    </header>

    <h2 class="section">Repeating</h2>
    ${repeating.length
      ? `<ul class="task-list">${repeating.map((x) => row(x, extras(x))).join('')}</ul>`
      : '<p class="empty">No repeating tasks yet. Try "Clean the kitchen" every day or "Gym" on Sun, Tue and Thu.</p>'}

    <h2 class="section">One-time</h2>
    ${upcoming.length
      ? `<ul class="task-list">${upcoming.map((x) => row(x, `${formatDay(x.schedule.date, t)}${x.schedule.date < t ? ' (overdue)' : ''}`)).join('')}</ul>`
      : '<p class="empty">No open one-time tasks.</p>'}
  `;
}

function renderSettings() {
  const st = S().settings;
  const hours = [0, 1, 2, 3, 4, 5, 6];
  const fmtHour = (h) => (h === 0 ? 'Midnight' : `${h}:00 am`);
  return `
    <header class="page-header"><h1>Settings</h1></header>

    <div class="card">
      <label class="field">
        <span>A new day starts at</span>
        <select data-setting="dayStartHour">
          ${hours.map((h) => `<option value="${h}" ${st.dayStartHour === h ? 'selected' : ''}>${fmtHour(h)}</option>`).join('')}
        </select>
      </label>
      <p class="hint">Anything you check off before this time still counts for the day before.</p>
      <label class="field row">
        <input type="checkbox" data-setting="carryOver" ${st.carryOver ? 'checked' : ''} />
        <span>Carry unfinished one-time tasks over to the next day</span>
      </label>
    </div>

    <div class="card">
      <h2 class="section tight">Backup</h2>
      <p class="hint">Your tasks are saved on this device. Download a backup now and then, or use it to move your data to another device until syncing is added.</p>
      <div class="btn-row">
        <button class="btn" data-action="export">Download backup</button>
        <label class="btn">Restore backup<input type="file" accept="application/json,.json" data-action="import" hidden /></label>
      </div>
    </div>

    <div class="card">
      <h2 class="section tight">Install on iPhone</h2>
      <p class="hint">Open this page in Safari, tap the Share button, then <strong>Add to Home Screen</strong>. It then opens like a regular app and works offline.</p>
    </div>

    <div class="card">
      <button class="btn danger" data-action="erase">Erase all data</button>
    </div>
  `;
}

// ---------- Task editor ----------

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${s}`;
}

function blankDraft() {
  return {
    id: null,
    title: '',
    notes: '',
    schedule: { type: 'daily', days: [], every: 2, day: 1, by: 'day', nth: '1', weekday: 6, date: today() },
    startDate: today(),
    levels: [],
    levelDefault: 0,
    levelRules: [],
    subtasks: [],
    useTime: false,
    timeGoal: { minutes: 60, byDay: {} },
    spanDays: 1,
    levelDays: {},
  };
}

// Starting level for a step in the editor: 'default' or a level number.
function stepFrom(sub) {
  if (sub.from != null) return sub.from === 'default' ? 'default' : Number(sub.from);
  if (Array.isArray(sub.in)) return sub.in.length ? Math.min(...sub.in) : 'default';
  if (sub.level != null) return Number(sub.level);
  return 'default';
}

function draftFromTask(task) {
  const d = blankDraft();
  return {
    ...d,
    id: task.id,
    title: task.title,
    notes: task.notes || '',
    schedule: { ...d.schedule, ...structuredClone(task.schedule) },
    startDate: task.startDate || today(),
    levels: hasLevels(task) ? [...task.levels] : [],
    levelDefault: task.levelDefault ?? 0,
    levelRules: structuredClone(levelRules(task)).map((r) => ({ ...r, nth: String(r.nth ?? 'every') })),
    subtasks: (task.subtasks || []).map((sub) => ({
      id: sub.id,
      title: sub.title,
      from: stepFrom(sub),
    })),
    useTime: !!task.timeGoal,
    timeGoal: task.timeGoal ? structuredClone({ byDay: {}, ...task.timeGoal }) : d.timeGoal,
    spanDays: task.spanDays || 1,
    levelDays: { ...(task.levelDays || {}) },
  };
}

function openEditor(task) {
  ui.editor = task ? draftFromTask(task) : blankDraft();
  render();
  setTimeout(() => { if (!task) $('#ed-title')?.focus(); }, 50);
}

function closeEditor() {
  ui.editor = null;
  render();
}

function relevantDays(d) {
  if (d.schedule.type === 'weekly') return [...d.schedule.days].sort();
  if (d.schedule.type === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  return [];
}

function renderStepLevel(d, sub, i) {
  const usual = d.levels[d.levelDefault] || `Level ${(d.levelDefault ?? 0) + 1}`;
  return `
    <select class="step-level" data-bind="subtasks.${i}.from" aria-label="Level for this step">
      <option value="default" ${sub.from === 'default' ? 'selected' : ''}>Default (${esc(usual)})</option>
      ${d.levels.map((n, j) => `<option value="${j}" ${sub.from !== 'default' && Number(sub.from) === j ? 'selected' : ''}>${esc(n || `Level ${j + 1}`)}</option>`).join('')}
    </select>`;
}

function renderEditor() {
  const root = $('#editor');
  const d = ui.editor;
  if (!d) {
    root.innerHTML = '';
    root.hidden = true;
    document.body.classList.remove('modal-open');
    return;
  }
  root.hidden = false;
  document.body.classList.add('modal-open');
  const s = d.schedule;
  const days = relevantDays(d);
  const levelOptions = (selected, includeBlank) => `
    ${includeBlank ? `<option value="" ${selected === undefined || selected === '' ? 'selected' : ''}>Default</option>` : ''}
    ${d.levels.map((n, i) => `<option value="${i}" ${String(selected) === String(i) ? 'selected' : ''}>${esc(n || `Level ${i + 1}`)}</option>`).join('')}`;

  root.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${d.id ? 'Edit task' : 'New task'}">
      <header class="sheet-header">
        <button class="link" data-ed="cancel">Cancel</button>
        <strong>${d.id ? 'Edit task' : 'New task'}</strong>
        <button class="link strong" data-ed="save">Save</button>
      </header>
      <div class="sheet-body">
        <label class="field">
          <span>Task</span>
          <input id="ed-title" type="text" data-bind="title" value="${esc(d.title)}" placeholder="e.g. Clean the kitchen" />
        </label>

        <div class="card">
          <label class="field">
            <span>When</span>
            <select data-bind="schedule.type" data-rerender>
              <option value="once" ${s.type === 'once' ? 'selected' : ''}>One time</option>
              <option value="daily" ${s.type === 'daily' ? 'selected' : ''}>Every day</option>
              <option value="weekly" ${s.type === 'weekly' ? 'selected' : ''}>On certain weekdays</option>
              <option value="interval" ${s.type === 'interval' ? 'selected' : ''}>Every few days</option>
              <option value="monthly" ${s.type === 'monthly' ? 'selected' : ''}>Once a month</option>
            </select>
          </label>
          ${s.type === 'once' ? `
            <label class="field"><span>Date</span><input type="date" data-bind="schedule.date" value="${esc(s.date)}" /></label>` : ''}
          ${s.type === 'weekly' ? `
            <div class="weekdays">
              ${WEEKDAYS.map((n, i) => `<button class="chip ${s.days.includes(i) ? 'on' : ''}" data-ed="weekday" data-day="${i}">${n}</button>`).join('')}
            </div>` : ''}
          ${s.type === 'interval' ? `
            <label class="field"><span>Every how many days</span><input type="number" min="1" inputmode="numeric" data-bind="schedule.every" data-num value="${esc(s.every)}" /></label>` : ''}
          ${s.type === 'monthly' ? `
            <div class="rule-line">
              <select data-bind="schedule.by" data-rerender aria-label="Monthly by">
                <option value="day" ${s.by !== 'weekday' ? 'selected' : ''}>On a date</option>
                <option value="weekday" ${s.by === 'weekday' ? 'selected' : ''}>On a weekday</option>
              </select>
              ${s.by === 'weekday' ? `
                <select data-bind="schedule.nth" aria-label="Which week">
                  ${[['1', 'first'], ['2', 'second'], ['3', 'third'], ['4', 'fourth'], ['last', 'last']].map(([v, l]) => `<option value="${v}" ${String(s.nth) === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
                <select data-bind="schedule.weekday" data-num aria-label="Weekday">
                  ${WEEKDAYS.map((w, j) => `<option value="${j}" ${Number(s.weekday) === j ? 'selected' : ''}>${w}</option>`).join('')}
                </select>
                <span class="muted small">of the month</span>
              ` : `
                <select data-bind="schedule.day" aria-label="Day of the month">
                  ${Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${String(s.day) === String(n) ? 'selected' : ''}>${ordinal(n)}</option>`).join('')}
                  <option value="last" ${s.day === 'last' ? 'selected' : ''}>last day</option>
                </select>
                <span class="muted small">of the month</span>
              `}
            </div>
            ${s.by !== 'weekday' && Number(s.day) > 28 ? '<p class="hint">In shorter months this happens on the last day.</p>' : ''}` : ''}
          ${s.type !== 'once' ? `
            <label class="field"><span>Starting</span><input type="date" data-bind="startDate" value="${esc(d.startDate)}" /></label>` : ''}
          <label class="field inline"><span class="wide-label">Takes</span>
            <span class="days-input"><input type="number" min="1" max="14" inputmode="numeric" data-bind="spanDays" data-num value="${esc(d.spanDays)}" /> day(s)</span>
          </label>
          ${Number(d.spanDays) > 1 || (d.levels.length && Object.values(d.levelDays).some((v) => v > 1)) ? '<p class="hint">A multi-day task stays on your list until it’s done or its days run out, and checked steps carry over from day to day.</p>' : ''}
        </div>

        <div class="card">
          <h3>Levels <span class="muted small">(optional)</span></h3>
          ${!d.levels.length ? '<p class="hint flush">Add levels like Light, Normal and Deep if this task can be done in different ways.</p>' : ''}
            <ul class="ed-levels">
              ${d.levels.map((n, i) => `
                <li>
                  <input type="text" data-bind="levels.${i}" value="${esc(n)}" placeholder="${esc(DEFAULT_LEVELS[i] ? `e.g. ${DEFAULT_LEVELS[i]}` : `Level ${i + 1}`)}" />
                  <span class="days-input small" title="Days this level takes"><input type="number" min="1" max="14" inputmode="numeric" placeholder="${esc(d.spanDays || 1)}" data-bind="levelDays.${i}" data-num data-optional value="${esc(d.levelDays[i] ?? '')}" /> d</span>
                  <button class="icon-btn small" data-ed="remove-level" data-index="${i}" aria-label="Remove level">×</button>
                </li>`).join('')}
            </ul>
            <button class="btn small" data-ed="add-level">+ Add level</button>
          ${d.levels.length ? `
            <p class="hint">The small box is how many days a level takes, e.g. 3 for a complete clean. Leave it empty for the usual.</p>
            <label class="field"><span>Usual level</span><select data-bind="levelDefault" data-num data-rerender>${levelOptions(d.levelDefault)}</select></label>
            ${s.type !== 'once' ? `
              <div class="rules">
                <span class="field-label">Different level on some days</span>
                ${d.levelRules.map((r, k) => `
                  <div class="rule">
                    <div class="rule-line">
                    <select data-bind="levelRules.${k}.level" data-num aria-label="Level">${levelOptions(r.level)}</select>
                    <span class="muted">on</span>
                    <select data-bind="levelRules.${k}.nth" data-rerender aria-label="Which week">
                      ${[['every', 'every'], ['1', 'first'], ['2', 'second'], ['3', 'third'], ['4', 'fourth'], ['last', 'last']].map(([v, label]) => `<option value="${v}" ${String(r.nth) === v ? 'selected' : ''}>${label}</option>`).join('')}
                    </select>
                    <select data-bind="levelRules.${k}.weekday" data-num aria-label="Weekday">
                      ${WEEKDAYS.map((w, j) => `<option value="${j}" ${Number(r.weekday) === j ? 'selected' : ''}>${w}</option>`).join('')}
                    </select>
                    ${r.nth !== 'every' ? '<span class="muted small">of the month</span>' : ''}
                    </div>
                    <button class="icon-btn small" data-ed="remove-rule" data-index="${k}" aria-label="Remove rule">×</button>
                  </div>`).join('')}
                <button class="btn small" data-ed="add-rule">+ Add rule</button>
                ${d.levelRules.length ? '<p class="hint">If two rules match the same day, the one with first/last/etc. wins, so “Complete on the last Saturday” beats “Deep every Saturday”.</p>' : ''}
              </div>` : ''}
          ` : ''}
        </div>

        <div class="card">
          <h3>Steps</h3>
          <ul class="ed-subs">
            ${d.subtasks.map((sub, i) => `
              <li>
                <input type="text" data-bind="subtasks.${i}.title" value="${esc(sub.title)}" placeholder="Step ${i + 1}" />
                ${d.levels.length ? renderStepLevel(d, sub, i) : ''}
                <button class="icon-btn small" data-ed="remove-sub" data-index="${i}" aria-label="Remove step">×</button>
              </li>`).join('')}
          </ul>
          <button class="btn small" data-ed="add-sub">+ Add step</button>
          ${d.levels.length && d.subtasks.length ? '<p class="hint">A step shows at the level next to it and every level above. “Default” follows your usual level, so if you change the usual level, those steps move with it.</p>' : ''}
        </div>

        <div class="card">
          <label class="field row">
            <input type="checkbox" data-bind="useTime" data-rerender ${d.useTime ? 'checked' : ''} />
            <span><strong>Time goal</strong> (like studying 1 hour)</span>
          </label>
          ${d.useTime ? `
            <label class="field"><span>Usual goal (minutes)</span><input type="number" min="0" step="5" inputmode="numeric" data-bind="timeGoal.minutes" data-num value="${esc(d.timeGoal.minutes)}" /></label>
            ${days.length ? `
              <details class="per-day" ${Object.keys(d.timeGoal.byDay || {}).length ? 'open' : ''}>
                <summary>Different goal on some days</summary>
                ${days.map((wd) => `
                  <label class="field inline"><span>${WEEKDAYS[wd]}</span>
                    <input type="number" min="0" step="5" inputmode="numeric" placeholder="${esc(d.timeGoal.minutes)}" data-bind="timeGoal.byDay.${wd}" data-num data-optional value="${esc(d.timeGoal.byDay?.[wd] ?? '')}" />
                  </label>`).join('')}
              </details>` : ''}
          ` : ''}
        </div>

        <label class="field">
          <span>Notes</span>
          <textarea rows="2" data-bind="notes" placeholder="Optional">${esc(d.notes)}</textarea>
        </label>

        ${d.id ? '<button class="btn danger wide" data-ed="delete">Delete task</button>' : ''}
      </div>
    </div>
  `;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = value;
}

function bindInput(el) {
  const d = ui.editor;
  if (!d) return;
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.dataset.num !== undefined) {
    value = el.value === '' ? (el.dataset.optional !== undefined ? undefined : 0) : Number(el.value);
  } else value = el.value;
  setPath(d, el.dataset.bind, value);
  if (el.dataset.rerender !== undefined) renderEditor();
}

function saveEditor() {
  const d = ui.editor;
  if (!d.title.trim()) {
    alert('Give the task a name first.');
    $('#ed-title')?.focus();
    return;
  }
  if (d.schedule.type === 'weekly' && !d.schedule.days.length) {
    alert('Pick at least one weekday.');
    return;
  }
  const sched = { type: d.schedule.type };
  if (sched.type === 'once') sched.date = d.schedule.date || today();
  if (sched.type === 'weekly') sched.days = [...d.schedule.days].sort();
  if (sched.type === 'interval') sched.every = Math.max(1, Number(d.schedule.every) || 1);
  if (sched.type === 'monthly') {
    if (d.schedule.by === 'weekday') {
      sched.by = 'weekday';
      sched.nth = d.schedule.nth === 'last' ? 'last' : Number(d.schedule.nth) || 1;
      sched.weekday = Number(d.schedule.weekday) || 0;
    } else {
      sched.day = d.schedule.day === 'last' ? 'last' : Math.min(31, Math.max(1, Number(d.schedule.day) || 1));
    }
  }

  const levels = d.levels.map((n, i) => n.trim() || `Level ${i + 1}`);
  const clampLevel = (v) => Math.min(Math.max(0, Number(v) || 0), Math.max(0, levels.length - 1));
  const cleanByDay = (obj, fn) => Object.fromEntries(
    Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, fn(v)]),
  );

  const fields = {
    title: d.title.trim(),
    notes: d.notes.trim(),
    schedule: sched,
    startDate: sched.type === 'once' ? undefined : d.startDate || today(),
    levels,
    levelDefault: levels.length ? clampLevel(d.levelDefault) : undefined,
    levelByDay: undefined,
    levelRules: levels.length
      ? d.levelRules.map((r) => ({
        level: clampLevel(r.level),
        weekday: Math.min(6, Math.max(0, Number(r.weekday) || 0)),
        nth: r.nth === 'every' || r.nth === 'last' ? r.nth : Number(r.nth),
      }))
      : [],
    subtasks: d.subtasks
      .filter((s) => s.title.trim())
      .map((s) => {
        const step = { id: s.id || uid(), title: s.title.trim() };
        if (levels.length) step.from = s.from === 'default' || s.from == null ? 'default' : clampLevel(s.from);
        return step;
      }),
    spanDays: Math.min(14, Math.max(1, Number(d.spanDays) || 1)),
    levelDays: levels.length ? cleanByDay(d.levelDays, (v) => Math.min(14, Math.max(1, Number(v) || 1))) : {},
    timeGoal: d.useTime
      ? { minutes: Math.max(0, Number(d.timeGoal.minutes) || 0), byDay: cleanByDay(d.timeGoal.byDay, (v) => Math.max(0, Number(v) || 0)) }
      : null,
    updatedAt: Date.now(),
  };

  if (d.id) {
    const task = findTask(d.id);
    Object.assign(task, fields);
    // Apply the edited level and goal to today's entry too.
    const entry = S().days[today()]?.items?.[task.id];
    if (entry) {
      const fresh = getEntry({ days: {} }, today(), task);
      entry.level = fresh.level;
      entry.goal = fresh.goal;
    }
  } else {
    S().tasks.push({ id: uid(), order: nextOrder(S()), createdAt: Date.now(), ...fields });
  }
  ui.editor = null;
  store.save();
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------- Events ----------

function onClick(e) {
  const tabBtn = e.target.closest('.tabbar button');
  if (tabBtn) {
    ui.tab = tabBtn.dataset.tab;
    if (ui.tab === 'today') ui.viewKey = today();
    render();
    window.scrollTo(0, 0);
    return;
  }

  const ed = e.target.closest('[data-ed]');
  if (ed && ui.editor) {
    e.preventDefault();
    const d = ui.editor;
    switch (ed.dataset.ed) {
      case 'cancel': closeEditor(); break;
      case 'save': saveEditor(); break;
      case 'weekday': {
        const day = Number(ed.dataset.day);
        const set = new Set(d.schedule.days);
        set.has(day) ? set.delete(day) : set.add(day);
        d.schedule.days = [...set].sort();
        renderEditor();
        break;
      }
      case 'add-sub':
        d.subtasks.push({ id: uid(), title: '', from: 'default' });
        renderEditor();
        $(`[data-bind="subtasks.${d.subtasks.length - 1}.title"]`)?.focus();
        break;
      case 'remove-sub':
        d.subtasks.splice(Number(ed.dataset.index), 1);
        renderEditor();
        break;
      case 'add-rule': {
        const top = Math.max(0, d.levels.length - 1);
        d.levelRules.push({ level: Math.min(top, (d.levelDefault ?? 0) + 1), weekday: 6, nth: 'every' });
        renderEditor();
        break;
      }
      case 'remove-rule':
        d.levelRules.splice(Number(ed.dataset.index), 1);
        renderEditor();
        break;
      case 'add-level':
        d.levels.push('');
        renderEditor();
        $(`[data-bind="levels.${d.levels.length - 1}"]`)?.focus();
        break;
      case 'remove-level': {
        const i = Number(ed.dataset.index);
        d.levels.splice(i, 1);
        const fix = (v) => (v > i ? v - 1 : v === i ? Math.max(0, i - 1) : v);
        d.subtasks.forEach((s) => { if (s.from !== 'default') s.from = fix(Number(s.from)); });
        d.levelDefault = fix(d.levelDefault ?? 0);
        d.levelRules = d.levelRules.filter((r) => Number(r.level) !== i)
          .map((r) => ({ ...r, level: Number(r.level) > i ? Number(r.level) - 1 : Number(r.level) }));
        const days = {};
        for (const [k, v] of Object.entries(d.levelDays)) {
          const n = Number(k);
          if (n < i) days[n] = v; else if (n > i) days[n - 1] = v;
        }
        d.levelDays = days;
        renderEditor();
        break;
      }
      case 'delete': {
        const task = findTask(d.id);
        if (task && confirm(`Delete "${task.title}"? Past history is kept for reports.`)) {
          deleteTask(S(), task);
          ui.editor = null;
          store.save();
        }
        break;
      }
    }
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const li = btn.closest('[data-id]');
  const task = li ? findTask(li.dataset.id) : null;
  const key = ui.viewKey;
  const ref = li ? { start: li.dataset.start || key, on: key } : null;

  switch (action) {
    case 'prev-day': ui.viewKey = addDays(key, -1); ui.expanded.clear(); render(); break;
    case 'next-day': ui.viewKey = addDays(key, 1); ui.expanded.clear(); render(); break;
    case 'go-today': ui.viewKey = today(); render(); break;
    case 'toggle-done': ui.doneOpen = !ui.doneOpen; render(); break;
    case 'expand':
      ui.expanded.has(task.id) ? ui.expanded.delete(task.id) : ui.expanded.add(task.id);
      render();
      break;
    case 'toggle': {
      const entry = getEntry(S(), ref.start, task);
      const isDone = entry.done && (!entry.doneOn || entry.doneOn <= key);
      setDone(S(), ref, task, !isDone);
      if (!isDone) ui.expanded.delete(task.id);
      store.save();
      break;
    }
    case 'sub': toggleSub(S(), ref, task, btn.dataset.sub); store.save(); break;
    case 'level': setLevel(S(), ref, task, Number(btn.dataset.level)); store.save(); break;
    case 'mins': addMinutes(S(), ref, task, Number(btn.dataset.mins)); store.save(); break;
    case 'set-mins': {
      const entry = getEntry(S(), ref.start, task);
      const v = prompt('Total minutes:', String(entry.minutes || 0));
      if (v !== null && v.trim() !== '' && !Number.isNaN(Number(v))) { setMinutes(S(), ref, task, Number(v)); store.save(); }
      break;
    }
    case 'set-goal': {
      const entry = getEntry(S(), ref.start, task);
      const v = prompt('Goal for this time only (minutes):', String(entry.goal || 0));
      if (v !== null && v.trim() !== '' && !Number.isNaN(Number(v))) { setGoal(S(), ref, task, Number(v)); store.save(); }
      break;
    }
    case 'timer-start': startTimer(S(), ref, task); store.save(); break;
    case 'timer-stop': stopTimer(S(), ref, task); store.save(); break;
    case 'skip': setSkipped(S(), ref, task, true); ui.expanded.delete(task.id); store.save(); break;
    case 'unskip': setSkipped(S(), ref, task, false); store.save(); break;
    case 'tomorrow': moveOnceTask(S(), task, addDays(key < today() ? today() : key, 1)); ui.expanded.delete(task.id); store.save(); break;
    case 'delete':
      if (confirm(`Delete "${task.title}"?`)) { deleteTask(S(), task); store.save(); }
      break;
    case 'edit': openEditor(task); break;
    case 'new-task': openEditor(null); break;
    case 'export': exportData(); break;
    case 'erase':
      if (confirm('Erase all tasks and history on this device? This cannot be undone.')) {
        store.replace({});
      }
      break;
  }
}

function onSubmit(e) {
  const form = e.target.closest('[data-form="quick-add"]');
  if (!form) return;
  e.preventDefault();
  const input = $('#quick-input');
  const { title, key } = parseQuickAdd(input.value, ui.viewKey);
  if (!title) return;
  addQuickTask(S(), title, key);
  store.save();
  if (key !== ui.viewKey) toast(`Added to ${formatDay(key, today()).toLowerCase()}'s list`);
  $('#quick-input')?.focus();
}

function onChange(e) {
  const el = e.target;
  if (el.dataset.bind) { bindInput(el); return; }
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    S().settings[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
    if (k === 'dayStartHour') ui.viewKey = today();
    store.save();
    return;
  }
  if (el.dataset.action === 'import' && el.files?.[0]) importData(el.files[0]);
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.bind && el.dataset.rerender === undefined) bindInput(el);
  // Renaming a level updates the step buttons without redrawing the form.
  const m = el.dataset.bind?.match(/^levels\.(\d+)$/);
  if (m) {
    document.querySelectorAll(`.step-levels [data-level="${m[1]}"]`).forEach((b) => {
      b.textContent = el.value || `Level ${Number(m[1]) + 1}`;
    });
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify(S(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `todo-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.tasks)) throw new Error('not a backup');
    if (confirm('Replace everything on this device with this backup?')) {
      store.replace(data);
      alert('Backup restored.');
    }
  } catch {
    alert('That file is not a backup from this app.');
  }
}

// ---------- Start ----------

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);
document.addEventListener('change', onChange);
document.addEventListener('input', onInput);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.editor) closeEditor();
});

store.subscribe(() => {
  // Don't wipe the editor while typing; it re-renders itself.
  const main = $('#main');
  const scroll = window.scrollY;
  render();
  if (main) window.scrollTo(0, scroll);
});

// Roll over to a new day while the app stays open, and keep timers ticking.
let lastToday = today();
function tick() {
  const t = today();
  if (t !== lastToday) {
    if (ui.viewKey === lastToday) ui.viewKey = t;
    lastToday = t;
    ui.expanded.clear();
    render();
  }
  document.querySelectorAll('.timer[data-start]').forEach((el) => {
    el.textContent = timerText(Number(el.dataset.start));
  });
}
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
