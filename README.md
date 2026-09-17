# WoWS tactics toolkit

Awooga I don't know what I am doing. 

locally run wows-tactics alternative


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

Packaged Windows installer + portable build (via electron-builder). The
installer also carries the replay viewer sidecar, which the portable exe cannot
use; building it needs Rust:

```bash
npm run dist
```

Headless checks for the logic that would otherwise only be exercised by hand:

```bash
npm run selftest
```

The one seam `selftest` cannot reach is Electron's own IPC, which carries tens
of megabytes of replay timeline per bake. That has its own check, run inside a
real Electron process against a throwaway store:

```bash
npm run ipc-check
```

Point it at a battle to exercise a real bake end to end; without these it still
covers the bridge and says what it skipped:

```bash
set WOWSPLAN_GAME_DIR=C:\Games\World_of_Warships
set WOWSPLAN_REPLAY=%WOWSPLAN_GAME_DIR%\replays\<version>\<file>.wowsreplay
```

The replay viewer's own renderer can be driven in a plain browser, without
Electron, against a stubbed `window.api`:

```bash
npm run dev:replay -- dev/fixtures/<file>.wtreply
```

## Updates

Installed copies check a private update server on the VPS at startup and ask
before downloading anything. The GitHub repo is never involved: builds carry
their own update token, which only unlocks the release folder on the server.
The NSIS install updates through `electron-updater`; the portable exe downloads
its replacement beside itself, swaps the files and relaunches.

**One-time server setup** (Debian/Ubuntu VPS, DNS for the domain pointed at it):

```bash
scp deploy/Caddyfile deploy/setup-vps.sh you@vps:
ssh you@vps 'sudo bash setup-vps.sh updates.example.com'
```

It installs Caddy (automatic HTTPS), creates `/srv/wows-updates`, generates the
token and prints the values for `.env.release`. Copy `.env.release.example` to
`.env.release` (untracked) and fill them in.

**Releasing:** bump the version, then

```bash
npm run dist
npm run release
```

`release` refuses to upload a build that was compiled without the token, then
uploads the installer, blockmap and portable exe before the `latest.yml` and
`portable.json` manifests. Once those are live it deletes every release on the
server except the new one and the one before it, and moves older builds in
your local `release/` folder to the Recycle Bin the same way (on its own:
`node scripts/prune-local-releases.mjs`). Keep the token stable: builds made with an old token
can no longer update once it changes.

---

## data storage

Everything is stored locally under the OS application-data directory:

```
%APPDATA%\WoWS Tactics Toolkit\data\
  settings.json               application settings
  projects/<id>.json          one document per project
  maps/maps.json              map database index
  maps/cap-layouts.json       capture point layout library
  maps/assets/<id>.png        imported map images
  ships/ships.json            ship database
  ships/icons.json            icon asset index
  ships/icons/<id>.png        imported ship icons
  backups/<projectId>/*.wowsplan
  seed-state.json             which shipped databases this store has taken
```

Set `WOWSPLAN_DATA_DIR` to point that whole tree somewhere else — a portable
install on a USB stick, or a second data set for testing.

That override is for those two cases only. It is a *separate* data set, not a
second view of the same one: a session started with it sees different maps,
ships and projects from one started without it, and work saved under one is
invisible to the other. The path above is the single store the application, the
packaged build and `scripts/import-ships.mjs` all use by default — leave the
variable unset unless you specifically want an isolated tree.

Writes are atomic (write to `.tmp`, then rename), so a crash mid-save can never
truncate a project, and per-file write queues keep rapid autosaves from
interleaving. A file that somehow becomes unreadable is moved aside as
`*.corrupt-<timestamp>` rather than taking the application down.

**Storage back end.** Projects are stored as one JSON document each rather than
in SQLite. The whole surface lives behind `electron/storage/db.ts` and is only
reached through the IPC layer in `electron/ipc.ts`, so swapping in SQLite (or
anything else) is a change to one file and touches no editor code.

---


## Ship database import

The ship database is entirely yours — there is no external API. Import JSON,
CSV or YAML; the parser is deliberately forgiving:

