# To-Do

A daily to-do list that runs entirely in your browser. No AI, no server, no account needed.

- **Quick add and check off.** Finished tasks clear off at the end of the day. Type `tomorrow ship the package` to put a task on tomorrow's list.
- **Repeating tasks.** Every day, certain weekdays (e.g. gym on Sun, Tue, Thu), every few days, or monthly (a date like the 1st, the last day, or a weekday like the last Saturday).
- **Steps.** "Clean the kitchen" can have "Do the dishes", "Take out the trash" and so on. Checking every step finishes the task.
- **Levels.** Light, normal, deep, complete (or your own names). Each step picks which levels it belongs to, and rules set the level by day, e.g. deep every Saturday and complete on the last Saturday of the month.
- **Multi-day tasks.** A task or a level can take several days (e.g. a 3-day complete clean). It shows "Day 2 of 3" and keeps checked steps.
- **Time goals.** e.g. "Study language" for 1 hour, with different goals on some days. Log time with quick buttons or a timer.
- **History.** A History tab shows completion rates, per-task results (e.g. gym about 2.5× a week), levels done and time logged, with charts for 7 days to all time. "Copy summary for Claude" copies a text report to paste into Claude for a written review.

## Install on iPhone

Open the app's web address in Safari, tap **Share**, then **Add to Home Screen**. It opens full screen like a regular app and works offline.

## Your data

Data is saved on each device. Use **Settings → Download backup** to keep a copy. Syncing between phone and computer is the next step.

## For developers

Plain HTML, CSS and JavaScript with no build step.

```sh
npm start   # serves the app at http://localhost:8000
npm test    # runs the logic tests (Node 20+)
```

- `js/model.js`: tasks, schedules, levels, multi-day runs, time goals
- `js/app.js`: the interface
- `js/store.js`: saving to the browser
- `sw.js`: offline support. Online it always loads the latest files; offline it uses the saved copy. Bump `CACHE` and add new files to `ASSETS` when releasing.
