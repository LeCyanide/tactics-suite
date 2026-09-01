# WoWS Tactical Planner

An offline, desktop tactical planning suite for World of Warships — a map-first
editor in the shape of lightweight CAD software, not a website.

No account, no login, no server, no community features, no telemetry. The
application never makes a network request; everything it needs is on disk.

The map is **fixed**: it is always centred and always shown whole, with a small
margin at the edges. There is no pan and no zoom, so a page always looks the
same to whoever opens it, and the camera has no state to get lost in.

Dark and light themes are both supported; switch under `Settings ▸ Preferences`
(or `Settings ▸ Light Theme`). The canvas follows the theme too — its colours
live in `src/state/theme.ts`, because Konva paints to a bitmap and cannot read
CSS custom properties.

---

## Running it

```bash
npm install
```

Development (Vite + Electron, hot reload):

```bash
npm run dev
```

Production build (typecheck + bundle):

```bash
npm run build
```

Headless checks for the messy-input paths (ship-data parsing across
JSON/CSV/YAML, and the `.wowsplan` pack → read → import round-trip including
asset bytes, backups and id sanitisation):

```bash
npm run selftest
```

Packaged Windows installer + portable build (via electron-builder):

```bash
npm run dist
```

---

## Where your data lives

Everything is stored locally under the OS application-data directory:

```
%APPDATA%\WoWS Tactical Planner\data\
  settings.json               application settings
  projects/<id>.json          one document per project
  maps/maps.json              map database index
  maps/assets/<id>.png        imported map images
  ships/ships.json            ship database
  ships/icons.json            icon asset index
  ships/icons/<id>.png        imported ship icons
  backups/<projectId>/*.wowsplan
```

Set `WOWSPLAN_DATA_DIR` to point that whole tree somewhere else — a portable
install on a USB stick, or a second data set for testing.

Writes are atomic (write to `.tmp`, then rename), so a crash mid-save can never
truncate a project, and per-file write queues keep rapid autosaves from
interleaving. A file that somehow becomes unreadable is moved aside as
`*.corrupt-<timestamp>` rather than taking the application down.

**Storage back end.** Projects are stored as one JSON document each rather than
in SQLite. The whole surface lives behind `electron/storage/db.ts` and is only
reached through the IPC layer in `electron/ipc.ts`, so swapping in SQLite (or
anything else) is a change to one file and touches no editor code.

---

## The `.wowsplan` format

A project export is a gzip-compressed JSON envelope that embeds everything the
project references:

```jsonc
{
  "format": "wowsplan",
  "formatVersion": 1,
  "exportedAt": 1730000000000,
  "project": { /* metadata, pages, layers, objects, teams, presets */ },
  "maps":   [ /* map records used by the project */ ],
  "ships":  [ /* ship records referenced by placed ships */ ],
  "icons":  [ /* icon asset records */ ],
  "assets": { "maps/<file>": "<base64>", "icons/<file>": "<base64>" }
}
```

Copy the file to another machine, import it, and the project renders
identically — map images and ship icons travel with it. Import always assigns a
fresh project id, so importing twice never silently overwrites existing work.
A plain (ungzipped) JSON file with the same shape is also accepted.

---

## Coordinate system

All tactical geometry is stored in **world metres**, origin at the map's
top-left corner. A map declares its own extent (e.g. 30 000 × 30 000 m) and the
background image is stretched across it. Ship ranges come out of the database in
kilometres and are multiplied by 1000 at render time.

This keeps range circles physically correct at any zoom and makes the model
independent of the pixel size of whatever image was imported.

---

## Ship icons

The default representation of a ship on the map is **the icon you imported for
it**. Icons are PNG/SVG/WEBP with transparency, imported through
*Ship Database → Import icons…*, and are matched to ships by file name
automatically (so a bulk import of a full icon set is one step).

Only when a ship has no icon assigned does the map fall back to a class-coded
vector glyph. Those glyphs follow the game's own class-marker family — the
heavier the class, the more solid the marker:

| Class | Marker |
|---|---|
| CV | filled hull, two diagonal slashes |
| BB | filled hull, one diagonal slash |
| CA | hollow hull outline |
| DD | hollow arrowhead |
| SS | filled rounded hull (no counterpart in the reference set) |

They are authored bow-up in a 24x24 box, because a ship's rotation on the map
is its heading and 0 deg is north; the slashes are gaps between separate filled
pieces rather than cut-outs, so they render identically at any size. The same
path data drives the SVG markers in the ship browser and the database table
(`src/components/common/ClassIcon.tsx`), so the two can never drift apart.

Nothing ever replaces an assigned icon with a generic symbol. Team colour is
applied as a ring and label border around the icon, never painted onto the
artwork.

Icons are drawn at a constant on-screen size (scaled by 1/zoom) while ranges
stay in world units. A ship's marker is painted in its team's colour — that is
the only thing that colours it — and its name is always drawn horizontally and
centred beneath the hull, whatever heading the ship is pointing.

---

## Ship characteristics are opt-in

Placing a ship shows an icon, a name and a heading pip. Nothing else.

