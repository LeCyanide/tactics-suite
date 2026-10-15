# Patch notes

One section per version, newest first. `npm run release` publishes the section
for the version in `package.json`, and `/release` in Discord posts it. Write
for the people using the app: what changed for them, not what changed in the
code.

Under a version, each `###` heading becomes a header in the post and each list
item under it one note. Use `### Changelog` for what is finished and
`### In testing` for what is shipped but not settled.

Collect notes under `## Unreleased` as work lands, and rename that heading to
the version number when it is bumped.

## Unreleased

### Changelog

- Page tabs now show the folder a page is in, so "TEST – Okinawa" and "FINAL – Okinawa" can be told apart
- Closing a tab no longer deletes the page. Tabs are now a set of open pages for quick switching: click a page in the sidebar to open it as a tab, close tabs you are done with, and drag tabs into any order without changing the page list. Ctrl+Tab cycles through the open tabs. The maps of open tabs are loaded ahead so switching is instant. Delete a page from the sidebar
- New pages are no longer numbered: the first page of a new project is called "Default" instead of "01 - Opening", and added pages "New Page" instead of "02 - New Page"

## 2.3.0

### Changelog

- New (beta): Share to Discord. Connect your Discord account in Settings, then post a page straight from the export dialog
- Exported images of a page in a folder now carry the folder in their name

## 2.2.0

### Changelog

- Renamed: the app is now WoWs Tactics Suite. Your projects, maps and replays move over by themselves the first time it starts
- New: folders for tactical pages. Sort a project's pages into folders in the sidebar, or leave a page on its own. Pages and folders can be dragged into any order, and a right-click on a page moves it to a folder. Existing projects open as before, with all pages unsorted

### In testing

- Share a page straight to Discord from the export dialog

## 2.1.0

### Changelog

- New: rulesets. Add one to a project to limit ships by tier and class, ban individual ships, cap a group ("max 2 of these") and set a team size
- New: ship filter for radar and smoke
- KotS tournament cap layouts added
- Fixed: Standard select and Multi-select are now properly split
- Fixed: ships moved as a group no longer jump on top of each other
- Fixed: a ship's name and range rings now follow it while it is being dragged
- Fixed: replay render display issues in 15.9
- Fixed: switching pages no longer marks a saved project as unsaved

### In testing

- Share a page straight to Discord from the export dialog
