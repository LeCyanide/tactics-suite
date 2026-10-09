# Patch notes

One section per version, newest first, one note per list item. `npm run
release` publishes the section for the version in `package.json`, and `/release`
in Discord posts it. Write for the people using the app: what changed for them,
not what changed in the code.

Collect notes under `## Unreleased` as work lands, and rename that heading to
the version number when it is bumped.

## Unreleased

- Moving several ships at once no longer throws them on top of each other
- Select now works on one object at a time; Multi-select (Shift+V) builds a group by box or by click and moves it together
- Ship names and range rings follow a ship while it is being dragged
- Ships can be filtered by radar and by smoke, in the ship database and in the sidebar
- Smoke data for every destroyer from tier V up
- Rulesets: per project, limit ships by tier and class, ban individual ships, cap groups ("max 2 of these") and set a team size
- Share a page straight to Discord from the export dialog
- 15.9 tournament cap layouts added
- Players show up again in replays from 15.9
- Switching pages no longer marks a saved project as unsaved