- Column names are matched case- and separator-insensitively against a table of
  aliases (`concealment` / `detectability` / `detection_range` / `Concealment
  (sea)` all land in the same field).
- A unit carried in the column name is dropped rather than read as part of it,
  so `Detection by Sea (km)` and `Speed, kn` land on the same fields as the
  bare names. An exact header still wins over a stripped one, so a file holding
  both `Radar` and `Radar Range (km)` keeps the plain column.
- Unit suffixes are stripped from the values too: `"10.0 km"`, `"97,200 HP"`,
  `"33 kn"`.
- Nation spellings are folded to one label, so `U.S.A.`, `United States` and
  `USA` cannot put the same navy under three entries in the filters. A nation
  the table does not know is kept exactly as written.
- A stat reading `0` is treated as absent rather than as a measurement. Exports
  routinely write `0` where the cell was meant to be blank, and a ship with
  "radar 0" has no radar — so this is what keeps zero-radius rings and `0.0 km`
  labels off the canvas.
- Tiers may be Arabic or Roman (`10`, `X`).
- A range given in metres (any value > 100 in a km field) is converted.
- Accepts an array, a `{ "ships": [...] }` wrapper, or a name-keyed object.
- Anything it cannot map is preserved in the ship's notes rather than dropped.

Re-importing an updated sheet merges rather than replaces: a ship already in
the database keeps its id, its icon and every field the incoming file has
nothing to say about. Projects reference ships by id, so a re-import never
detaches the ships already placed on a page.

The two routes pair rows with existing ships on different keys, which is worth
knowing if you use both. The in-app importer matches on name **and** tier, so a
ship whose tier changed arrives as a second entry rather than an update.
`scripts/import-ships.mjs` matches on name alone, ignoring case, punctuation
and accents, so `Hakuryu` finds `Hakuryū`.

Export back out as JSON, CSV or YAML.

---

## Cap layouts

The capture zones a page can show are read, not drawn: they come from the game
itself, by way of WoWs Toolkit, which records a map's layout whenever it parses
a replay of that battle type. Playing a mode once is what puts its caps within
reach.

```bash
node scripts/import-cap-layouts.mjs
```

That rebuilds `maps/cap-layouts.json` from the toolkit's database (pass
`--toolkit <dir>` if it lives somewhere unusual, `--dry` to see the changes
first). Rebuilding is safe to repeat — layout ids are derived from the game's
own scenario ids, so a page keeps the layout it points at.

Layouts are named the way the game names them, with two substitutions: a
hyphen for its full stop, and the cap count in brackets where the game says
"— Four Areas". Domination is three caps unless the name says otherwise, so
`Tournament. Domination — Four Areas` becomes `Tournament - Domination
(4 caps)` and plain `Tournament. Domination` stays `Tournament - Domination`.

Layouts for a map the database does not have are skipped, as are the two-cap
brawl layouts and operations.

---

## Shipped data

A build carries the ship database, the map library and the cap layouts with it,
under `seed/`. They are copied into the application-data directory the first
time the application starts, so a fresh install opens with everything already
there and nothing to import.

Each database is seeded on its own and only when its index file is absent, so
an existing store is never overwritten: your edits survive every later version,
and a database you empty on purpose stays empty.

The import scripts above write to the application-data directory, not to
`seed/`, so after re-importing anything:

```bash
npm run refresh-seed
```

That copies the databases and their assets back out of the live store, prunes
anything they no longer reference, and refuses to run if a database points at a
file the store does not have. Projects, backups and settings are never copied,
and it fails rather than continue if it finds any under `seed/`. Pass `--dry` to
see the changes first, or `--data <dir>` to read a store other than the default.

Commit the result: `seed/` is the only copy of that data in the repository.

---

## Layers

Each page carries five layers, drawn back to front: **Grid**, **Cap Zones**,
**Ship Ranges**, **Annotations** and **Ships**, plus any custom layers you add.
Shapes, arrows, text and markers all share Annotations, because they are drawn
the same way and are almost always shown or hidden together. Every layer has
visibility, lock, opacity, rename, reorder and delete; objects can be moved
between layers. Grid and Cap Zones start locked: nothing on them is yours to
drag, so the lock keeps a stray click on the canvas from picking one up.

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
