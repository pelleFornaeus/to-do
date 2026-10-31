# To-Do

A daily to-do list that runs entirely in your browser. No AI, no server, no account needed.

- **Quick add and check off.** Finished tasks clear off at the end of the day. Type `tomorrow ship the package` to put a task on tomorrow's list.
- **Repeating tasks.** Every day, certain weekdays (e.g. gym on Sun, Tue, Thu), every few days, or monthly.
- **Steps.** "Clean the kitchen" can have "Do the dishes", "Take out the trash" and so on. Checking every step finishes the task.
- **Levels.** Light, normal, deep, complete (or your own names). Each step shows from a chosen level up, and you can pick a different usual level for some weekdays.
- **Multi-day tasks.** A task or a level can take several days (e.g. a 3-day complete clean). It shows "Day 2 of 3" and keeps checked steps.
- **Time goals.** e.g. "Study language" for 1 hour, with different goals on some days. Log time with quick buttons or a timer.
- **History.** Every day's results are kept for reports (coming in a later step).

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
- `sw.js`: offline support (bump `CACHE` when releasing changes)
