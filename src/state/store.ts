import { create } from 'zustand';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_CHARACTERISTICS,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_RANGE_FLAGS,
  SCHEMA_VERSION,
  DEFAULT_STROKE,
  LAYER_IDS,
  LEGACY_LAYER_REMAP,
  PAGE_CHARACTERISTIC_KEYS,
  REMOVED_OBJECT_TYPES,
  createDefaultLayers,
  type AppSettings,
  type CharacteristicFlags,
  type CharacteristicKey,
  type GameMap,
  type ID,
  type Layer,
  type MapViewConfig,
  type Page,
  type Project,
  type ProjectSummary,
  type Ship,
  type ShipIconAsset,
  type ShipObject,
  type StrokeStyle,
  type TacticalObject,
  type Team,
  type Vec2,
} from '@/types/model';
import { clamp, clone, debounce, uid } from '@/lib/util';
import { applyTheme } from './theme';
import {
  createPage,
  createProject,
  createShipObject,
} from '@/lib/factory';
import { parseShipData, serializeShips } from '@/lib/shipImport';
import { SAMPLE_SHIPS } from '@/data/sampleShips';

const HISTORY_LIMIT = 100;

export type ToolId =
  | 'select'
  | 'marquee'
  | 'freehand'
  | 'line'
  | 'arrow'
  | 'doubleArrow'
  | 'curvedArrow'
  | 'rect'
  | 'roundRect'
  | 'circle'
  | 'polygon'
  | 'text'
  | 'number'
  | 'marker'
  | 'ruler'
  | 'area';

/** The shape variants offered behind the single "Shape" rail button. */
export const SHAPE_TOOLS = ['circle', 'rect', 'roundRect', 'polygon'] as const;
/** The line/arrow variants offered behind the single "Arrow" rail button. */
export const ARROW_TOOLS = ['line', 'arrow', 'doubleArrow', 'curvedArrow'] as const;

export type ShapeTool = (typeof SHAPE_TOOLS)[number];
export type ArrowTool = (typeof ARROW_TOOLS)[number];

export const SHAPE_TOOL_LABELS: Record<ShapeTool, string> = {
  circle: 'Circle',
  rect: 'Rectangle',
  roundRect: 'Rounded',
  polygon: 'Polygon',
};

export const ARROW_TOOL_LABELS: Record<ArrowTool, string> = {
  arrow: 'Arrow',
  line: 'Line',
  doubleArrow: 'Double',
  curvedArrow: 'Curved',
};

export interface Camera {
  /** Stage translation in screen pixels. */
  x: number;
  y: number;
  /** Screen pixels per world metre. */
  scale: number;
}

export interface ToolOptions {
  stroke: StrokeStyle;
  fontSize: number;
  arrowSize: number;
  /** Which variant the grouped Shape / Arrow rail buttons currently draw. */
  shapeVariant: ShapeTool;
  arrowVariant: ArrowTool;
  markerColor: string;
  numberCounter: number;
}

export type ModalId =
  | null
  | 'projects'
  | 'newProject'
  | 'maps'
  | 'shipDb'
  | 'shipEditor'
  | 'export'
  | 'settings'
  | 'shortcuts'
  | 'backups';

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface State {
  /* libraries */
  ships: Ship[];
  icons: ShipIconAsset[];
  maps: GameMap[];
  settings: AppSettings;

  /* projects */
  projectList: ProjectSummary[];
  project: Project | null;
  dirty: boolean;
  lastSavedAt: number;
  booted: boolean;

  /* history */
  past: Project[];
  future: Project[];

  /* editor ui */
  tool: ToolId;
  toolOptions: ToolOptions;
  selection: ID[];
  activeLayerId: ID;
  camera: Camera;
  clipboard: TacticalObject[];
  modal: ModalId;
  modalArg: unknown;
  editingShipId: ID | null;
  leftOpen: boolean;
  rightOpen: boolean;
  notesOpen: boolean;
  toasts: Toast[];
  /** Increment to ask the canvas to re-fit the map. */
  fitRequest: number;
}

