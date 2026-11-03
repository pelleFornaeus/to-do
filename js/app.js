import { store } from './store.js';
import { sync } from './sync.js';
import {
  computeHistory, perWeek, rangeStart, reportText, shortDate, weeklyBuckets, weekReview, yearReview, MONTH_NAMES,
} from './history.js';
import {
  WEEKDAYS, addDays, formatDay, formatLongDate, formatMinutes, logicalToday,
} from './dates.js';
import {
  DEFAULT_LEVELS, levelRules, addMinutes, addQuickTask, deleteTask, describeSchedule, getEntry,
  activePause, addWheneverDate, clearHistoryBefore, isWhenever, nextWheneverDate,
  removeWheneverDate, upcomingItems, activeTrip, endTrip, startTrip, isPerWeek, reorderTasks, streak, weekDone, isDayOff, isPaused, pauseTask, resumeTask, setDayOff,
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
  upcomingOpen: true,
  travel: null, // travel mode form
  page: null, // 'week' or 'year' inside History
  year: null,
  editor: null, // draft task being edited
  histRange: '30',
};

const S = () => store.state;
const today = () => logicalToday(S().settings.dayStartHour);
const findTask = (id) => S().tasks.find((t) => t.id === id);

// ---------- Rendering ----------

// Redraws keep whatever is being typed (a sync can redraw at any moment).
function keepTyping(fn) {
  const a = document.activeElement;
  const sel = a?.id ? `#${a.id}` : a?.dataset?.bind ? `[data-bind="${a.dataset.bind}"]` : null;
  const quick = $('#quick-input')?.value;
  const pos = sel && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (quick) { const q = $('#quick-input'); if (q && !q.value) q.value = quick; }
  if (sel) {
    const el = $(sel);
    if (el && el !== document.activeElement) {
      el.focus({ preventScroll: true });
      if (pos) try { el.setSelectionRange(...pos); } catch { /* not a text field */ }
    }
  }
}

function render() { keepTyping(renderAll); }

function renderAll() {
  const t = today();
  if (!ui.viewKey) ui.viewKey = t;
  if (snapshotPlanned(S(), t, t)) store.save();

  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === ui.tab);
  });
  const main = $('#main');
  if (ui.tab === 'today') main.innerHTML = ui.travel ? renderTravel() : renderToday();
  else if (ui.tab === 'tasks') main.innerHTML = renderTasks();
  else if (ui.tab === 'history') main.innerHTML = ui.page === 'week' ? renderWeekReview() : ui.page === 'year' ? renderYearReview() : renderHistory();
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
  const dayOff = isDayOff(S(), key);
  const offNote = S().days[key]?.dayOff?.note;

  return `
    <header class="day-header">
      <button class="icon-btn" data-action="prev-day" aria-label="Previous day">‹</button>
      <div class="day-title">
        <h1>${esc(formatDay(key, t))}</h1>
        <div class="day-sub">${esc(formatLongDate(key))}${key !== t ? ` · <button class="link" data-action="go-today">Back to today</button>` : ''}</div>
      </div>
      <button class="icon-btn" data-action="next-day" aria-label="Next day">›</button>
    </header>

    ${key === t ? renderTripBanner(t) : ''}
    ${key === t ? renderReviewCard(t) : ''}

    ${dayOff ? `
      <div class="day-off-banner">
        <div><strong>Day off${offNote ? `: ${esc(offNote)}` : ''}</strong><br><span class="small">Nothing on this day counts as missed.</span></div>
        <button class="btn small" data-action="day-off-undo">Undo</button>
      </div>` : ''}

    ${items.length ? `
      <div class="progress-row">
        <div class="bar"><span style="width:${pct}%"></span></div>
        <span class="muted">${doneCount} of ${items.length} done</span>
      </div>` : ''}

    <form class="quick-add" data-form="quick-add">
      <input id="quick-input" type="text" placeholder="${isPast ? 'Add a task to this day' : key === t ? 'Add a task (try “friday …”)' : 'Add a task for this day'}" autocomplete="off" enterkeyhint="done" />
      <button type="submit" class="btn primary" aria-label="Add">Add</button>
    </form>

    <ul class="items">
      ${open.map((i) => renderItem(i, key, open.length > 1)).join('')}
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

    ${key === t ? renderUpcoming(t) : ''}

    <p class="day-off-link">
      ${!dayOff ? '<button class="link" data-action="day-off">Mark as a day off (sick…)</button>' : ''}
      ${key >= t && !activeTrip(S(), t) ? '<button class="link" data-action="travel">Going away? Travel mode</button>' : ''}
    </p>
  `;
}

function renderTripBanner(t) {
  const trip = activeTrip(S(), t);
  if (!trip) return '';
  const started = trip.from <= t;
  const n = trip.taskIds.length;
  return `
    <div class="trip-banner">
      <div><strong>✈️ ${started ? 'Traveling' : 'Trip coming up'}${trip.note ? `: ${esc(trip.note)}` : ''}</strong><br>
      <span class="small">${esc(shortDate(trip.from))} – ${esc(shortDate(trip.to))} · ${n} task${n === 1 ? '' : 's'} paused</span></div>
      <button class="btn small" data-action="end-trip">${started ? 'I’m back' : 'Cancel trip'}</button>
    </div>`;
}

// On the first two days of the week, a short look back at last week.
function renderReviewCard(t) {
  const startDay = S().settings.weekStart ?? 1;
  const wk = addDays(t, -((new Date(`${t}T12:00`).getDay() - startDay + 7) % 7));
  if (addDays(wk, 1) < t || S().settings.reviewSeen === wk) return '';
  const r = weekReview(S(), t);
  const o = r.h.overall;
  if (!(o.done + o.missed)) return '';
  return `
    <div class="review-card">
      <button class="icon-btn small review-x" data-action="review-dismiss" data-week="${wk}" aria-label="Dismiss">×</button>
      <strong>Last week: ${o.done} of ${o.done + o.missed} done (${pctText(o.rate)})</strong>
      <span class="small">${r.best.length ? `Nailed it: ${r.best.map((x) => esc(x.task.title)).join(', ')}. ` : ''}${r.missed.length ? `Missed most: ${esc(r.missed[0].task.title)}.` : 'Nothing missed!'}</span>
      <button class="link" data-action="open-week-review">See the full review</button>
    </div>`;
}