Labels (icon, name), the heading indicator and consumables have **page
defaults** (`Map Display` in the properties panel) and **per-ship overrides**
(`Display on Map` when a ship is selected). Overridden entries are marked
`OVR`; clicking the badge clears the override and the ship falls back to the
page setting.

Ranges — Detection, Radar, Hydro, Main Battery, Secondary, Torpedo — have no
page default at all. They are set on one ship at a time, because a range is a
statement about the ship that projects it.

When a range characteristic is switched on, its visualisation is generated
automatically from the ship database — you never draw those circles by hand —
and it exists *only* while that toggle is on. Torpedoes render as a directional
sector rather than a circle when the ship has a torpedo arc.

Range styling (colour, opacity, line width, fill, dash, label) is configured on
the ship whose range it is, layered over the built-in defaults.

Hidden characteristics are not rendered, and therefore cannot appear in an
exported image.

---

## Ship database import

The ship database is entirely yours — there is no external API. Import JSON,
CSV or YAML; the parser is deliberately forgiving:

- Column names are matched case- and separator-insensitively against a table of
  aliases (`concealment` / `detectability` / `detection_range` / `Concealment
  (sea)` all land in the same field).
- Unit suffixes are stripped: `"10.0 km"`, `"97,200 HP"`, `"33 kn"`.
- Tiers may be Arabic or Roman (`10`, `X`).
- A range given in metres (any value > 100 in a km field) is converted.
- Accepts an array, a `{ "ships": [...] }` wrapper, or a name-keyed object.
- Anything it cannot map is preserved in the ship's notes rather than dropped.

Re-importing an updated sheet merges on name + tier, so existing ships update in
place and keep their icon assignment. Export back out as JSON, CSV or YAML.

---

## Layers

Each page carries four layers: **Grid**, **Ship Ranges**, **Annotations** and
**Ships**, plus any custom layers you add. Shapes, arrows, text and markers all
share Annotations, because they are drawn the same way and are almost always
shown or hidden together. Every layer has visibility, lock, opacity, rename,
reorder and delete; objects can be moved between layers.

Ship ranges render on their own layer even though they belong to ship objects,
which is what lets you hide every radar circle on the page with one click while
leaving the ships in place.

---

## Keyboard

| | |
|---|---|
| `V` / `Shift+V` | Select / Multi-select |
| `F` `L` `A` `R` `C` `G` | Freehand, Line, Arrow, Rectangle, Circle, Polygon |
| `T` `N` `M` | Text, Number, Ruler |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+C` `Ctrl+V` `Ctrl+D` `Ctrl+A` `Del` | Copy, Paste, Duplicate, Select all, Delete |
| `Ctrl+N` `Ctrl+O` `Ctrl+S` `Ctrl+E` | New, Open, Save, Export image |
| `Ctrl+0` | Recentre map |
| `Ctrl+B` `Ctrl+J` `Ctrl+K` | Left sidebar, Properties, Notes |
| `Ctrl+Tab` | Next page |
| `F1` | Shortcut reference |

---

## Architecture

```
electron/
  main.ts                  window (frameless, custom title bar), lifecycle
  preload.ts               the only bridge into the renderer (contextIsolation)
  ipc.ts                   complete IPC surface: dialogs, disk, export
  storage/db.ts            local database: atomic writes, assets, .wowsplan
src/
  types/model.ts           the data model, in one place
  state/store.ts           zustand store: project, libraries, history, UI
  state/shortcuts.ts       global keyboard map
  state/assets.ts          decoded-image cache for maps and icons
  canvas/MapCanvas.tsx     stage, camera, tools, selection, transforms, export
  canvas/ShipNode.tsx      ship icon, labels, ranges
  canvas/ObjectNode.tsx    shapes, paths, text, markers
  canvas/MapBackground.tsx map image, grid, coordinates
  components/              title bar, sidebars, tool rail, modals
  lib/shipImport.ts        JSON/CSV/YAML ship parsing and export
  lib/markdown.tsx         notes renderer (returns React nodes, no raw HTML)
```

Rendering is Konva on three canvases: a background layer (map + grid, redrawn
only when the map changes), a content layer (all tactical objects, grouped per
tactical layer), and an overlay (in-progress drawing, marquee, handles) which is
excluded from exports.

Undo/redo snapshots the project document; continuous gestures such as dragging
push one history entry at the start and commit once at the end, so a drag is a
single undo step.

Object dragging is delegated to the content layer rather than handled per node,
which keeps one code path for single- and multi-object drags.

### Deliberate constraints

- No `dangerouslySetInnerHTML` anywhere; the Markdown renderer builds React
  elements directly.
- `contextIsolation: true`, `nodeIntegration: false`; the renderer's entire
  privileged surface is the typed API in `preload.ts`.
- A CSP in `index.html` limits the renderer to its own origin plus `data:` and
  `blob:` images.
- Navigation away from the app is blocked, and window-open requests are denied.
- Images are loaded as `data:` URLs rather than through a custom protocol,
  specifically so the export canvas is never tainted and `toDataURL` works.
