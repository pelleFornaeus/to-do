# To-Do

A daily to-do list that runs entirely in your browser. No AI, no server, no account needed.

- **Quick add and check off.** Finished tasks clear off at the end of the day. Type `tomorrow ship the package` to put a task on tomorrow's list.
- **Repeating tasks.** Every day, certain weekdays (e.g. gym on Sun, Tue, Thu), every few days, or monthly (a date like the 1st, the last day, or a weekday like the last Saturday).
- **Steps.** "Clean the kitchen" can have "Do the dishes", "Take out the trash" and so on. Checking every step finishes the task.
- **Levels.** Light, normal, deep, complete (or your own names). Each step picks which levels it belongs to, and rules set the level by day, e.g. deep every Saturday and complete on the last Saturday of the month.
- **Multi-day tasks.** A task or a level can take several days (e.g. a 3-day complete clean). It shows "Day 2 of 3" and keeps checked steps.
- **Time goals.** e.g. "Study language" for 1 hour, with different goals on some days. Log time with quick buttons or a timer.
- **History.** A History tab shows completion rates, per-task results (e.g. gym about 2.5× a week), levels done and time logged, with charts for 7 days to all time. "Copy summary for Claude" copies a text report to paste into Claude for a written review.
- **Days off.** Mark any day (a sick day, a travel day) as a day off from the Today tab. Nothing on it counts as missed.
- **Pause a task.** Pause the kitchen while you travel and keep the gym going. Pause from the task's details on Today, or set dates in the task editor. Paused days don't count.
- **Clear history.** Settings > History starts your history fresh from a chosen date.

## Install on iPhone

Open the app's web address in Safari, tap **Share**, then **Add to Home Screen**. It opens full screen like a regular app and works offline.

## Your data

Data is saved on each device and works offline. To keep your phone and computer in step, sign in under **Settings → Sync** with the same account on both. Changes made offline sync when you're back online. **Settings → Download backup** keeps a copy as a file.

### Sync setup (one time)

Sync uses a free [Supabase](https://supabase.com) project. The project address and its public key are in `js/config.js`.

1. In Supabase, open **SQL Editor**, paste in [`supabase/setup.sql`](supabase/setup.sql) and press **Run**. This creates the table, and each account can only see its own rows.
2. Open **Authentication → URL Configuration** and set **Site URL** to `https://pellefornaeus.github.io/to-do/`. That's where the "confirm your email" link takes you.

## For developers

Plain HTML, CSS and JavaScript with no build step.

```sh
npm start   # serves the app at http://localhost:8000
npm test    # runs the logic tests (Node 20+)
```

- `js/model.js`: tasks, schedules, levels, multi-day runs, time goals
- `js/app.js`: the interface
- `js/store.js`: saving to the browser
- `js/records.js`, `js/sync.js`: syncing through Supabase. Data is split into small records (a task, a day, one task's progress on a day). The newest change to each record wins, so two devices can check off different things at the same time.
- `sw.js`: offline support. Online it always loads the latest files; offline it uses the saved copy. Bump `CACHE` and add new files to `ASSETS` when releasing.