function renderTravel() {
  const d = ui.travel;
  const t = today();
  const repeating = S().tasks.filter((x) => isRepeating(x) && !isWhenever(x) && !x.archived)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const lists = S().tasks.filter((x) => isWhenever(x) && !x.archived);
  return `
    <header class="page-header"><button class="link back" data-action="travel-cancel">‹ Today</button></header>
    <h1 class="page-title">Travel mode</h1>
    <p class="hint">Pause what you won't do while you're away. Everything comes back on its own when the trip ends.</p>
    <div class="card">
      <div class="pause-add">
        <label class="field"><span>Leaving</span><input type="date" data-travel="from" value="${esc(d.from)}" min="${esc(t)}" /></label>
        <label class="field"><span>Back</span><input type="date" data-travel="to" value="${esc(d.to)}" min="${esc(d.from)}" /></label>
      </div>
      <label class="field"><span>Where to? (optional)</span><input type="text" data-travel="note" value="${esc(d.note)}" placeholder="e.g. Chicago" /></label>
    </div>
    <div class="card">
      <h2 class="section tight">Pause while away</h2>
      ${repeating.length ? repeating.map((x) => `
        <label class="field row"><input type="checkbox" data-travel-task="${x.id}" ${d.taskIds.includes(x.id) ? 'checked' : ''} /><span>${esc(x.title)} <span class="muted small">· ${esc(describeSchedule(x))}</span></span></label>`).join('')
    : '<p class="hint">No repeating tasks yet.</p>'}
      <p class="hint">Untick anything you'll keep doing, like the gym.</p>
    </div>
    ${lists.length ? `
    <div class="card">
      <h2 class="section tight">Packing list</h2>
      <label class="field"><span>Add a checklist</span>
        <select data-travel="packId">
          <option value="">None</option>
          ${lists.map((x) => `<option value="${x.id}" ${d.packId === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>On</span><input type="date" data-travel="packDate" value="${esc(d.packDate)}" /></label>
    </div>` : ''}
    <div class="btn-row">
      <button class="btn primary" data-action="travel-start">Start travel mode</button>
      <button class="btn" data-action="travel-cancel">Cancel</button>
    </div>`;
}

function renderUpcoming(t) {
  const items = upcomingItems(S(), t, 7);
  if (!items.length) return '';
  return `
    <button class="section-toggle" data-action="toggle-upcoming">
      ${ui.upcomingOpen ? '▾' : '▸'} Coming up (${items.length})
    </button>
    ${ui.upcomingOpen ? `
      <ul class="items upcoming-list">${items.map((i) => renderItem(i, t)).join('')}</ul>
      <p class="hint">Check something off early and it counts for the day it's due.</p>` : ''}`;
}

function renderItem({ task, entry, carried, ref, dayNum, span, due }, key, draggable = false) {
  const expanded = ui.expanded.has(task.id);
  const subs = visibleSubtasks(task, entry);
  const subsDone = subs.filter((s) => entry.subs[s.id]).length;
  const badges = [];
  if (due) badges.push(`<span class="badge due">${entry.done ? 'Done early' : `Due ${esc(formatDay(due, key).replace(/,.*/, ''))}`}</span>`);
  if (span > 1 && !carried && !due) badges.push(`<span class="badge multi">Day ${dayNum} of ${span}</span>`);
  if (carried) badges.push('<span class="badge warn">Carried over</span>');
  if (hasLevels(task)) badges.push(`<span class="badge">${esc(task.levels[entry.level ?? 0])}</span>`);
  if (subs.length) badges.push(`<span class="badge">${subsDone}/${subs.length} steps</span>`);
  if (task.timeGoal) {
    badges.push(`<span class="badge ${entry.timerStartedAt ? 'live' : ''}">${formatMinutes(entry.minutes)}${entry.goal ? ` / ${formatMinutes(entry.goal)}` : ''}${entry.timerStartedAt ? ' ⏱' : ''}</span>`);
  }
  if (isPerWeek(task)) badges.push(`<span class="badge">${weekDone(S(), task, ref.start)} of ${task.schedule.times || 1} this week</span>`);
  const st = isRepeating(task) && !isWhenever(task) ? streak(S(), task, today()) : 0;
  if (st > 1) badges.push(`<span class="badge streak" title="In a row">🔥 ${st}${isPerWeek(task) ? ' wk' : ''}</span>`);
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
        ${draggable ? '<button class="drag-handle" aria-label="Drag to reorder" tabindex="-1"><svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></button>' : `<span class="chev">${expanded ? '▾' : '▸'}</span>`}
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
  if (isWhenever(task)) {
    actions.push('<button class="link" data-action="remove-date">Remove from this day</button>');
  } else if (isRepeating(task)) {
    actions.push(entry.skipped
      ? '<button class="link" data-action="unskip">Undo skip</button>'
      : `<button class="link" data-action="skip">${span > 1 ? 'Skip this time' : 'Skip this day'}</button>`);
  } else {
    actions.push('<button class="link" data-action="tomorrow">Move to next day</button>');
  }
  if (isRepeating(task) && !isWhenever(task)) actions.push('<button class="link" data-action="pause">Pause task</button>');
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
  const whenever = S().tasks.filter((x) => isWhenever(x) && !x.archived)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const onToday = new Set(itemsForDay(S(), t, t).map((i) => i.task.id));
  const repeating = S().tasks.filter((x) => isRepeating(x) && !isWhenever(x) && !x.archived)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const upcoming = S().tasks.filter((x) => !isRepeating(x) && !x.archived && !x.completedOn)
    .sort((a, b) => (a.schedule.date || '').localeCompare(b.schedule.date || ''));

  const pauseLabel = (task) => {
    const p = activePause(task, t);
    if (!p) return '';
    if (p.from > t) return `Pause from ${formatDay(p.from, t)}${p.to ? ` to ${formatDay(p.to, t)}` : ''}`;
    return p.to ? `Paused until ${formatDay(p.to, t)}` : 'Paused';
  };
  const row = (task, sub) => {
    const paused = isRepeating(task) ? pauseLabel(task) : '';
    const now = paused && isPaused(task, t);
    return `
    <li class="task-row ${ui.editor?.id === task.id ? 'selected' : ''} ${now ? 'is-paused' : ''}" data-id="${task.id}">
      ${isRepeating(task) ? '<button class="drag-handle" aria-label="Drag to reorder" tabindex="-1"><svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></button>' : ''}
      <button class="task-open" data-action="edit">
        <span class="title">${esc(task.title)}${paused ? ` <span class="badge paused">${esc(paused)}</span>` : ''}</span>
        <span class="muted small">${esc(sub)}</span>
      </button>
      ${now ? '<button class="btn small" data-action="resume">Resume</button>' : ''}
      ${isWhenever(task) ? (onToday.has(task.id)
        ? '<span class="muted small row-note">On today</span>'
        : '<button class="btn small" data-action="use-today">Add to today</button>') : ''}
    </li>`;
  };
  const wheneverSub = (task) => {
    const bits = [];
    if (task.subtasks?.length) bits.push(`${task.subtasks.length} steps`);
    const next = nextWheneverDate(task, t);
    if (next && next !== t) bits.push(`next: ${formatDay(next, t)}`);
    return bits.join(' · ') || 'Add it to a day when you need it';
  };

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

    <h2 class="section">Whenever</h2>
    ${whenever.length
      ? `<ul class="task-list">${whenever.map((x) => row(x, wheneverSub(x))).join('')}</ul>`
      : '<p class="empty">Checklists you use now and then, like packing a suitcase. Make one with + New task and pick “Whenever I need it”.</p>'}

    <h2 class="section">One-time</h2>
    ${upcoming.length
      ? `<ul class="task-list">${upcoming.map((x) => row(x, `${formatDay(x.schedule.date, t)}${x.schedule.date < t ? ' (overdue)' : ''}`)).join('')}</ul>`
      : '<p class="empty">No open one-time tasks.</p>'}
  `;
}

// ---------- History ----------

const pctText = (r) => (r == null ? '–' : `${Math.round(r * 100)}%`);

function currentHistory() {
  const t = today();
  return computeHistory(S(), rangeStart(ui.histRange, t, S()), t, t);
}

function renderHistory() {
  const ranges = [['7', '7 days'], ['30', '30 days'], ['90', '3 months'], ['365', '1 year'], ['all', 'All']];
  const head = `
    <header class="page-header"><h1>History</h1></header>
    <div class="levels range-row" role="group" aria-label="Time range">
      ${ranges.map(([v, l]) => `<button class="chip ${ui.histRange === v ? 'on' : ''}" data-action="hist-range" data-range="${v}">${l}</button>`).join('')}
    </div>`;
  if (!S().tasks.length) return `${head}<p class="empty">Nothing to show yet. Your history builds up as you use the app.</p>`;

  const h = currentHistory();
  const o = h.overall;
  const reviewButtons = `
    <div class="btn-row review-buttons">
      <button class="btn" data-action="open-week-review">📋 Weekly review</button>
      <button class="btn" data-action="open-year">✨ ${new Date(`${today()}T12:00`).getFullYear()} in review</button>
    </div>`;
  const tiles = [
    ['Tasks done', pctText(o.rate), `${o.done} done · ${o.missed} missed`],
    ['Everything done', `${o.perfectDays}`, `of ${o.activeDays} day${o.activeDays === 1 ? '' : 's'}`],
  ];
  if (o.goalMinutes) tiles.push(['Time logged', formatMinutes(o.minutes), `of ${formatMinutes(o.goalMinutes)} goal`]);
  if (o.skipped) tiles.push(['Skipped', `${o.skipped}`, 'on purpose']);
  if (o.daysOff) tiles.push(['Days off', `${o.daysOff}`, 'not counted']);

  return `
    ${head}
    ${reviewButtons}
    <div class="tiles">
      ${tiles.map(([label, value, sub]) => `
        <div class="tile"><span class="tile-label">${label}</span><strong>${value}</strong><span class="tile-sub">${sub}</span></div>`).join('')}
    </div>

    <div class="card">
      <h2 class="section tight">${h.dayCount > 60 ? 'Done each week' : 'Done each day'}</h2>
      ${completionChart(h)}
    </div>

    <h2 class="section">Repeating tasks</h2>
    ${h.repeating.length ? `<ul class="task-list stats">${h.repeating.map((t) => taskStatRow(t, h)).join('')}</ul>` : '<p class="empty">No repeating tasks in this period.</p>'}

    ${h.repeating.filter((t) => t.task.timeGoal).map((t) => `
      <div class="card">
        <h2 class="section tight">${esc(t.task.title)}: time per day</h2>
        ${timeChart(t, h)}
      </div>`).join('')}

    <h2 class="section">One-time tasks</h2>
    <div class="card">
      <p class="flush-p"><strong>${h.oneTime.done}</strong> done${h.oneTime.missed ? `, <strong>${h.oneTime.missed}</strong> not done` : ''}${h.oneTime.open ? `, ${h.oneTime.open} open today` : ''}.</p>
      ${h.oneTime.tasks.filter((t) => t.missed).length ? `<p class="hint flush">Not done: ${h.oneTime.tasks.filter((t) => t.missed).map((t) => esc(t.task.title)).join(', ')}</p>` : ''}
    </div>

    <h2 class="section">AI summary</h2>
    <div class="card">
      <p class="flush-p">Copy a summary of this period, then paste it into Claude to get a written review with patterns and suggestions. Nothing is sent anywhere by the app.</p>
      <div class="btn-row"><button class="btn primary" data-action="copy-report">Copy summary for Claude</button></div>
      <details class="per-day"><summary>See what gets copied</summary><pre class="report">${esc(reportText(h))}</pre></details>
    </div>
  `;
}

function renderWeekReview() {
  const t = today();
  const r = weekReview(S(), t);
  const o = r.h.overall;
  const list = (arr, fn) => (arr.length ? `<ul class="plain">${arr.map(fn).join('')}</ul>` : '');
  return `
    <header class="page-header"><button class="link back" data-action="close-page">‹ History</button></header>
    <h1 class="page-title">Weekly review</h1>
    <p class="muted">${esc(shortDate(r.from))} – ${esc(shortDate(r.to))}</p>
    <div class="tiles">
      <div class="tile"><span class="tile-label">Done</span><strong>${pctText(o.rate)}</strong><span class="tile-sub">${o.done} of ${o.done + o.missed}</span></div>
      <div class="tile"><span class="tile-label">Everything done</span><strong>${o.perfectDays}</strong><span class="tile-sub">of ${o.activeDays} days</span></div>
      ${o.daysOff ? `<div class="tile"><span class="tile-label">Days off</span><strong>${o.daysOff}</strong><span class="tile-sub">not counted</span></div>` : ''}
    </div>
    ${r.best.length ? `<div class="card"><h2 class="section tight">🏆 Nailed it</h2>${list(r.best, (x) => `<li>${esc(x.task.title)} <span class="muted">· ${x.done} of ${x.counted}</span></li>`)}</div>` : ''}
    ${r.missed.length ? `<div class="card"><h2 class="section tight">👀 Needs attention</h2>${list(r.missed, (x) => `<li>${esc(x.task.title)} <span class="muted">· missed ${x.missed}</span></li>`)}</div>` : ''}
    ${r.streaks.length ? `<div class="card"><h2 class="section tight">🔥 Streaks going</h2>${list(r.streaks, (x) => `<li>${esc(x.task.title)} <span class="muted">· ${x.streak} ${isPerWeek(x.task) ? 'weeks' : ''} in a row</span></li>`.replace('  ', ' '))}</div>` : ''}
    <div class="card">
      <h2 class="section tight">📅 This week</h2>
      <ul class="plain week-ahead">${r.ahead.map((d) => `
        <li><span class="wa-day">${esc(formatDay(d.key, t))}</span><span class="muted">${d.count} task${d.count === 1 ? '' : 's'}${d.oneTime.length ? ` · ${d.oneTime.map(esc).join(', ')}` : ''}</span></li>`).join('')}</ul>
    </div>
  `;
}

function renderYearReview() {
  const t = today();
  const thisYear = Number(t.slice(0, 4));
  const firstYear = Number((Object.keys(S().days).sort()[0] || t).slice(0, 4));
  const year = ui.year || thisYear;
  const y = yearReview(S(), year, t);
  const o = y.h.overall;
  const years = [];
  for (let yy = firstYear; yy <= thisYear; yy++) years.push(yy);
  const card = (emoji, label, big, sub = '') => `
    <div class="wrap-card"><span class="wrap-emoji">${emoji}</span><span class="wrap-label">${label}</span><strong class="wrap-big">${big}</strong>${sub ? `<span class="wrap-sub">${sub}</span>` : ''}</div>`;
  const W = 640; const H = 160; const bw = 36; const gap = (W - 12 * bw) / 12;
  const bars = y.months.map((m) => {
    const x = (m.month - 1) * (bw + gap) + gap / 2;
    const bh = Math.max(3, (H - 30) * (m.rate || 0));
    return `<path d="${roundedTopBar(x, H - 24 - bh, bw, bh, 4)}" class="bar-fill" /><rect x="${x}" y="0" width="${bw}" height="${H - 24}" class="hit" data-tip="${MONTH_NAMES[m.month - 1]}: ${pctText(m.rate)} done (${m.done})" />`;
  }).join('');
  const labels = MONTH_NAMES.map((n, i) => `<text x="${i * (bw + gap) + gap / 2 + bw / 2}" y="${H - 6}" class="axis" text-anchor="middle">${n[0]}</text>`).join('');
  return `
    <header class="page-header"><button class="link back" data-action="close-page">‹ History</button></header>
    ${years.length > 1 ? `<div class="levels range-row">${years.map((yy) => `<button class="chip ${yy === year ? 'on' : ''}" data-action="pick-year" data-year="${yy}">${yy}</button>`).join('')}</div>` : ''}
    <div class="wrap">
      <div class="wrap-hero"><span>Your</span><strong>${year}</strong><span>${year === thisYear ? 'so far' : 'in review'}</span></div>
      ${card('✅', 'Tasks done', o.done.toLocaleString(), `${pctText(o.rate)} of everything on your list`)}
      ${card('🌟', 'Perfect days', o.perfectDays, 'days you finished everything')}
      ${y.top ? card('🏅', 'Your top task', esc(y.top.task.title), `done ${y.top.done} times`) : ''}
      ${y.longest?.bestStreak > 1 ? card('🔥', 'Longest streak', `${y.longest.bestStreak} ${isPerWeek(y.longest.task) ? 'weeks' : 'in a row'}`, esc(y.longest.task.title)) : ''}
      ${y.bestMonth ? card('📆', 'Most consistent month', MONTH_NAMES[y.bestMonth.month - 1], `${pctText(y.bestMonth.rate)} done`) : ''}
      ${y.timeTasks.map((x) => card('⏱️', `Time on ${esc(x.task.title)}`, formatMinutes(x.minutes), `goal met ${x.goalMet} of ${x.timeRuns} times`)).join('')}
      ${y.busiestDay?.done ? card('💪', 'Busiest day', esc(formatLongDate(y.busiestDay.key)), `${y.busiestDay.done} things done`) : ''}
      ${o.daysOff ? card('🛌', 'Days off', o.daysOff, 'rest counts too') : ''}
      ${y.months.length ? `<div class="card"><h2 class="section tight">Month by month</h2><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Share done each month">${bars}${labels}</svg></div>` : ''}
    </div>
  `;
}

function taskStatRow(t, h) {
  const extra = [];
  const lv = Object.entries(t.levels);
  if (lv.length) extra.push(lv.map(([n, c]) => `${esc(n)} ${c}`).join(' · '));
  if (t.task.timeGoal) extra.push(`${formatMinutes(t.minutes)} of ${formatMinutes(t.goal)} · goal met ${t.goalMet} of ${t.timeRuns}`);
  if (t.skipped) extra.push(`${t.skipped} skipped`);
  if (t.excused) extra.push(`${t.excused} on days off`);
  if (t.weeks) extra.push(`weekly goal met ${t.weeksMet} of ${t.weeks} weeks`);
  if (t.streak > 1) extra.push(`🔥 ${t.streak} ${isPerWeek(t.task) ? 'weeks' : ''} in a row`.replace('  ', ' '));
  const width = t.rate == null ? 0 : Math.round(t.rate * 100);
  return `
    <li class="stat-row">
      <div class="stat-top">
        <span class="title">${esc(t.task.title)}</span>
        <strong>${pctText(t.rate)}</strong>
      </div>
      <div class="bar" data-tip="${esc(`${t.task.title}: ${t.done} of ${t.counted} done`)}"><span style="width:${width}%"></span></div>
      <div class="muted small">${t.done} of ${t.counted} done · about ${perWeek(t.done, t.days).toFixed(1)}× a week${t.open ? ' · open today' : ''}</div>
      ${extra.length ? `<div class="muted small">${extra.join(' · ')}</div>` : ''}
    </li>`;
}

// Bars show the share of the list that got done; the pale column behind is the whole list.
function completionChart(h) {
  const weekly = h.dayCount > 60;
  const data = weekly ? weeklyBuckets(h.days) : h.days;
  const W = 640; const H = 180; const top = 10; const bottom = 30; const left = 52;
  const plotH = H - top - bottom;
  const step = (W - left) / data.length;
  const bw = Math.max(2, Math.min(28, step - 2));
  const y = (r) => top + plotH * (1 - r);
  const grid = [0, 0.5, 1].map((r) => `
    <line x1="${left}" x2="${W}" y1="${y(r)}" y2="${y(r)}" class="grid" />
    <text x="${left - 6}" y="${y(r) + 4}" class="axis" text-anchor="end">${r * 100}%</text>`).join('');
  const bars = data.map((d, i) => {
    const x = left + i * step + (step - bw) / 2;
    const label = weekly ? `${shortDate(d.key)}–${shortDate(d.endKey)}` : shortDate(d.key);
    if (!d.total) return `${d.dayOff ? `<rect x="${x}" y="${top}" width="${bw}" height="${plotH}" rx="${Math.min(4, bw / 2)}" class="track off" />` : ''}<rect x="${x}" y="${top}" width="${bw}" height="${plotH}" class="hit" data-tip="${label}: ${d.dayOff ? 'day off' : 'nothing planned'}" />`;
    const r = d.done / d.total;
    const bh = Math.max(r > 0 ? 3 : 0, plotH * r);
    const rad = Math.min(4, bw / 2);
    return `
      <rect x="${x}" y="${top}" width="${bw}" height="${plotH}" rx="${rad}" class="track" />
      ${bh ? `<path d="${roundedTopBar(x, y(0) - bh, bw, bh, rad)}" class="bar-fill" />` : ''}
      <rect x="${left + i * step}" y="${top}" width="${step}" height="${plotH}" class="hit" data-tip="${label}: ${d.done} of ${d.total} done${d.dayOff ? ' (day off)' : ''}" />`;
  }).join('');
  const ticks = [0, Math.floor((data.length - 1) / 2), data.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${left + i * step + step / 2}" y="${H - 6}" class="axis" text-anchor="middle">${shortDate(data[i].key)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of tasks done ${weekly ? 'each week' : 'each day'}">${grid}${bars}${ticks}</svg>`;
}

function roundedTopBar(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

// Minutes logged per day, with a short line marking that day's goal.
function timeChart(t, h) {
  const rows = h.days.map((d) => {
    const item = itemsForDay(S(), d.key, today()).find((i) => i.task.id === t.task.id && i.ref.start === d.key);
    return { key: d.key, minutes: item ? item.entry.minutes || 0 : null, goal: item ? item.entry.goal || 0 : null };
  });
  const max = Math.ceil(Math.max(30, ...rows.map((r) => Math.max(r.minutes || 0, r.goal || 0))) / 30) * 30;
  const W = 640; const H = 170; const top = 10; const bottom = 30; const left = 62;
  const plotH = H - top - bottom;
  const step = (W - left) / rows.length;
  const bw = Math.max(2, Math.min(28, step - 2));
  const y = (m) => top + plotH * (1 - m / max);
  const grid = [0, max / 2, max].map((m) => `
    <line x1="${left}" x2="${W}" y1="${y(m)}" y2="${y(m)}" class="grid" />
    <text x="${left - 6}" y="${y(m) + 4}" class="axis" text-anchor="end">${formatMinutes(m)}</text>`).join('');
  const marks = rows.map((r, i) => {
    const x = left + i * step + (step - bw) / 2;
    if (r.minutes == null) return '';
    const bh = plotH * (r.minutes / max);
    const tip = `${shortDate(r.key)}: ${formatMinutes(r.minutes)}${r.goal ? ` of ${formatMinutes(r.goal)}` : ''}`;
    return `
      ${bh ? `<path d="${roundedTopBar(x, y(0) - bh, bw, bh, Math.min(4, bw / 2))}" class="bar-fill" />` : ''}
      ${r.goal ? `<line x1="${x - 1}" x2="${x + bw + 1}" y1="${y(r.goal)}" y2="${y(r.goal)}" class="goal" />` : ''}
      <rect x="${left + i * step}" y="${top}" width="${step}" height="${plotH}" class="hit" data-tip="${tip}" />`;
  }).join('');
  const n = rows.length;
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${left + i * step + step / 2}" y="${H - 6}" class="axis" text-anchor="middle">${shortDate(rows[i].key)}</text>`).join('');
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes logged per day for ${esc(t.task.title)}">${grid}${marks}${ticks}</svg>
    <div class="legend"><span class="key bar-key"></span>Time logged <span class="key goal-key"></span>Goal</div>`;
}

async function copyReport() {
  const text = reportText(currentHistory());
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied. Paste it into Claude.');
}

// Tooltip for chart marks: hover on a computer, tap on a phone.
function showTip(el, x, y) {
  const tip = $('#tip');
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
  tip.style.top = `${Math.max(8, y - tip.offsetHeight - 12)}px`;
}
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el && e.pointerType === 'mouse') showTip(el, e.clientX, e.clientY);
  else if (e.pointerType === 'mouse') $('#tip').hidden = true;
});
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el) showTip(el, e.clientX, e.clientY);
  else $('#tip').hidden = true;
});
window.addEventListener('scroll', () => { $('#tip').hidden = true; }, { passive: true });

function syncStatusText() {
  const st = sync.status;
  const pending = sync.pending();
  const time = st.lastSync ? new Date(st.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  switch (st.state) {
    case 'syncing': return 'Syncing…';
    case 'ok': return `Up to date${time ? ` · synced ${time}` : ''}`;
    case 'offline': return `Offline. ${pending ? `${pending} change${pending === 1 ? '' : 's'} will sync` : 'Changes will sync'} when you're back online.`;
    case 'error': return `Couldn't sync: ${st.error}`;
    default: return 'Waiting to sync…';
  }
}

function renderSyncCard() {
  const user = sync.user;
  if (user) {
    return `
    <div class="card">
      <h2 class="section tight">Sync</h2>
      <p class="flush-p">Signed in as <strong>${esc(user.email)}</strong></p>
      <p class="hint sync-status ${sync.status.state}" id="sync-status">${esc(syncStatusText())}</p>
      <div class="btn-row">
        <button class="btn" data-action="sync-now">Sync now</button>
        <button class="btn" data-action="sign-out">Sign out</button>
      </div>
    </div>`;
  }
  return `
    <div class="card">
      <h2 class="section tight">Sync</h2>
      <p class="hint">Sign in with the same account on your phone and computer to keep them in step. Everything still works offline and catches up later.</p>
      ${sync.status.error ? `<p class="form-msg error">${esc(sync.status.error)}</p>` : ''}
      <form class="sign-in" data-form="sign-in">
        <label class="field"><span>Email</span><input id="sync-email" type="email" autocomplete="username" required value="${esc(ui.syncEmail || '')}" /></label>
        <label class="field"><span>Password</span><input id="sync-password" type="password" autocomplete="current-password" minlength="6" required /></label>
        <p class="form-msg" id="sync-msg" hidden></p>
        <div class="btn-row">
          <button class="btn primary" type="submit">Sign in</button>
          <button class="btn" type="button" data-action="sign-up">Create account</button>
        </div>
      </form>
    </div>`;
}

async function syncAuth(kind) {
  const email = $('#sync-email')?.value.trim();
  const password = $('#sync-password')?.value || '';
  const msg = $('#sync-msg');
  const say = (text, isError) => { if (msg) { msg.textContent = text; msg.hidden = false; msg.classList.toggle('error', !!isError); } };
  if (!email || password.length < 6) { say('Enter your email and a password of at least 6 characters.', true); return; }
  ui.syncEmail = email;
  document.querySelectorAll('.sign-in button').forEach((b) => { b.disabled = true; });
  say(kind === 'up' ? 'Creating your account…' : 'Signing in…');
  try {
    if (kind === 'up') {
      const { confirm: needsConfirm } = await sync.signUp(email, password);
      if (needsConfirm) {
        say('Almost done: open the email from Supabase and tap the link, then come back and sign in here.');
        document.querySelectorAll('.sign-in button').forEach((b) => { b.disabled = false; });
        return;
      }
    } else {
      await sync.signIn(email, password);
    }
    render();
    toast('Signed in. Syncing is on.');
  } catch (e) {
    say(e instanceof TypeError ? 'No connection. Try again when you’re online.' : e.message, true);
    document.querySelectorAll('.sign-in button').forEach((b) => { b.disabled = false; });
  }
}

function renderSettings() {
  const st = S().settings;
  const hours = [0, 1, 2, 3, 4, 5, 6];
  const fmtHour = (h) => (h === 0 ? 'Midnight' : `${h}:00 am`);
  return `
    <header class="page-header"><h1>Settings</h1></header>

    ${renderSyncCard()}

    <div class="card">
      <label class="field">
        <span>A new day starts at</span>
        <select data-setting="dayStartHour">
          ${hours.map((h) => `<option value="${h}" ${st.dayStartHour === h ? 'selected' : ''}>${fmtHour(h)}</option>`).join('')}
        </select>
      </label>
      <p class="hint">Anything you check off before this time still counts for the day before.</p>
      <label class="field">
        <span>Weeks start on</span>
        <select data-setting="weekStart">
          <option value="1" ${(st.weekStart ?? 1) === 1 ? 'selected' : ''}>Monday</option>
          <option value="0" ${st.weekStart === 0 ? 'selected' : ''}>Sunday</option>
        </select>
      </label>
      <label class="field row">
        <input type="checkbox" data-setting="carryOver" ${st.carryOver ? 'checked' : ''} />
        <span>Carry unfinished one-time tasks over to the next day</span>
      </label>
    </div>

    <div class="card">
      <h2 class="section tight">History</h2>
      ${st.historyStart ? `<p class="hint">History starts ${esc(formatLongDate(st.historyStart))}.</p>` : ''}
      <p class="hint">Start fresh: forget everything before a date. Your tasks stay; only past check-offs are removed. To skip a single day instead, mark it as a day off on the Today tab.</p>
      <div class="btn-row bottom">
        <label class="field inline-date"><span>Clear before</span><input type="date" id="clear-before" value="${esc(today())}" max="${esc(today())}" /></label>
        <button class="btn danger" data-action="clear-history">Clear history</button>
      </div>
    </div>

    <div class="card">
      <h2 class="section tight">Backup</h2>
      <p class="hint">A backup file of everything, just in case. You can also use it to move your data without syncing.</p>
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
    schedule: { type: 'daily', days: [], every: 2, day: 1, by: 'day', nth: '1', weekday: 6, date: today(), dates: [], times: 3 },
    newDate: today(),
    startDate: today(),
    levels: [],
    levelDefault: 0,
    levelRules: [],
    subtasks: [],
    useTime: false,
    timeGoal: { minutes: 60, byDay: {} },
    spanDays: 1,
    levelDays: {},
    pauses: [],
    newPause: { from: today(), to: '' },
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
    pauses: structuredClone(task.pauses || []),
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
              <option value="perweek" ${s.type === 'perweek' ? 'selected' : ''}>A few times a week, any days</option>
              <option value="whenever" ${s.type === 'whenever' ? 'selected' : ''}>Whenever I need it (like a packing list)</option>
            </select>
          </label>
          ${s.type === 'once' ? `
            <label class="field"><span>Date</span><input type="date" data-bind="schedule.date" value="${esc(s.date)}" /></label>` : ''}
          ${s.type === 'weekly' ? `
            <div class="weekdays">
              ${WEEKDAYS.map((n, i) => `<button class="chip ${s.days.includes(i) ? 'on' : ''}" data-ed="weekday" data-day="${i}">${n}</button>`).join('')}
            </div>` : ''}
          ${s.type === 'perweek' ? `
            <label class="field"><span>Times a week</span><input type="number" min="1" max="7" inputmode="numeric" data-bind="schedule.times" data-num value="${esc(s.times)}" /></label>
            <p class="hint">It stays on your list each day until you've done it that many times this week. Days you don't do it aren't counted as missed, only a week that falls short.</p>` : ''}
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
          ${s.type === 'whenever' ? `
            <p class="hint">It's saved under Tasks. Tap “Add to today” when you need it, or plan days here. Each time starts with every step unchecked.</p>
            ${s.dates.length ? `<ul class="pause-list">
              ${s.dates.map((k, i) => `
                <li><span>${esc(formatLongDate(k))}</span>
                <button class="icon-btn small" data-ed="remove-date" data-index="${i}" aria-label="Remove day">×</button></li>`).join('')}
            </ul>` : ''}
            <div class="pause-add">
              <label class="field"><span>Plan it for</span><input type="date" data-bind="newDate" value="${esc(d.newDate)}" /></label>
              <button class="btn small" data-ed="add-date">+ Add day</button>
            </div>` : ''}
          ${s.type !== 'once' && s.type !== 'whenever' ? `
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
            ${s.type !== 'once' && s.type !== 'whenever' ? `
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

        ${s.type !== 'once' && s.type !== 'whenever' ? `
        <div class="card">
          <h3>Pause</h3>
          <p class="hint">While paused the task is off your list and doesn't count in history. Leave “to” empty to pause until you resume it.</p>
          ${d.pauses.length ? `<ul class="pause-list">
            ${d.pauses.map((p, k) => `
              <li>
                <span>${p.to ? `${esc(formatLongDate(p.from))} to ${esc(formatLongDate(p.to))}` : `From ${esc(formatLongDate(p.from))} until resumed`}</span>
                <button class="icon-btn small" data-ed="remove-pause" data-index="${k}" aria-label="Remove pause">×</button>
              </li>`).join('')}
          </ul>` : ''}
          <div class="pause-add">
            <label class="field"><span>From</span><input type="date" data-bind="newPause.from" value="${esc(d.newPause.from)}" /></label>
            <label class="field"><span>To (optional)</span><input type="date" data-bind="newPause.to" value="${esc(d.newPause.to)}" /></label>
            <button class="btn small" data-ed="add-pause">+ Add pause</button>
          </div>
        </div>` : ''}

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
  if (sched.type === 'perweek') sched.times = Math.min(7, Math.max(1, Number(d.schedule.times) || 1));
  if (sched.type === 'whenever') sched.dates = [...new Set(d.schedule.dates || [])].sort();
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
    pauses: sched.type === 'once' || sched.type === 'whenever' ? undefined : d.pauses,
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

// A short message at the bottom. With `undo`, it gets an Undo button for a few seconds.
function toast(msg, undo = null) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="toast-undo" data-action="undo">Undo</button>' : ''}`;
  el.hidden = false;
  ui.undo = undo;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; ui.undo = null; }, undo ? 5000 : 2200);
}