interface Actions {
  boot(): Promise<void>;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: string): void;

  /* settings */
  patchSettings(patch: Partial<AppSettings>): void;

  /* projects */
  refreshProjects(): Promise<void>;
  newProject(name: string): Promise<void>;
  openProject(id: ID): Promise<void>;
  saveProject(opts?: { backup?: boolean; silent?: boolean }): Promise<void>;
  saveProjectAs(name: string): Promise<void>;
  duplicateProject(id: ID): Promise<void>;
  renameProject(id: ID, name: string): Promise<void>;
  deleteProject(id: ID): Promise<void>;
  importProject(): Promise<void>;
  exportProject(): Promise<void>;
  closeProject(): Promise<void>;

  /* pages */
  setActivePage(id: ID): void;
  addPage(name?: string): void;
  duplicatePage(id: ID): void;
  renamePage(id: ID, name: string): void;
  deletePage(id: ID): void;
  reorderPage(id: ID, delta: number): void;
  /** Absolute reorder, used by drag and drop on the board tabs. */
  movePageTo(id: ID, index: number): void;
  setPageMap(mapId: ID | null): void;
  patchMapView(patch: Partial<MapViewConfig>): void;
  setNotes(text: string): void;
  setPageDisplay(key: CharacteristicKey, value: boolean): void;

  /* objects */
  addObjects(objects: TacticalObject[], opts?: { select?: boolean; history?: boolean }): void;
  updateObject(id: ID, patch: Partial<TacticalObject>, opts?: { history?: boolean }): void;
  updateObjects(ids: ID[], patch: Partial<TacticalObject>, opts?: { history?: boolean }): void;
  removeObjects(ids: ID[]): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  copySelection(): void;
  paste(at?: Vec2): void;
  nudgeSelection(dx: number, dy: number): void;
  moveObjectsTo(patches: { id: ID; x: number; y: number }[]): void;
  reorderObject(id: ID, delta: number | 'front' | 'back'): void;
  assignLayer(ids: ID[], layerId: ID): void;

  /* ships on map */
  placeShip(shipId: ID, at: Vec2, teamId?: ID | null): void;
  setShipDisplay(objectId: ID, key: CharacteristicKey, value: boolean | undefined): void;

  /* layers */
  addLayer(name?: string): void;
  updateLayer(id: ID, patch: Partial<Layer>): void;
  removeLayer(id: ID): void;
  reorderLayer(id: ID, delta: number): void;
  setActiveLayer(id: ID): void;

  /* teams */
  addTeam(): void;
  updateTeam(id: ID, patch: Partial<Team>): void;
  removeTeam(id: ID): void;

  /* history */
  pushHistory(): void;
  undo(): void;
  redo(): void;

  /* library: maps */
  importMaps(): Promise<void>;
  updateMap(map: GameMap): Promise<void>;
  deleteMap(id: ID): Promise<void>;
  duplicateMap(id: ID): Promise<void>;
  replaceMapImage(id: ID): Promise<void>;

  /* library: ships */
  importShipData(): Promise<void>;
  exportShipData(format: 'json' | 'csv' | 'yaml'): Promise<void>;
  upsertShip(ship: Ship): Promise<void>;
  deleteShip(id: ID): Promise<void>;
  loadSampleShips(): Promise<void>;
  importIcons(): Promise<void>;
  deleteIcon(id: ID): Promise<void>;
  assignIcon(shipId: ID, iconId: ID | null): Promise<void>;


  /* ui */
  setTool(tool: ToolId): void;
  patchToolOptions(patch: Partial<ToolOptions>): void;
  select(ids: ID[], additive?: boolean): void;
  toggleSelect(id: ID): void;
  clearSelection(): void;
  setCamera(camera: Partial<Camera>): void;
  requestFit(): void;
  openModal(modal: ModalId, arg?: unknown): void;
  closeModal(): void;
  setEditingShip(id: ID | null): void;
  toggleLeft(): void;
  toggleRight(): void;
  toggleNotes(): void;
}

export type Store = State & Actions;

