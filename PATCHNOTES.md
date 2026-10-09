# Patch notes

One section per version, newest first, one note per list item. `npm run
release` publishes the section for the version in `package.json`, and `/release`
in Discord posts it. Write for the people using the app: what changed for them,
not what changed in the code.

A blank line between two items starts a new paragraph in the post.

Collect notes under `## Unreleased` as work lands, and rename that heading to
the version number when it is bumped.

## Unreleased

- New: rulesets. Add one to a project to limit ships by tier and class, ban individual ships, cap a group ("max 2 of these") and set a team size
- New: ship filter for radar and smoke
- KotS tournament cap layouts added
- Fixed: Standard select and Multi-select are now properly split
- Fixed: ships moved as a group no longer jump on top of each other
- Fixed: a ship's name and range rings now follow it while it is being dragged
- Fixed: replay render display issues in 15.9
- Fixed: switching pages no longer marks a saved project as unsaved

- *In testing:* share a page straight to Discord from the export dialog