// Take a copy of everything, so an action can be undone.
function undoable(msg, fn) {
  const before = structuredClone(S());
  fn();
  store.save();
  toast(msg, () => { store.replace(before); toast('Undone'); });
}

// ---------- Events ----------

function onClick(e) {
  const tabBtn = e.target.closest('.tabbar button');
  if (tabBtn) {
    ui.tab = tabBtn.dataset.tab;
    ui.page = null;
    ui.travel = null;
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
      case 'add-pause': {
        const { from, to } = d.newPause;
        if (!from) { alert('Pick a start date for the pause.'); break; }
        if (to && to < from) { alert('The end date is before the start date.'); break; }
        d.pauses.push({ from, ...(to ? { to } : {}) });
        d.newPause = { from: today(), to: '' };
        renderEditor();
        break;
      }
      case 'add-date':
        if (d.newDate) d.schedule.dates = [...new Set([...d.schedule.dates, d.newDate])].sort();
        renderEditor();
        break;
      case 'remove-date':
        d.schedule.dates.splice(Number(ed.dataset.index), 1);
        renderEditor();
        break;
      case 'remove-pause':
        d.pauses.splice(Number(ed.dataset.index), 1);
        renderEditor();
        break;
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
        if (task) {
          ui.editor = null;
          undoable(`Deleted "${task.title}"`, () => deleteTask(S(), task));
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
    case 'toggle-upcoming': ui.upcomingOpen = !ui.upcomingOpen; render(); break;
    case 'travel': {
      const t = today();
      const from = addDays(t, 1);
      const lists = S().tasks.filter((x) => isWhenever(x) && !x.archived);
      const pack = lists.find((x) => /pack/i.test(x.title)) || null;
      ui.travel = {
        from, to: addDays(from, 6), note: '',
        taskIds: S().tasks.filter((x) => isRepeating(x) && !isWhenever(x) && !x.archived).map((x) => x.id),
        packId: pack?.id || '', packDate: t,
      };
      render(); window.scrollTo(0, 0);
      break;
    }
    case 'travel-cancel': ui.travel = null; render(); break;
    case 'travel-start': {
      const d = ui.travel;
      if (!d.from || !d.to || d.to < d.from) { alert('Pick when you leave and when you’re back.'); break; }
      ui.travel = null;
      undoable(`Travel mode on: ${d.taskIds.length} task${d.taskIds.length === 1 ? '' : 's'} paused`, () => startTrip(S(), d));
      break;
    }
    case 'end-trip': undoable('Welcome back! Tasks are back on your list.', () => endTrip(S(), today())); break;
    case 'review-dismiss': S().settings.reviewSeen = btn.dataset.week; store.save(); break;
    case 'open-week-review': ui.tab = 'history'; ui.page = 'week'; render(); window.scrollTo(0, 0); break;
    case 'open-year': ui.page = 'year'; ui.year = null; render(); window.scrollTo(0, 0); break;
    case 'pick-year': ui.year = Number(btn.dataset.year); render(); break;
    case 'close-page': ui.page = null; render(); window.scrollTo(0, 0); break;
    case 'use-today':
      addWheneverDate(task, today());
      store.save();
      toast(`${task.title} added to today`);
      break;
    case 'remove-date':
      ui.expanded.delete(task.id);
      undoable('Removed from this day', () => removeWheneverDate(task, ref.start));
      break;
    case 'expand':
      ui.expanded.has(task.id) ? ui.expanded.delete(task.id) : ui.expanded.add(task.id);
      render();
      break;
    case 'undo': { const fn = ui.undo; ui.undo = null; $('#toast').hidden = true; fn?.(); break; }
    case 'toggle': {
      const entry = getEntry(S(), ref.start, task);
      const isDone = entry.done && (!entry.doneOn || entry.doneOn <= key);
      if (isDone) { setDone(S(), ref, task, false); store.save(); break; }
      ui.expanded.delete(task.id);
      undoable(ref.start > key ? 'Done early' : 'Done', () => setDone(S(), ref, task, true));
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
    case 'skip': ui.expanded.delete(task.id); undoable('Skipped', () => setSkipped(S(), ref, task, true)); break;
    case 'unskip': setSkipped(S(), ref, task, false); store.save(); break;
    case 'tomorrow': moveOnceTask(S(), task, addDays(key < today() ? today() : key, 1)); ui.expanded.delete(task.id); store.save(); break;
    case 'delete': undoable(`Deleted "${task.title}"`, () => deleteTask(S(), task)); break;
    case 'pause':
      ui.expanded.delete(task.id);
      undoable('Paused. Resume it in Tasks.', () => pauseTask(task, key < today() ? today() : key));
      break;
    case 'resume': resumeTask(task, today()); store.save(); toast(`${task.title} is back on your list`); break;
    case 'day-off': {
      const note = prompt('Day off. Add a note if you like (e.g. sick, travel):', '');
      if (note === null) break;
      undoable('Marked as a day off', () => setDayOff(S(), key, true, note.trim()));
      break;
    }
    case 'day-off-undo': setDayOff(S(), key, false); store.save(); break;
    case 'clear-history': {
      const before = $('#clear-before')?.value || today();
      if (confirm(`Clear all history before ${formatLongDate(before)}? Check-offs, times and days off before then are removed.`)) {
        undoable('History cleared', () => clearHistoryBefore(S(), before));
      }
      break;
    }
    case 'edit': openEditor(task); break;
    case 'new-task': openEditor(null); break;
    case 'export': exportData(); break;
    case 'hist-range': ui.histRange = btn.dataset.range; render(); break;
    case 'copy-report': copyReport(); break;
    case 'sign-up': syncAuth('up'); break;
    case 'sync-now': sync.syncNow(); break;
    case 'sign-out':
      if (confirm('Sign out? Your data stays on this device, but it stops syncing.')) {
        sync.signOut().then(render);
      }
      break;
    case 'erase':
      if (confirm(sync.user
        ? 'Erase all tasks and history? Because syncing is on, this erases them on all your devices. This cannot be undone.'
        : 'Erase all tasks and history on this device? This cannot be undone.')) {
        store.replace({});
      }
      break;
  }
}

function onSubmit(e) {
  if (e.target.closest('[data-form="sign-in"]')) { e.preventDefault(); syncAuth('in'); return; }
  const form = e.target.closest('[data-form="quick-add"]');
  if (!form) return;
  e.preventDefault();
  const input = $('#quick-input');
  const { title, key } = parseQuickAdd(input.value, ui.viewKey);
  if (!title) return;
  input.value = '';
  addQuickTask(S(), title, key);
  store.save();
  if (key !== ui.viewKey) toast(`Added for ${formatDay(key, today())}`);
  $('#quick-input')?.focus();
}

function onChange(e) {
  const el = e.target;
  if (ui.travel && (el.dataset.travel || el.dataset.travelTask)) {
    if (el.dataset.travelTask) {
      const ids = new Set(ui.travel.taskIds);
      el.checked ? ids.add(el.dataset.travelTask) : ids.delete(el.dataset.travelTask);
      ui.travel.taskIds = [...ids];
    } else {
      ui.travel[el.dataset.travel] = el.value;
      if (el.dataset.travel === 'from' && ui.travel.to < el.value) { ui.travel.to = el.value; render(); }
    }
    return;
  }
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

// Drag to reorder: hold the ⋮⋮ handle and move up or down.
let drag = null;
document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  const li = handle.closest('li[data-id]');
  if (!li) return;
  e.preventDefault();
  try { handle.setPointerCapture(e.pointerId); } catch { /* fine */ }
  drag = { li, list: li.parentElement, pointer: e.pointerId, moved: false };
  li.classList.add('dragging');
});
document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  e.preventDefault();
  const y = e.clientY;
  const others = [...drag.list.children].filter((el) => el !== drag.li && el.matches('li[data-id]'));
  const before = others.find((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
  if (before) { if (drag.li.nextElementSibling !== before) { drag.list.insertBefore(drag.li, before); drag.moved = true; } }
  else if (others.length && drag.li !== drag.list.lastElementChild) { others[others.length - 1].after(drag.li); drag.moved = true; }
  if (y < 70) window.scrollBy(0, -8);
  else if (y > window.innerHeight - 110) window.scrollBy(0, 8);
}, { passive: false });
function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointer) return;
  const { li, list, moved } = drag;
  drag = null;
  li.classList.remove('dragging');
  if (!moved) return;
  reorderTasks(S(), [...list.querySelectorAll(':scope > li[data-id]')].map((el) => el.dataset.id));
  store.save();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

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

// Sync: redraw when changes arrive from another device, and keep the status line current.
sync.init(store, () => store.save());
let lastSyncState = sync.status.state;
sync.onStatus((st) => {
  const el = $('#sync-status');
  if (el) { el.textContent = syncStatusText(); el.className = `hint sync-status ${st.state}`; }
  const signedOut = st.state === 'off' && lastSyncState !== 'off';
  lastSyncState = st.state;
  if (signedOut && ui.tab === 'settings') render();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // When an update installs, reload once so every file comes from the new version.
  const hadWorker = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
}