const initialToolOptions: ToolOptions = {
  stroke: clone(DEFAULT_STROKE),
  fontSize: 340,
  arrowSize: 14,
  shapeVariant: 'circle',
  arrowVariant: 'arrow',
  markerColor: '#f4c95d',
  numberCounter: 1,
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function activePageOf(project: Project | null): Page | null {
  if (!project) return null;
  return project.pages.find((p) => p.id === project.activePageId) ?? project.pages[0] ?? null;
}

export function getActivePage(state: State): Page | null {
  return activePageOf(state.project);
}

export const useStore = create<Store>((set, get) => {
  /** Persists the current project; debounced for autosave. */
  const persist = async (opts: { backup?: boolean } = {}) => {
    const { project, settings } = get();
    if (!project) return;
    await window.api.projects.save(project);
    if (opts.backup && settings.backupOnSave) {
      await window.api.projects.backup(project.id, settings.maxBackupsPerProject).catch(() => null);
    }
    set({ dirty: false, lastSavedAt: Date.now() });
  };

  const autosave = debounce(() => {
    const { settings, dirty } = get();
    if (settings.autosave && dirty) void persist();
  }, DEFAULT_APP_SETTINGS.autosaveIntervalMs);

  const persistSettings = debounce(() => {
    const { settings } = get();
    void window.api.settings
      .save({ ...settings } as unknown as Record<string, unknown>)
      .catch(() => undefined);
  }, 400);

  /**
   * Publishes a new project version: stamps the timestamps, pushes the previous
   * version onto the undo stack unless the caller opted out, and schedules the
   * autosave. The two commit helpers differ only in how much they copy.
   */
  const publish = (next: Project, current: Project, opts: { history?: boolean }) => {
    next.updatedAt = Date.now();
    const page = activePageOf(next);
    if (page) page.updatedAt = next.updatedAt;

    if (opts.history !== false) {
      set((s) => ({
        project: next,
        past: [...s.past, current].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
      }));
    } else {
      set({ project: next, dirty: true });
    }
    autosave();
  };

  /**
   * Applies a mutation to a deep copy of the whole project. History is pushed
   * by default; live gestures (dragging, resizing) pass history:false and call
   * pushHistory() once at the start of the gesture instead.
   *
   * Reach for this only when the mutation leaves the active page — renaming or
   * reordering pages, teams, project-level fields. Anything confined to one
   * page belongs in commitPage, which copies far less.
   */
  const commit = (fn: (draft: Project) => void, opts: { history?: boolean } = {}) => {
    const current = get().project;
    if (!current) return;
    const next = clone(current);
    fn(next);
    publish(next, current, opts);
  };

  /**
   * Mutates the active page, copying only that page.
   *
   * The project and its pages array are copied shallowly and the active page is
   * deep-cloned; every other page is shared with the previous version. That is
   * what keeps dragging cheap on a large project — moveObjectsTo runs once per
   * pointer move — and stops the hundred-entry undo stack from holding a
   * hundred copies of pages that never changed.
   *
   * The callback gets the page and nothing else, deliberately: the sharing
   * above is sound precisely because nothing here can reach another page. A
   * mutation that needs the project must use commit instead.
   */
  const commitPage = (fn: (page: Page) => void, opts: { history?: boolean } = {}) => {
    const current = get().project;
    if (!current) return;
    const target = activePageOf(current);
    if (!target) return;
    const draft = clone(target);
    const next: Project = { ...current, pages: current.pages.map((p) => (p === target ? draft : p)) };
    fn(draft);
    publish(next, current, opts);
  };

  return {
    /* ------------------------------ state ------------------------------ */
    ships: [],
    icons: [],
    maps: [],
    settings: clone(DEFAULT_APP_SETTINGS),
    projectList: [],
    project: null,
    dirty: false,
    lastSavedAt: 0,
    booted: false,
    past: [],
    future: [],
    tool: 'select',
    toolOptions: clone(initialToolOptions),
    selection: [],
    activeLayerId: LAYER_IDS.annotations,
    camera: { x: 0, y: 0, scale: 0.02 },
    clipboard: [],
    modal: null,
    modalArg: null,
    editingShipId: null,
    leftOpen: true,
    rightOpen: true,
    notesOpen: false,
    toasts: [],
    fitRequest: 0,

    /* ------------------------------ boot ------------------------------- */

    async boot() {
      const [rawSettings, ships, icons, maps, projectList] = await Promise.all([
        window.api.settings.get().catch(() => ({})),
        window.api.ships.list().catch(() => []),
        window.api.icons.list().catch(() => []),
        window.api.maps.list().catch(() => []),
        window.api.projects.list().catch(() => []),
      ]);

      const stored = rawSettings as Partial<AppSettings>;
      const settings: AppSettings = { ...clone(DEFAULT_APP_SETTINGS), ...stored };
      // Ping presets were dropped in schema 2; discard any that were persisted.
      delete (settings as unknown as Record<string, unknown>).pings;
      applyTheme(settings.theme);

      set({
        settings,
        ships: ships as Ship[],
        icons: icons as ShipIconAsset[],
        maps: maps as GameMap[],
        projectList: projectList as ProjectSummary[],
        booted: true,
      });

      const last = settings.lastProjectId;
      if (last && (projectList as ProjectSummary[]).some((p) => p.id === last)) {
        await get().openProject(last);
      } else {
        set({ modal: 'projects' });
      }
    },

    toast(text, kind = 'info') {
      const id = uid('t-');
      set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 6500 : 3200);
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    patchSettings(patch) {
      if (patch.theme) applyTheme(patch.theme);
      set((s) => ({ settings: { ...s.settings, ...patch } }));
      persistSettings();
    },

    /* ---------------------------- projects ----------------------------- */

    async refreshProjects() {
      set({ projectList: (await window.api.projects.list()) as ProjectSummary[] });
    },

    async newProject(name) {
      const project = createProject(name || 'Untitled Project');
      await window.api.projects.save(project);
      set({
        project,
        past: [],
        future: [],
        selection: [],
        dirty: false,
        lastSavedAt: Date.now(),
        modal: null,
        activeLayerId: LAYER_IDS.annotations,
      });
      get().patchSettings({ lastProjectId: project.id });
      get().requestFit();
      await get().refreshProjects();
      get().toast(`Created "${project.name}"`, 'success');
    },

    async openProject(id) {
      const doc = (await window.api.projects.load(id)) as Project | null;
      if (!doc) {
        get().toast('Project could not be loaded', 'error');
        return;
      }
      // Repair anything an older/hand-edited document might be missing.
      doc.pages = (doc.pages ?? []).map((p) => {
        const page = {
          ...createPage(p.name ?? 'Page'),
          ...p,
          // Ranges left page level in schema 2; only the non-range flags survive.
          display: { ...clone(DEFAULT_CHARACTERISTICS), ...pickPageFlags(p.display) },
          layers: createDefaultLayers(),
        };
        delete (page as unknown as Record<string, unknown>).rangeStyles;

        // Drop the object types schema 2 no longer knows how to draw, rather
        // than keeping orphans that nothing can select or render.
        const removed = new Set<string>(REMOVED_OBJECT_TYPES);
        page.objects = (page.objects ?? []).filter((o) => !removed.has(o.type));

        // Objects must not live on the Grid pseudo-layer, or on a layer that
        // no longer exists; either way they would be uneditable. Retired
        // layers map onto Annotations rather than losing their contents.
        const known = new Set(page.layers.map((l) => l.id));
        page.objects = page.objects.map((o) => {
          const remapped = LEGACY_LAYER_REMAP[o.layerId] ?? o.layerId;
          const layerId =
            remapped === LAYER_IDS.grid || !known.has(remapped) ? LAYER_IDS.annotations : remapped;
          if (o.type === 'ship') {
            // Routes are gone; strip their leftovers so they cannot be saved back.
            const ship = { ...o, layerId } as unknown as Record<string, unknown>;
            delete ship.route;
            delete ship.routeVisible;
            delete ship.routeFollows;
            return ship as unknown as typeof o;
          }
          return { ...o, layerId } as typeof o;
        });
        return page;
      });
      if (!doc.pages.length) doc.pages = [createPage('01 - Opening')];
      if (!doc.activePageId || !doc.pages.some((p) => p.id === doc.activePageId)) {
        doc.activePageId = doc.pages[0].id;
      }
      doc.teams = doc.teams ?? [];
      // Rebuilding settings from the known keys drops retired ones (showMinimap)
      // rather than carrying them along in every future save.
      doc.settings = { ...clone(DEFAULT_PROJECT_SETTINGS), ...(doc.settings ?? {}) };
      for (const key of Object.keys(doc.settings) as (keyof typeof doc.settings)[]) {
        if (!(key in DEFAULT_PROJECT_SETTINGS)) delete doc.settings[key];
      }
      // The document now has schema 2 shape, so record that it does.
      doc.schemaVersion = SCHEMA_VERSION;

      set({
        project: doc,
        past: [],
        future: [],
        selection: [],
        dirty: false,
        lastSavedAt: Date.now(),
        modal: null,
        activeLayerId: LAYER_IDS.annotations,
      });
      get().patchSettings({
        lastProjectId: id,
        recentProjectIds: [id, ...get().settings.recentProjectIds.filter((x) => x !== id)].slice(0, 10),
      });
      get().requestFit();
    },

    async saveProject(opts = {}) {
      const { project } = get();
      if (!project) return;
      autosave.cancel();
      await persist({ backup: opts.backup ?? true });
      await get().refreshProjects();
      if (!opts.silent) get().toast('Project saved', 'success');
    },

    async saveProjectAs(name) {
      const { project } = get();
      if (!project) return;
      const copy: Project = { ...clone(project), id: uid('prj-'), name, createdAt: Date.now(), updatedAt: Date.now() };
      await window.api.projects.save(copy);
      set({ project: copy, past: [], future: [], dirty: false, lastSavedAt: Date.now() });
      get().patchSettings({ lastProjectId: copy.id });
      await get().refreshProjects();
      get().toast(`Saved as "${name}"`, 'success');
    },

    async duplicateProject(id) {
      const doc = (await window.api.projects.load(id)) as Project | null;
      if (!doc) return;
      const copy: Project = { ...doc, id: uid('prj-'), name: `${doc.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
      await window.api.projects.save(copy);
      await get().refreshProjects();
      get().toast(`Duplicated "${doc.name}"`, 'success');
    },

    async renameProject(id, name) {
      const { project } = get();
      if (project && project.id === id) {
        commit((draft) => {
          draft.name = name;
        });
        await persist();
      } else {
        const doc = (await window.api.projects.load(id)) as Project | null;
        if (!doc) return;
        doc.name = name;
        doc.updatedAt = Date.now();
        await window.api.projects.save(doc);
      }
      await get().refreshProjects();
    },

    async deleteProject(id) {
      const ok = await window.api.dialog.confirm({
        title: 'Delete project',
        message: 'Delete this project permanently?',
        detail: 'The project and its backups are removed from local storage. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      await window.api.projects.remove(id);
      if (get().project?.id === id) {
        set({ project: null, past: [], future: [], selection: [], modal: 'projects' });
        get().patchSettings({ lastProjectId: null });
      }
      await get().refreshProjects();
      get().toast('Project deleted');
    },

    async importProject() {
      try {
        const doc = (await window.api.projects.importFile()) as Project | null;
        if (!doc) return;
        const [ships, icons, maps] = await Promise.all([
          window.api.ships.list(),
          window.api.icons.list(),
          window.api.maps.list(),
        ]);
        set({ ships: ships as Ship[], icons: icons as ShipIconAsset[], maps: maps as GameMap[] });
        await get().refreshProjects();
        await get().openProject(doc.id);
        get().toast(`Imported "${doc.name}"`, 'success');
      } catch (err) {
        get().toast(`Import failed: ${(err as Error).message}`, 'error');
      }
    },

    async exportProject() {
      const { project } = get();
      if (!project) return;
      try {
        const file = await window.api.projects.exportFile(project);
        if (file) get().toast(`Exported to ${file}`, 'success');
      } catch (err) {
        get().toast(`Export failed: ${(err as Error).message}`, 'error');
      }
    },

    async closeProject() {
      if (get().dirty) await persist();
      set({ project: null, selection: [], past: [], future: [], modal: 'projects' });
    },

    /* ------------------------------ pages ------------------------------ */

    setActivePage(id) {
      commit((draft) => {
        draft.activePageId = id;
      });
      set({ selection: [] });
      get().requestFit();
    },

    addPage(name) {
      const { project } = get();
      if (!project) return;
      const index = project.pages.length + 1;
      const page = createPage(name ?? `${String(index).padStart(2, '0')} - New Page`);
      // A new page inherits the map of the current one: pages are usually
      // successive phases of the same battle.
      page.mapId = activePageOf(project)?.mapId ?? null;
      commit((draft) => {
        draft.pages.push(page);
        draft.activePageId = page.id;
      });
      set({ selection: [] });
    },

    duplicatePage(id) {
      commit((draft) => {
        const src = draft.pages.find((p) => p.id === id);
        if (!src) return;
        const copy = clone(src);
        copy.id = uid('page-');
        copy.name = `${src.name} (copy)`;
        copy.createdAt = Date.now();
        // Fresh ids so the two pages never share object identity.
        copy.objects = copy.objects.map((o) => ({ ...o, id: uid('obj-') })) as TacticalObject[];
        const at = draft.pages.findIndex((p) => p.id === id);
        draft.pages.splice(at + 1, 0, copy);
        draft.activePageId = copy.id;
      });
      set({ selection: [] });
    },

    renamePage(id, name) {
      commit((draft) => {
        const page = draft.pages.find((p) => p.id === id);
        if (page) page.name = name;
      });
    },

    deletePage(id) {
      const { project } = get();
      if (!project || project.pages.length <= 1) {
        get().toast('A project needs at least one page', 'error');
        return;
      }
      commit((draft) => {
        const at = draft.pages.findIndex((p) => p.id === id);
        draft.pages = draft.pages.filter((p) => p.id !== id);
        if (draft.activePageId === id) {
          draft.activePageId = draft.pages[clamp(at, 0, draft.pages.length - 1)].id;
        }
      });
      set({ selection: [] });
    },

    reorderPage(id, delta) {
      commit((draft) => {
        const at = draft.pages.findIndex((p) => p.id === id);
        const to = clamp(at + delta, 0, draft.pages.length - 1);
        if (at < 0 || at === to) return;
        const [page] = draft.pages.splice(at, 1);
        draft.pages.splice(to, 0, page);
      });
    },

    movePageTo(id, index) {
      commit((draft) => {
        const at = draft.pages.findIndex((p) => p.id === id);
        if (at < 0) return;
        const to = clamp(index, 0, draft.pages.length - 1);
        if (at === to) return;
        const [page] = draft.pages.splice(at, 1);
        draft.pages.splice(to, 0, page);
      });
    },

    setPageMap(mapId) {
      commitPage((page) => {
        page.mapId = mapId;
      });
      get().requestFit();
    },

    patchMapView(patch) {
      commitPage((page) => {
        page.mapView = { ...page.mapView, ...patch };
      });
    },

    setNotes(text) {
      commitPage((page) => {
        page.notes = text;
      }, { history: false });
    },

    setPageDisplay(key, value) {
      commitPage((page) => {
        page.display = { ...page.display, [key]: value };
      });
    },

    /* ----------------------------- objects ----------------------------- */

    addObjects(objects, opts = {}) {
      if (!objects.length) return;
      commitPage((page) => {
        page.objects.push(...objects);
      }, { history: opts.history !== false });
      if (opts.select !== false) set({ selection: objects.map((o) => o.id) });
    },

    updateObject(id, patch, opts = {}) {
      get().updateObjects([id], patch, opts);
    },

    updateObjects(ids, patch, opts = {}) {
      const idSet = new Set(ids);
      commitPage((page) => {
        page.objects = page.objects.map((o) => (idSet.has(o.id) ? ({ ...o, ...patch } as TacticalObject) : o));
      }, { history: opts.history !== false });
    },

    removeObjects(ids) {
      const idSet = new Set(ids);
      commitPage((page) => {
        page.objects = page.objects.filter((o) => !idSet.has(o.id));
      });
      set((s) => ({ selection: s.selection.filter((id) => !idSet.has(id)) }));
    },

    deleteSelection() {
      const { selection, project } = get();
      if (!selection.length || !project) return;
      const page = activePageOf(project);
      if (!page) return;
      const lockedLayers = new Set(page.layers.filter((l) => l.locked).map((l) => l.id));
      const deletable = page.objects
        .filter((o) => selection.includes(o.id) && !o.locked && !lockedLayers.has(o.layerId))
        .map((o) => o.id);
      if (!deletable.length) return;
      get().removeObjects(deletable);
    },

    duplicateSelection() {
      const page = getActivePage(get());
      if (!page) return;
      const { selection } = get();
      const copies = page.objects
        .filter((o) => selection.includes(o.id))
        .map((o) => {
          const copy = clone(o);
          copy.id = uid('obj-');
          copy.x += 800;
          copy.y += 800;
          return copy;
        });
      get().addObjects(copies);
    },

    copySelection() {
      const page = getActivePage(get());
      if (!page) return;
      const { selection } = get();
      const items = page.objects.filter((o) => selection.includes(o.id)).map(clone);
      set({ clipboard: items });
      if (items.length) get().toast(`${items.length} object${items.length > 1 ? 's' : ''} copied`);
    },

    paste(at) {
      const { clipboard } = get();
      if (!clipboard.length) return;
      // Paste keeps the relative arrangement, anchored at the cursor.
      const minX = Math.min(...clipboard.map((o) => o.x));
      const minY = Math.min(...clipboard.map((o) => o.y));
      const dx = at ? at.x - minX : 800;
      const dy = at ? at.y - minY : 800;
      const copies = clipboard.map((o) => {
        const copy = clone(o);
        copy.id = uid('obj-');
        copy.x += dx;
        copy.y += dy;
        return copy;
      });
      get().addObjects(copies);
    },

    nudgeSelection(dx, dy) {
      const page = getActivePage(get());
      if (!page) return;
      const { selection } = get();
      if (!selection.length) return;
      const idSet = new Set(selection);
      commitPage((p) => {
        p.objects = p.objects.map((o) => {
          if (!idSet.has(o.id) || o.locked) return o;
          return { ...o, x: o.x + dx, y: o.y + dy } as TacticalObject;
        });
      });
    },

    /**
     * Final commit of a drag gesture. History was pushed when the drag
     * started, so the whole move collapses into a single undo step.
     */
    moveObjectsTo(patches) {
      if (!patches.length) return;
      const byId = new Map(patches.map((p) => [p.id, p]));
      commitPage((page) => {
        page.objects = page.objects.map((o) => {
          const patch = byId.get(o.id);
          if (!patch) return o;
          const moved = { ...o, x: patch.x, y: patch.y } as TacticalObject;
          return moved;
        });
      }, { history: false });
    },

    reorderObject(id, delta) {
      commitPage((page) => {
        const at = page.objects.findIndex((o) => o.id === id);
        if (at < 0) return;
        const [obj] = page.objects.splice(at, 1);
        let to: number;
        if (delta === 'front') to = page.objects.length;
        else if (delta === 'back') to = 0;
        else to = clamp(at + delta, 0, page.objects.length);
        page.objects.splice(to, 0, obj);
      });
    },

    assignLayer(ids, layerId) {
      get().updateObjects(ids, { layerId } as Partial<TacticalObject>);
    },

    /* --------------------------- ships on map -------------------------- */

    placeShip(shipId, at, teamId) {
      const { ships, project } = get();
      const ship = ships.find((s) => s.id === shipId);
      if (!ship || !project) return;
      const team = teamId !== undefined ? teamId : project.settings.defaultTeamId ?? project.teams[0]?.id ?? null;
      const obj = createShipObject(ship, at, team);
      get().addObjects([obj]);
    },

    setShipDisplay(objectId, key, value) {
      commitPage((page) => {
        page.objects = page.objects.map((o) => {
          if (o.id !== objectId || o.type !== 'ship') return o;
          const display: CharacteristicFlags = { ...(o as ShipObject).display };
          // undefined clears the per-ship override so the page default applies.
          if (value === undefined) delete display[key];
          else display[key] = value;
          return { ...o, display } as TacticalObject;
        });
      });
    },

    /* ------------------------------ layers ----------------------------- */

    addLayer(name) {
      const id = uid('layer-');
      commitPage((page) => {
        page.layers.push({ id, name: name ?? `Layer ${page.layers.length + 1}`, visible: true, locked: false, opacity: 1 });
      });
      set({ activeLayerId: id });
    },

    updateLayer(id, patch) {
      commitPage((page) => {
        page.layers = page.layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
      });
    },

    removeLayer(id) {
      commitPage((page) => {
        const layer = page.layers.find((l) => l.id === id);
        if (!layer || layer.system) return;
        page.layers = page.layers.filter((l) => l.id !== id);
        // Orphaned objects fall back to the shapes layer rather than vanishing.
        page.objects = page.objects.map((o) => (o.layerId === id ? { ...o, layerId: LAYER_IDS.annotations } : o));
      });
      if (get().activeLayerId === id) set({ activeLayerId: LAYER_IDS.annotations });
    },

    reorderLayer(id, delta) {
      commitPage((page) => {
        const at = page.layers.findIndex((l) => l.id === id);
        const to = clamp(at + delta, 0, page.layers.length - 1);
        if (at < 0 || at === to) return;
        const [layer] = page.layers.splice(at, 1);
        page.layers.splice(to, 0, layer);
      });
    },

    setActiveLayer(id) {
      // The Grid entry is a background pseudo-layer for toggling the grid and
      // coordinates; making it the drawing target would silently send new
      // objects somewhere they cannot be edited.
      if (id === LAYER_IDS.grid) return;
      set({ activeLayerId: id });
    },

    /* ------------------------------ teams ------------------------------ */

    addTeam() {
      const palette = ['#4ea3ff', '#ff5f56', '#3fd68a', '#f4c95d', '#8f7bff', '#6ee7d5'];
      commit((draft) => {
        draft.teams.push({
          id: uid('team-'),
          name: `Team ${draft.teams.length + 1}`,
          color: palette[draft.teams.length % palette.length],
          visible: true,
          locked: false,
        });
      });
    },

    updateTeam(id, patch) {
      commit((draft) => {
        draft.teams = draft.teams.map((t) => (t.id === id ? { ...t, ...patch } : t));
      });
    },

    removeTeam(id) {
      commit((draft) => {
        draft.teams = draft.teams.filter((t) => t.id !== id);
        if (draft.settings.defaultTeamId === id) draft.settings.defaultTeamId = draft.teams[0]?.id ?? null;
        for (const page of draft.pages) {
          page.objects = page.objects.map((o) =>
            o.type === 'ship' && (o as ShipObject).teamId === id ? ({ ...o, teamId: null } as TacticalObject) : o,
          );
        }
      });
    },

    /* ----------------------------- history ----------------------------- */

    pushHistory() {
      const current = get().project;
      if (!current) return;
      set((s) => ({ past: [...s.past, clone(current)].slice(-HISTORY_LIMIT), future: [] }));
    },

    undo() {
      const { past, future, project } = get();
      if (!past.length || !project) return;
      const prev = past[past.length - 1];
      const page = activePageOf(prev);
      const alive = new Set(page?.objects.map((o) => o.id) ?? []);
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [...future, project].slice(-HISTORY_LIMIT),
        selection: get().selection.filter((id) => alive.has(id)),
        dirty: true,
      });
      autosave();
    },

    redo() {
      const { past, future, project } = get();
      if (!future.length || !project) return;
      const next = future[future.length - 1];
      const page = activePageOf(next);
      const alive = new Set(page?.objects.map((o) => o.id) ?? []);
      set({
        project: next,
        future: future.slice(0, -1),
        past: [...past, project].slice(-HISTORY_LIMIT),
        selection: get().selection.filter((id) => alive.has(id)),
        dirty: true,
      });
      autosave();
    },

    /* --------------------------- library: maps ------------------------- */

    async importMaps() {
      const picked = await window.api.maps.pickImages();
      if (!picked.length) return;
      const created: GameMap[] = [];
      for (const file of picked) {
        const size = await measureImage(file.dataUrl);
        const id = uid('map-');
        const record = {
          id,
          name: file.name,
          ext: file.ext,
          mime: file.mime,
          pixelWidth: size.width,
          pixelHeight: size.height,
          // 30 km square is the standard competitive map footprint; the Map
          // Manager lets the user correct it per map.
          widthMeters: 30000,
          heightMeters: Math.round((30000 * size.height) / Math.max(1, size.width)),
          gridCols: 10,
          gridRows: 10,
          addedAt: Date.now(),
          updatedAt: Date.now(),
        };
        const stored = (await window.api.maps.create(record, file.dataUrl)) as GameMap;
        created.push(stored);
      }
      set({ maps: (await window.api.maps.list()) as GameMap[] });
      get().toast(`Imported ${created.length} map${created.length > 1 ? 's' : ''}`, 'success');
      // First map in an empty project is applied straight away.
      const page = getActivePage(get());
      if (page && !page.mapId && created[0]) get().setPageMap(created[0].id);
    },

    async updateMap(map) {
      await window.api.maps.update({ ...map, updatedAt: Date.now() });
      set({ maps: (await window.api.maps.list()) as GameMap[] });
    },

    async deleteMap(id) {
      const ok = await window.api.dialog.confirm({
        title: 'Delete map',
        message: 'Delete this map and its image?',
        detail: 'Pages using it will keep their objects but lose the background image.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      set({ maps: (await window.api.maps.remove(id)) as GameMap[] });
      get().toast('Map deleted');
    },

    async duplicateMap(id) {
      const src = get().maps.find((m) => m.id === id);
      if (!src) return;
      const dataUrl = await window.api.maps.dataUrl(src.file, src.mime);
      if (!dataUrl) return;
      const newIdValue = uid('map-');
      const ext = src.file.slice(src.file.lastIndexOf('.'));
      const record = { ...src, id: newIdValue, name: `${src.name} (copy)`, ext, addedAt: Date.now(), updatedAt: Date.now() };
      await window.api.maps.create(record, dataUrl);
      set({ maps: (await window.api.maps.list()) as GameMap[] });
    },

    async replaceMapImage(id) {
      const picked = await window.api.maps.pickImages();
      if (!picked.length) return;
      const file = picked[0];
      const size = await measureImage(file.dataUrl);
      await window.api.maps.replaceImage(id, file.ext, file.dataUrl);
      const maps = (await window.api.maps.list()) as GameMap[];
      const updated = maps.find((m) => m.id === id);
      if (updated) {
        await window.api.maps.update({ ...updated, pixelWidth: size.width, pixelHeight: size.height, updatedAt: Date.now() });
      }
      set({ maps: (await window.api.maps.list()) as GameMap[] });
      get().toast('Map image replaced', 'success');
    },

    /* -------------------------- library: ships ------------------------- */

    async importShipData() {
      const picked = await window.api.ships.pickDataFile();
      if (!picked) return;
      try {
        const { ships: parsed, warnings } = parseShipData(picked.text, picked.ext);
        if (!parsed.length) {
          get().toast('No ships found in that file', 'error');
          return;
        }
        // Merge on name+tier so re-importing an updated sheet updates in place.
        const existing = get().ships;
        const byKey = new Map(existing.map((s) => [`${s.name.toLowerCase()}|${s.tier}`, s]));
        let added = 0;
        let updated = 0;
        for (const ship of parsed) {
          const key = `${ship.name.toLowerCase()}|${ship.tier}`;
          const prev = byKey.get(key);
          if (prev) {
            byKey.set(key, { ...prev, ...ship, id: prev.id, iconId: ship.iconId ?? prev.iconId });
            updated++;
          } else {
            byKey.set(key, ship);
            added++;
          }
        }
        const merged = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
        await window.api.ships.saveAll(merged);
        set({ ships: merged });
        get().toast(`${added} added, ${updated} updated${warnings.length ? ` (${warnings.length} warnings)` : ''}`, 'success');
      } catch (err) {
        get().toast(`Could not parse file: ${(err as Error).message}`, 'error');
      }
    },

    async exportShipData(format) {
      const text = serializeShips(get().ships, format);
      const file = await window.api.ships.exportData(text, `.${format}`);
      if (file) get().toast(`Ship database exported`, 'success');
    },

    async upsertShip(ship) {
      const ships = get().ships.slice();
      const at = ships.findIndex((s) => s.id === ship.id);
      if (at >= 0) ships[at] = ship;
      else ships.push(ship);
      ships.sort((a, b) => a.name.localeCompare(b.name));
      await window.api.ships.saveAll(ships);
      set({ ships });

      // Keep placed ships in step with the database.
      const { project } = get();
      if (project) {
        commit((draft) => {
          for (const page of draft.pages) {
            page.objects = page.objects.map((o) =>
              o.type === 'ship' && (o as ShipObject).shipId === ship.id
                ? ({ ...o, shipName: ship.name, shipClass: ship.class, tier: ship.tier } as TacticalObject)
                : o,
            );
          }
        }, { history: false });
      }
    },

    async deleteShip(id) {
      const ships = get().ships.filter((s) => s.id !== id);
      await window.api.ships.saveAll(ships);
      set({ ships });
    },

    async loadSampleShips() {
      const existing = get().ships;
      const known = new Set(existing.map((s) => `${s.name.toLowerCase()}|${s.tier}`));
      const additions = SAMPLE_SHIPS.filter((s) => !known.has(`${s.name.toLowerCase()}|${s.tier}`)).map((s) => ({
        ...s,
        id: uid('ship-'),
        iconId: null,
      })) as Ship[];
      const merged = [...existing, ...additions].sort((a, b) => a.name.localeCompare(b.name));
      await window.api.ships.saveAll(merged);
      set({ ships: merged });
      get().toast(`Loaded ${additions.length} sample ships`, 'success');
    },

    async importIcons() {
      const picked = await window.api.icons.pickImages();
      if (!picked.length) return;
      for (const file of picked) {
        const id = uid('icon-');
        await window.api.icons.create({ id, name: file.name, ext: file.ext, mime: file.mime, addedAt: Date.now() }, file.dataUrl);
      }
      const icons = (await window.api.icons.list()) as ShipIconAsset[];
      set({ icons });

      // Icons named after a ship are matched automatically, which makes a bulk
      // icon import a one-step operation.
      const ships = get().ships.slice();
      let matched = 0;
      for (const icon of icons) {
        const target = ships.find(
          (s) => !s.iconId && normalizeName(s.name) === normalizeName(icon.name),
        );
        if (target) {
          target.iconId = icon.id;
          matched++;
        }
      }
      if (matched) {
        await window.api.ships.saveAll(ships);
        set({ ships });
      }
      get().toast(`Imported ${picked.length} icon${picked.length > 1 ? 's' : ''}${matched ? `, ${matched} auto-matched` : ''}`, 'success');
    },

    async deleteIcon(id) {
      const icons = (await window.api.icons.remove(id)) as ShipIconAsset[];
      const ships = get().ships.map((s) => (s.iconId === id ? { ...s, iconId: null } : s));
      await window.api.ships.saveAll(ships);
      set({ icons, ships });
    },

    async assignIcon(shipId, iconId) {
      const ships = get().ships.map((s) => (s.id === shipId ? { ...s, iconId } : s));
      await window.api.ships.saveAll(ships);
      set({ ships });
    },

    /* -------------------------------- ui ------------------------------- */

    setTool(tool) {
      set({ tool });
      if (tool !== 'select' && tool !== 'marquee') set({ selection: [] });
    },

    patchToolOptions(patch) {
      set((s) => ({ toolOptions: { ...s.toolOptions, ...patch } }));
    },

    select(ids, additive) {
      set((s) => ({ selection: additive ? [...new Set([...s.selection, ...ids])] : ids }));
    },

    toggleSelect(id) {
      set((s) => ({
        selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id],
      }));
    },

    clearSelection() {
      set({ selection: [] });
    },

    setCamera(camera) {
      set((s) => ({ camera: { ...s.camera, ...camera } }));
    },

    requestFit() {
      set((s) => ({ fitRequest: s.fitRequest + 1 }));
    },

    openModal(modal, arg) {
      set({ modal, modalArg: arg ?? null });
    },

    closeModal() {
      set({ modal: null, modalArg: null });
    },

    setEditingShip(id) {
      set({ editingShipId: id, modal: id ? 'shipEditor' : null });
    },

    toggleLeft() {
      set((s) => ({ leftOpen: !s.leftOpen }));
    },
    toggleRight() {
      set((s) => ({ rightOpen: !s.rightOpen }));
    },
    toggleNotes() {
      set((s) => ({ notesOpen: !s.notesOpen }));
    },
  };
});

/* ------------------------------------------------------------------ */
/* Small helpers used by the store                                     */
/* ------------------------------------------------------------------ */

function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 4096, height: 4096 });
    img.src = dataUrl;
  });
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ------------------------------------------------------------------ */
/* Derived helpers                                                     */
/* ------------------------------------------------------------------ */

/** Page defaults with the ship's own overrides applied on top. */
/**
 * Keeps only the characteristics a page is allowed to set a default for.
 * Range keys are filtered out, because ranges are a per-ship decision.
 */
export function pickPageFlags(flags: CharacteristicFlags | undefined): CharacteristicFlags {
  const out: CharacteristicFlags = {};
  for (const key of PAGE_CHARACTERISTIC_KEYS) {
    if (flags && flags[key] !== undefined) out[key] = flags[key];
  }
  return out;
}

export function effectiveFlags(page: Page, ship: ShipObject): Required<CharacteristicFlags> {
  // Page defaults never carry range keys, so a ship's ranges come only from
  // its own overrides.
  return {
    ...DEFAULT_RANGE_FLAGS,
    ...DEFAULT_CHARACTERISTICS,
    ...pickPageFlags(page.display),
    ...ship.display,
  } as Required<CharacteristicFlags>;
}

export function shipRangeKm(ship: Ship | undefined, key: CharacteristicKey): number | undefined {
  if (!ship) return undefined;
  switch (key) {
    case 'detection':
      return ship.concealment_km;
    case 'radar':
      return ship.radar_km;
    case 'hydro':
      return ship.hydro_km;
    case 'mainBattery':
      return ship.mainBatteryRange_km;
    case 'secondary':
      return ship.secondaryRange_km;
    case 'torpedo':
      return ship.torpedoRange_km;
    default:
      return undefined;
  }
}
