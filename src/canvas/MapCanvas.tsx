import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Group, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  LAYER_IDS,
  type CharacteristicFlags,
  type GameMap,
  type ID,
  type Ship,
  type Team,
  type PathObject,
  type ShapeObject,
  type ShipObject,
  type TacticalObject,
  type TextObject,
  type Vec2,
  type ZoneObject,
} from '@/types/model';
import { effectiveFlags, getActivePage, useStore } from '@/state/store';
import { useAsset } from '@/state/assets';
import { MapBackground } from './MapBackground';
import { ObjectNode, flatten } from './ObjectNode';
import { RouteHandles, ShipNode, ShipRanges, ShipRoute } from './ShipNode';
import { DEFAULT_EXPORT, setCanvasApi, type ExportOptions } from './canvasBridge';
import { clamp, dist, simplifyPath, uid, gridRef } from '@/lib/util';
import {
  createMarker,
  createNumber,
  createPath,
  createPing,
  createShape,
  createText,
  createZone,
} from '@/lib/factory';
import { ZONE_PRESETS } from '@/data/pings';

const MIN_SCALE = 0.0015;
const MAX_SCALE = 0.6;
const FALLBACK_W = 30000;
const FALLBACK_H = 30000;

type DraftState =
  | { kind: 'shape'; obj: TacticalObject; start: Vec2 }
  | { kind: 'poly'; obj: TacticalObject; points: Vec2[]; cursor: Vec2 }
  | null;

interface ContextMenuState {
  x: number;
  y: number;
  world: Vec2;
  objectId: ID | null;
}

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const contentRef = useRef<Konva.Layer>(null);

  const project = useStore((s) => s.project);
  const page = useStore(getActivePage);
  const maps = useStore((s) => s.maps);
  const ships = useStore((s) => s.ships);
  const icons = useStore((s) => s.icons);
  const camera = useStore((s) => s.camera);
  const tool = useStore((s) => s.tool);
  const toolOptions = useStore((s) => s.toolOptions);
  const selection = useStore((s) => s.selection);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const fitRequest = useStore((s) => s.fitRequest);
  const spacePan = useStore((s) => s.spacePan);
  const pings = useStore((s) => s.pings);

  const [size, setSize] = useState({ width: 800, height: 600 });
  const [draft, setDraft] = useState<DraftState>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Vec2>({ x: 0, y: 0 });
  const [editingText, setEditingText] = useState<{ id: ID; value: string } | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [exportOpts, setExportOpts] = useState<ExportOptions | null>(null);

  const panRef = useRef<{ active: boolean; last: Vec2 } | null>(null);
  const dragRef = useRef<{ last: Vec2; ids: ID[] } | null>(null);
  const fitScaleRef = useRef(0.02);

  const map: GameMap | null = useMemo(
    () => maps.find((m) => m.id === page?.mapId) ?? null,
    [maps, page?.mapId],
  );
  const mapImage = useAsset('map', map?.file, map?.mime ?? '');

  const worldW = map?.widthMeters ?? FALLBACK_W;
  const worldH = map?.heightMeters ?? FALLBACK_H;

  const shipById = useMemo(() => new Map(ships.map((s) => [s.id, s])), [ships]);
  const iconById = useMemo(() => new Map(icons.map((i) => [i.id, i])), [icons]);
  const teamById = useMemo(() => new Map((project?.teams ?? []).map((t) => [t.id, t])), [project?.teams]);

  const inv = 1 / camera.scale;
  const snapStep = project?.settings.snapStep ?? 500;
  const snapOn = !!project?.settings.snapToGrid;
  const iconSize = project?.settings.shipIconSize ?? 30;

  /* ------------------------------------------------------------------ */
  /* Sizing & camera                                                     */
  /* ------------------------------------------------------------------ */

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const scale = Math.min(size.width / worldW, size.height / worldH) * 0.94;
    fitScaleRef.current = Math.min(size.width / worldW, size.height / worldH);
    useStore.getState().setCamera({
      scale,
      x: (size.width - worldW * scale) / 2,
      y: (size.height - worldH * scale) / 2,
    });
  }, [size.width, size.height, worldW, worldH]);

  useEffect(() => {
    fitScaleRef.current = Math.min(size.width / worldW, size.height / worldH);
  }, [size.width, size.height, worldW, worldH]);

  useEffect(() => {
    if (size.width > 0 && size.height > 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest, size.width, size.height, worldW, worldH]);

  const toWorld = useCallback(
    (p: Vec2): Vec2 => ({ x: (p.x - camera.x) / camera.scale, y: (p.y - camera.y) / camera.scale }),
    [camera],
  );
  const toScreen = useCallback(
    (p: Vec2): Vec2 => ({ x: p.x * camera.scale + camera.x, y: p.y * camera.scale + camera.y }),
    [camera],
  );

  const snap = useCallback(
    (p: Vec2): Vec2 =>
      snapOn ? { x: Math.round(p.x / snapStep) * snapStep, y: Math.round(p.y / snapStep) * snapStep } : p,
    [snapOn, snapStep],
  );

  const pointerWorld = useCallback((): Vec2 => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!p) return { x: 0, y: 0 };
    return toWorld(p);
  }, [toWorld]);

  /* ------------------------------------------------------------------ */
  /* Public canvas API                                                   */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    setCanvasApi({
      fit,
      zoomBy: (factor) => {
        const { camera: cam } = useStore.getState();
        const center = { x: size.width / 2, y: size.height / 2 };
        const world = { x: (center.x - cam.x) / cam.scale, y: (center.y - cam.y) / cam.scale };
        const scale = clamp(cam.scale * factor, MIN_SCALE, MAX_SCALE);
        useStore.getState().setCamera({
          scale,
          x: center.x - world.x * scale,
          y: center.y - world.y * scale,
        });
      },
      zoomTo: (relative) => {
        const scale = clamp(fitScaleRef.current * relative, MIN_SCALE, MAX_SCALE);
        const { camera: cam } = useStore.getState();
        const center = { x: size.width / 2, y: size.height / 2 };
        const world = { x: (center.x - cam.x) / cam.scale, y: (center.y - cam.y) / cam.scale };
        useStore.getState().setCamera({ scale, x: center.x - world.x * scale, y: center.y - world.y * scale });
      },
      screenToWorld: toWorld,
      worldToScreen: toScreen,
      centerOn: (p) => {
        const { camera: cam } = useStore.getState();
        useStore.getState().setCamera({
          x: size.width / 2 - p.x * cam.scale,
          y: size.height / 2 - p.y * cam.scale,
        });
      },
      exportImage: async (opts) => doExport(opts),
      fitScale: () => fitScaleRef.current,
      viewport: () => ({ width: size.width, height: size.height }),
      worldSize: () => ({ width: worldW, height: worldH }),
    });
    return () => setCanvasApi(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, toWorld, toScreen, size.width, size.height, worldW, worldH]);

  /**
   * Renders the map to an image at the requested resolution.
   *
   * The export re-uses the live scene graph with a temporary set of category
   * overrides, so whatever is hidden on screen — a layer, a ship's radar
   * ring — is hidden in the file as well.
   */
  const doExport = async (opts: ExportOptions): Promise<string | null> => {
    const stage = stageRef.current;
    if (!stage) return null;
    const prevCamera = useStore.getState().camera;

    setExportOpts(opts);
    const scale = Math.min(size.width / worldW, size.height / worldH);
    useStore.getState().setCamera({
      scale,
      x: (size.width - worldW * scale) / 2,
      y: (size.height - worldH * scale) / 2,
    });

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    stage.batchDraw();

    const rect = {
      x: (size.width - worldW * scale) / 2,
      y: (size.height - worldH * scale) / 2,
      width: worldW * scale,
      height: worldH * scale,
    };
    const pixelRatio = clamp(opts.width / rect.width, 0.2, 12);

    let url: string | null = null;
    try {
      url = stage.toDataURL({
        ...rect,
        pixelRatio,
        mimeType: opts.format === 'jpg' ? 'image/jpeg' : 'image/png',
        quality: opts.quality,
      });
    } catch {
      url = null;
    }

    setExportOpts(null);
    useStore.getState().setCamera(prevCamera);
    return url;
  };

  /* ------------------------------------------------------------------ */
  /* Wheel zoom                                                          */
  /* ------------------------------------------------------------------ */

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;

    // Ctrl+wheel and plain wheel both zoom; shift+wheel pans horizontally.
    if (e.evt.shiftKey) {
      useStore.getState().setCamera({ x: camera.x - e.evt.deltaY, y: camera.y });
      return;
    }
    const factor = e.evt.deltaY > 0 ? 1 / 1.12 : 1.12;
    const world = toWorld(pointer);
    const scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
    useStore.getState().setCamera({
      scale,
      x: pointer.x - world.x * scale,
      y: pointer.y - world.y * scale,
    });
  };

  /* ------------------------------------------------------------------ */
  /* Tool interactions                                                   */
  /* ------------------------------------------------------------------ */

  const activeZonePreset = ZONE_PRESETS.find((z) => z.id === toolOptions.zonePresetId) ?? ZONE_PRESETS[0];
  const activePing = pings.find((p) => p.id === toolOptions.pingPresetId) ?? pings[0];

  /**
   * Resolves the layer a newly drawn object belongs on.
   *
   * The Grid entry is a background pseudo-layer that exists only to toggle the
   * grid and coordinates; a locked layer cannot be edited afterwards. Neither
   * is ever a legal target, so both fall through to a real drawing layer.
   */
  const layerFor = (kind: 'shape' | 'text' | 'ping' | 'zone'): ID => {
    const layers = page?.layers ?? [];
    const usable = (id: string) => layers.some((l) => l.id === id && !l.locked && l.id !== LAYER_IDS.grid);

    if (kind === 'ping' && usable(LAYER_IDS.pings)) return LAYER_IDS.pings;
    if (kind === 'zone' && usable(LAYER_IDS.zones)) return LAYER_IDS.zones;
    if (kind === 'text' && usable(LAYER_IDS.text)) return LAYER_IDS.text;

    // Otherwise the planner's selected layer, if it can actually hold objects.
    if (usable(activeLayerId)) return activeLayerId;
    if (usable(LAYER_IDS.shapes)) return LAYER_IDS.shapes;
    return layers.find((l) => !l.locked && l.id !== LAYER_IDS.grid)?.id ?? LAYER_IDS.shapes;
  };

  const startPan = (pos: Vec2) => {
    panRef.current = { active: true, last: pos };
  };

  const onMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    setMenu(null);
    const stage = stageRef.current;
    if (!stage || !page) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const world = snap(toWorld(pos));
    const middle = e.evt.button === 1;
    const onEmpty = e.target === stage || e.target.name() === 'backdrop';

    if (middle || tool === 'pan' || spacePan) {
      e.evt.preventDefault();
      startPan(pos);
      return;
    }
    if (e.evt.button !== 0) return;

    if (tool === 'select' || tool === 'marquee') {
      if (onEmpty) {
        if (!e.evt.shiftKey) useStore.getState().clearSelection();
        setMarquee({ x: pos.x, y: pos.y, w: 0, h: 0 });
      }
      return;
    }

    // Single-click placements
    if (tool === 'ping' && activePing) {
      const obj = createPing(activePing, layerFor('ping'), world, toolOptions.pingSize);
      useStore.getState().addObjects([obj]);
      return;
    }
    if (tool === 'marker') {
      useStore.getState().addObjects([createMarker(layerFor('shape'), world, toolOptions.markerColor)]);
      return;
    }
    if (tool === 'number') {
      const n = toolOptions.numberCounter;
      useStore.getState().addObjects([createNumber(layerFor('text'), world, n)]);
      useStore.getState().patchToolOptions({ numberCounter: n + 1 });
      return;
    }
    if (tool === 'text') {
      const obj = createText(layerFor('text'), world, '', toolOptions.fontSize);
      useStore.getState().addObjects([obj]);
      setEditingText({ id: obj.id, value: '' });
      return;
    }
    if (tool === 'route') {
      const shipId = selection.find((id) => page.objects.find((o) => o.id === id && o.type === 'ship'));
      if (shipId) useStore.getState().addWaypoint(shipId, world);
      else useStore.getState().toast('Select a ship first, then click to add waypoints', 'error');
      return;
    }

    // Multi-click polygons
    const wantsPolygon =
      tool === 'polygon' || tool === 'area' || (tool === 'zone' && activeZonePreset.shape === 'polygon');
    if (wantsPolygon) {
      setDraft((prev) => {
        if (prev?.kind === 'poly') {
          return { ...prev, points: [...prev.points, world], cursor: world };
        }
        const obj =
          tool === 'zone'
            ? createZone(activeZonePreset, layerFor('zone'), world)
            : createPath(tool as PathObject['type'], layerFor('shape'), world, [], toolOptions.stroke);
        return { kind: 'poly', obj, points: [world], cursor: world };
      });
      return;
    }

    // Drag-defined objects
    const dragTools: Record<string, true> = {
      freehand: true, line: true, arrow: true, doubleArrow: true, curvedArrow: true,
      rect: true, roundRect: true, circle: true, ellipse: true, arc: true,
      ruler: true, bearing: true, zone: true,
    };
    if (dragTools[tool]) {
      let obj: TacticalObject;
      if (tool === 'zone') {
        obj = createZone(activeZonePreset, layerFor('zone'), world, 0);
      } else if (['rect', 'roundRect', 'circle', 'ellipse', 'arc'].includes(tool)) {
        obj = createShape(tool as ShapeObject['type'], layerFor('shape'), world, 0, 0, toolOptions.stroke);
      } else {
        obj = createPath(tool as PathObject['type'], layerFor('shape'), world, [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ], toolOptions.stroke);
      }
      setDraft({ kind: 'shape', obj, start: world });
    }
  };

  const onMouseMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const raw = toWorld(pos);
    setCursorWorld(raw);
    const world = snap(raw);

    if (panRef.current?.active) {
      const last = panRef.current.last;
      useStore.getState().setCamera({ x: camera.x + (pos.x - last.x), y: camera.y + (pos.y - last.y) });
      panRef.current.last = pos;
      return;
    }

    if (marquee) {
      setMarquee({ x: marquee.x, y: marquee.y, w: pos.x - marquee.x, h: pos.y - marquee.y });
      return;
    }

    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.kind === 'poly') return { ...prev, cursor: world };

      const { obj, start } = prev;
      if (obj.type === 'freehand') {
        const p = obj as PathObject;
        const next = [...p.points, { x: world.x - obj.x, y: world.y - obj.y }];
        return { ...prev, obj: { ...p, points: next } as TacticalObject };
      }
      if (obj.type === 'zone') {
        const z = obj as ZoneObject;
        if (z.zoneShape === 'rect') {
          const cx = (start.x + world.x) / 2;
          const cy = (start.y + world.y) / 2;
          return {
            ...prev,
            obj: { ...z, x: cx, y: cy, rx: Math.abs(world.x - start.x) / 2, ry: Math.abs(world.y - start.y) / 2 } as TacticalObject,
          };
        }
        const r = dist(start, world);
        return { ...prev, obj: { ...z, radius: r, valueKm: r / 1000 } as TacticalObject };
      }
      if (['rect', 'roundRect', 'ellipse', 'circle', 'arc'].includes(obj.type)) {
        const s = obj as ShapeObject;
        if (obj.type === 'circle' || obj.type === 'arc') {
          const r = dist(start, world);
          return { ...prev, obj: { ...s, x: start.x, y: start.y, rx: r, ry: r } as TacticalObject };
        }
        const cx = (start.x + world.x) / 2;
        const cy = (start.y + world.y) / 2;
        return {
          ...prev,
          obj: {
            ...s,
            x: cx,
            y: cy,
            rx: Math.abs(world.x - start.x) / 2,
            ry: Math.abs(world.y - start.y) / 2,
            cornerRadius: s.type === 'roundRect' ? Math.min(Math.abs(world.x - start.x), Math.abs(world.y - start.y)) * 0.12 : 0,
          } as TacticalObject,
        };
      }
      const p = obj as PathObject;
      return {
        ...prev,
        obj: { ...p, points: [{ x: 0, y: 0 }, { x: world.x - obj.x, y: world.y - obj.y }] } as TacticalObject,
      };
    });
  };

  const finishMarquee = () => {
    if (!marquee || !page) return setMarquee(null);
    const box = {
      x: Math.min(marquee.x, marquee.x + marquee.w),
      y: Math.min(marquee.y, marquee.y + marquee.h),
      width: Math.abs(marquee.w),
      height: Math.abs(marquee.h),
    };
    setMarquee(null);
    if (box.width < 3 && box.height < 3) return;

    const layer = contentRef.current;
    if (!layer) return;
    const hits: ID[] = [];
    for (const node of layer.find('.object')) {
      const id = node.id();
      if (!id) continue;
      const r = node.getClientRect();
      const intersects =
        r.x < box.x + box.width && r.x + r.width > box.x && r.y < box.y + box.height && r.y + r.height > box.y;
      if (intersects) hits.push(id);
    }
    useStore.getState().select(hits);
  };

  const commitDraft = () => {
    const current = draft;
    setDraft(null);
    if (!current) return;

    if (current.kind === 'shape') {
      const obj = current.obj;
      // Reject accidental click-sized objects.
      if (obj.type === 'zone') {
        const z = obj as ZoneObject;
        if (z.zoneShape === 'rect' ? (z.rx ?? 0) < 50 : (z.radius ?? 0) < 100) return;
      } else if ('rx' in obj && (obj as ShapeObject).rx < 50) {
        return;
      } else if ('points' in obj) {
        const p = obj as PathObject;
        if (p.type === 'freehand') {
          const simplified = simplifyPath(p.points, Math.max(30, 4 / camera.scale));
          if (simplified.length < 2) return;
          useStore.getState().addObjects([{ ...p, points: simplified } as TacticalObject]);
          return;
        }
        if (p.points.length < 2 || dist(p.points[0], p.points[1]) < 60) return;
      }
      useStore.getState().addObjects([obj]);
    }
  };

  const finishPolygon = () => {
    const current = draft;
    setDraft(null);
    if (!current || current.kind !== 'poly' || current.points.length < 3) return;
    const origin = current.points[0];
    const rel = current.points.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
    if (current.obj.type === 'zone') {
      useStore.getState().addObjects([{ ...(current.obj as ZoneObject), x: origin.x, y: origin.y, points: rel } as TacticalObject]);
    } else {
      useStore.getState().addObjects([{ ...(current.obj as PathObject), x: origin.x, y: origin.y, points: rel } as TacticalObject]);
    }
  };

  const onMouseUp = () => {
    if (panRef.current?.active) {
      panRef.current = null;
      return;
    }
    if (marquee) {
      finishMarquee();
      return;
    }
    if (draft?.kind === 'shape') commitDraft();
  };

  const onDblClick = (e: KonvaEventObject<MouseEvent>) => {
    if (draft?.kind === 'poly') {
      finishPolygon();
      return;
    }
    const id = e.target.findAncestor('.object', true)?.id() ?? e.target.id();
    const obj = page?.objects.find((o) => o.id === id);
    if (obj && (obj.type === 'text' || obj.type === 'number')) {
      setEditingText({ id: obj.id, value: (obj as TextObject).text });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Object selection & dragging                                         */
  /* ------------------------------------------------------------------ */

  const onNodeClick = (e: KonvaEventObject<MouseEvent>) => {
    if (tool !== 'select' && tool !== 'marquee' && tool !== 'route') return;
    const node = e.target.findAncestor('.object', true) ?? e.target;
    const id = node.id();
    if (!id) return;
    e.cancelBubble = true;
    if (e.evt.shiftKey || e.evt.ctrlKey) useStore.getState().toggleSelect(id);
    else useStore.getState().select([id]);
  };

  const onDragStart = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target;
    if (node.name() === 'waypoint') {
      useStore.getState().pushHistory();
      return;
    }
    const id = node.id();
    if (!id) return;
    if (!selection.includes(id)) useStore.getState().select([id]);
    useStore.getState().pushHistory();
    dragRef.current = {
      last: { x: node.x(), y: node.y() },
      ids: (selection.includes(id) ? selection : [id]).filter((x) => x !== id),
    };
  };

  const onDragMove = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target;
    if (snapOn && node.name() !== 'waypoint') {
      node.x(Math.round(node.x() / snapStep) * snapStep);
      node.y(Math.round(node.y() / snapStep) * snapStep);
    }
    const state = dragRef.current;
    if (!state || node.name() === 'waypoint') return;
    // Move the rest of the selection by the same delta, imperatively, so a
    // multi-object drag stays smooth without a store write per frame.
    const dx = node.x() - state.last.x;
    const dy = node.y() - state.last.y;
    if (!dx && !dy) return;
    const layer = contentRef.current;
    if (layer) {
      for (const id of state.ids) {
        const other = layer.findOne(`#${id}`);
        if (other) other.position({ x: other.x() + dx, y: other.y() + dy });
      }
    }
    state.last = { x: node.x(), y: node.y() };
  };

  const onDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const store = useStore.getState();

    if (node.name() === 'waypoint') {
      const [, objectId, wpId] = node.id().split(':');
      store.updateWaypoint(objectId, wpId, { x: node.x(), y: node.y() }, { history: false });
      dragRef.current = null;
      return;
    }

    const id = node.id();
    const state = dragRef.current;
    dragRef.current = null;
    if (!id || !page) return;

    const moved = page.objects.find((o) => o.id === id);
    if (!moved) return;
    const dx = node.x() - moved.x;
    const dy = node.y() - moved.y;

    const patches: { id: ID; x: number; y: number }[] = [{ id, x: node.x(), y: node.y() }];
    for (const otherId of state?.ids ?? []) {
      const other = page.objects.find((o) => o.id === otherId);
      if (other) patches.push({ id: otherId, x: other.x + dx, y: other.y + dy });
    }

    // Single commit for the whole gesture; history was pushed on drag start.
    store.moveObjectsTo(patches);
  };

  /* ------------------------------------------------------------------ */
  /* Transformer                                                         */
  /* ------------------------------------------------------------------ */

  const resizableTypes = new Set(['rect', 'roundRect', 'circle', 'ellipse', 'arc', 'zone', 'text']);

  useEffect(() => {
    const tr = trRef.current;
    const layer = contentRef.current;
    if (!tr || !layer) return;
    if (tool !== 'select' || !selection.length || editingText) {
      tr.nodes([]);
      return;
    }
    const nodes = selection
      .map((id) => layer.findOne(`#${id}`))
      .filter((n): n is Konva.Node => !!n && n.isVisible());
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selection, tool, editingText, page?.objects]);

  const selectedObjects = useMemo(
    () => (page?.objects ?? []).filter((o) => selection.includes(o.id)),
    [page?.objects, selection],
  );
  const allowResize =
    selectedObjects.length > 0 && selectedObjects.every((o) => resizableTypes.has(o.type));

  const onTransformEnd = () => {
    const layer = contentRef.current;
    if (!layer || !page) return;
    useStore.getState().pushHistory();

    for (const id of selection) {
      const node = layer.findOne(`#${id}`);
      const obj = page.objects.find((o) => o.id === id);
      if (!node || !obj) continue;
      const sx = node.scaleX();
      const sy = node.scaleY();
      const patch: Record<string, unknown> = {
        x: node.x(),
        y: node.y(),
        rotation: Math.round(node.rotation() * 10) / 10,
      };

      if (sx !== 1 || sy !== 1) {
        const avg = (Math.abs(sx) + Math.abs(sy)) / 2;
        if (obj.type === 'circle' || obj.type === 'arc') {
          patch.rx = (obj as ShapeObject).rx * avg;
          patch.ry = patch.rx;
        } else if (obj.type === 'rect' || obj.type === 'roundRect' || obj.type === 'ellipse') {
          patch.rx = (obj as ShapeObject).rx * Math.abs(sx);
          patch.ry = (obj as ShapeObject).ry * Math.abs(sy);
        } else if (obj.type === 'zone') {
          const z = obj as ZoneObject;
          if (z.zoneShape === 'rect') {
            patch.rx = (z.rx ?? 0) * Math.abs(sx);
            patch.ry = (z.ry ?? 0) * Math.abs(sy);
          } else if (z.zoneShape === 'polygon') {
            patch.points = (z.points ?? []).map((p) => ({ x: p.x * sx, y: p.y * sy }));
          } else {
            patch.radius = (z.radius ?? 0) * avg;
            patch.valueKm = ((z.radius ?? 0) * avg) / 1000;
          }
        } else if (obj.type === 'text' || obj.type === 'number') {
          patch.fontSize = Math.max(20, (obj as TextObject).fontSize * avg);
        }
      }
      node.scale({ x: 1, y: 1 });
      useStore.getState().updateObject(id, patch as Partial<TacticalObject>, { history: false });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Context menu / drop / text editing                                  */
  /* ------------------------------------------------------------------ */

  const onContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const node = e.target.findAncestor('.object', true) ?? e.target;
    const id = node.id() || null;
    if (id && !selection.includes(id)) useStore.getState().select([id]);
    setMenu({ x: pos.x, y: pos.y, world: toWorld(pos), objectId: id });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const shipId = e.dataTransfer.getData('application/x-wows-ship');
    const teamId = e.dataTransfer.getData('application/x-wows-team');
    if (!shipId) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = snap(toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }));
    useStore.getState().placeShip(shipId, world, teamId || undefined);
  };

  const commitTextEdit = () => {
    if (!editingText) return;
    const value = editingText.value.trim();
    if (!value) useStore.getState().removeObjects([editingText.id]);
    else useStore.getState().updateObject(editingText.id, { text: value } as Partial<TacticalObject>);
    setEditingText(null);
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  if (!page || !project) {
    return <div className="canvas-empty" ref={containerRef} />;
  }

  const ex = exportOpts;
  const show = {
    background: ex ? ex.background : true,
    grid: ex ? ex.grid : true,
    ships: ex ? ex.ships : true,
    routes: ex ? ex.routes : true,
    ranges: ex ? ex.ranges : true,
    zones: ex ? ex.zones : true,
    pings: ex ? ex.pings : true,
    shapes: ex ? ex.shapes : true,
    text: ex ? ex.text : true,
  };

  const gridLayer = page.layers.find((l) => l.id === LAYER_IDS.grid);
  const shipObjects = page.objects.filter((o): o is ShipObject => o.type === 'ship');
  const layerById = new Map(page.layers.map((l) => [l.id, l]));

  const categoryOf = (o: TacticalObject): keyof typeof show => {
    if (o.type === 'ship') return 'ships';
    if (o.type === 'zone') return 'zones';
    if (o.type === 'ping') return 'pings';
    if (o.type === 'text' || o.type === 'number') return 'text';
    return 'shapes';
  };

  const isVisible = (o: TacticalObject): boolean => {
    const layer = layerById.get(o.layerId);
    if (layer && !layer.visible) return false;
    if (!o.visible) return false;
    if (!show[categoryOf(o)]) return false;
    if (o.type === 'ship') {
      const team = (o as ShipObject).teamId ? teamById.get((o as ShipObject).teamId as string) : undefined;
      if (team && !team.visible) return false;
    }
    return true;
  };

  const isDraggable = (o: TacticalObject): boolean => {
    if (tool !== 'select' && tool !== 'route') return false;
    if (o.locked || exportOpts) return false;
    const layer = layerById.get(o.layerId);
    if (layer?.locked) return false;
    if (o.type === 'ship') {
      const team = (o as ShipObject).teamId ? teamById.get((o as ShipObject).teamId as string) : undefined;
      if (team?.locked) return false;
    }
    return true;
  };

  const renderObject = (o: TacticalObject) => {
    if (!isVisible(o)) return null;
    if (o.type === 'ship') {
      const ship = (o as ShipObject).shipId ? shipById.get((o as ShipObject).shipId as string) : undefined;
      const iconAsset = ship?.iconId ? iconById.get(ship.iconId) : undefined;
      return (
        <ShipWithIcon
          key={o.id}
          obj={o as ShipObject}
          ship={ship}
          team={(o as ShipObject).teamId ? teamById.get((o as ShipObject).teamId as string) : undefined}
          flags={effectiveFlags(page, o as ShipObject)}
          iconFile={iconAsset?.file}
          iconMime={iconAsset?.mime}
          inv={inv}
          baseSize={iconSize}
          selected={selection.includes(o.id)}
          draggable={isDraggable(o)}
        />
      );
    }
    return <ObjectNode key={o.id} obj={o} inv={inv} selected={selection.includes(o.id)} draggable={isDraggable(o)} />;
  };

  const cursorClass =
    tool === 'pan' || spacePan ? 'grab' : tool === 'select' || tool === 'marquee' ? 'default' : 'cross';

  return (
    <div
      className={`canvas-host cursor-${cursorClass}`}
      ref={containerRef}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={camera.x}
        y={camera.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDblClick={onDblClick}
        onClick={onNodeClick}
        onContextMenu={onContextMenu}
      >
        {/* Background: map image, grid, coordinates */}
        <Layer listening={false} visible={show.background || show.grid}>
          <MapBackground
            map={map}
            view={{
              ...page.mapView,
              showGrid: page.mapView.showGrid && (gridLayer?.visible ?? true) && show.grid,
              showCoordinates: page.mapView.showCoordinates && (gridLayer?.visible ?? true) && show.grid,
              mapOpacity: show.background ? page.mapView.mapOpacity : 0,
            }}
            image={mapImage}
            fallbackWidth={FALLBACK_W}
            fallbackHeight={FALLBACK_H}
          />
        </Layer>

        {/* Content: one Konva group per tactical layer, back to front */}
        <Layer
          ref={contentRef}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        >
          {/* Invisible backdrop that catches clicks on empty water */}
          <Rect name="backdrop" x={-worldW} y={-worldH} width={worldW * 3} height={worldH * 3} />

          {page.layers.map((layer) => {
            if (!layer.visible) return null;

            if (layer.id === LAYER_IDS.ranges) {
              if (!show.ranges) return null;
              return (
                <Group key={layer.id} opacity={layer.opacity} listening={false}>
                  {shipObjects.filter(isVisible).map((s) => (
                    <ShipRanges
                      key={s.id}
                      obj={s}
                      ship={s.shipId ? shipById.get(s.shipId) : undefined}
                      page={page}
                      flags={effectiveFlags(page, s)}
                      inv={inv}
                    />
                  ))}
                </Group>
              );
            }

            if (layer.id === LAYER_IDS.routes) {
              if (!show.routes) return null;
              return (
                <Group key={layer.id} opacity={layer.opacity} listening={false}>
                  {shipObjects
                    .filter((s) => isVisible(s) && effectiveFlags(page, s).route !== false)
                    .map((s) => (
                      <ShipRoute
                        key={s.id}
                        obj={s}
                        team={s.teamId ? teamById.get(s.teamId) : undefined}
                        inv={inv}
                        editable={selection.includes(s.id)}
                        showSpeeds
                      />
                    ))}
                </Group>
              );
            }

            const objects = page.objects.filter((o) => o.layerId === layer.id);
            if (!objects.length) return null;
            return (
              <Group key={layer.id} opacity={layer.opacity}>
                {objects.map(renderObject)}
              </Group>
            );
          })}
        </Layer>

        {/* Overlay: drafts, marquee, handles — never part of an export */}
        <Layer visible={!exportOpts}>
          {draft?.kind === 'shape' && (
            <ObjectNode obj={draft.obj} inv={inv} selected draggable={false} />
          )}
          {draft?.kind === 'poly' && (
            <Group listening={false}>
              <Line
                points={flatten([...draft.points, draft.cursor])}
                stroke="#4ea3ff"
                strokeWidth={2 * inv}
                dash={[8 * inv, 6 * inv]}
                closed={false}
              />
              {draft.points.map((p, i) => (
                <Rect
                  key={i}
                  x={p.x - 4 * inv}
                  y={p.y - 4 * inv}
                  width={8 * inv}
                  height={8 * inv}
                  fill="#4ea3ff"
                />
              ))}
              <Group x={draft.cursor.x} y={draft.cursor.y} scaleX={inv} scaleY={inv}>
                <Text
                  text={`${draft.points.length} pts · double-click to finish`}
                  x={10}
                  y={-6}
                  fontSize={11}
                  fill="#9fb4c8"
                  fontFamily="Inter, sans-serif"
                />
              </Group>
            </Group>
          )}

          {selection.length === 1 &&
            shipObjects
              .filter((s) => s.id === selection[0] && tool === 'route')
              .map((s) => <RouteHandles key={s.id} obj={s} inv={inv} />)}

          <Transformer
            ref={trRef}
            rotateEnabled={tool === 'select'}
            resizeEnabled={allowResize}
            keepRatio={false}
            rotationSnaps={[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345]}
            rotationSnapTolerance={4}
            anchorSize={8}
            anchorStroke="#4ea3ff"
            anchorFill="#0d1117"
            anchorCornerRadius={2}
            borderStroke="#4ea3ff"
            borderDash={[4, 3]}
            onTransformEnd={onTransformEnd}
            onDragEnd={onTransformEnd}
          />
        </Layer>
      </Stage>

      {/* Marquee is drawn in the DOM so it stays crisp regardless of zoom */}
      {marquee && (
        <div
          className="marquee"
          style={{
            left: Math.min(marquee.x, marquee.x + marquee.w),
            top: Math.min(marquee.y, marquee.y + marquee.h),
            width: Math.abs(marquee.w),
            height: Math.abs(marquee.h),
          }}
        />
      )}

      {editingText && (
        <TextEditor
          value={editingText.value}
          screen={(() => {
            const obj = page.objects.find((o) => o.id === editingText.id);
            return obj ? toScreen({ x: obj.x, y: obj.y }) : { x: 0, y: 0 };
          })()}
          onChange={(value) => setEditingText({ ...editingText, value })}
          onCommit={commitTextEdit}
          onCancel={() => {
            const obj = page.objects.find((o) => o.id === editingText.id) as TextObject | undefined;
            if (obj && !obj.text) useStore.getState().removeObjects([editingText.id]);
            setEditingText(null);
          }}
        />
      )}

      {menu && (
        <CanvasContextMenu
          state={menu}
          onClose={() => setMenu(null)}
        />
      )}

      <div className="canvas-readout">
        <span className="mono">
          {gridRef(cursorWorld.x, cursorWorld.y, worldW, worldH, page.mapView.gridCols ?? map?.gridCols ?? 10, page.mapView.gridRows ?? map?.gridRows ?? 10)}
        </span>
        <span className="mono dim">
          {(cursorWorld.x / 1000).toFixed(2)} , {(cursorWorld.y / 1000).toFixed(2)} km
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Resolves the ship's icon asset before handing it to the Konva node. */
function ShipWithIcon(props: {
  obj: ShipObject;
  ship?: Ship;
  team?: Team;
  flags: CharacteristicFlags;
  iconFile?: string;
  iconMime?: string;
  inv: number;
  baseSize: number;
  selected: boolean;
  draggable: boolean;
}) {
  const { iconFile, iconMime, ...rest } = props;
  const icon = useAsset('icon', iconFile, iconMime ?? '');
  return <ShipNode {...rest} icon={icon} />;
}

function TextEditor({
  value,
  screen,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  screen: Vec2;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      className="canvas-text-editor"
      style={{ left: screen.x, top: screen.y }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit();
        }
      }}
      placeholder="Type…"
      spellCheck={false}
    />
  );
}

function CanvasContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const selection = useStore((s) => s.selection);
  const clipboard = useStore((s) => s.clipboard);
  const page = useStore(getActivePage);
  const has = selection.length > 0;

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  const item = (label: string, action: () => void, enabled = true, shortcut?: string) => (
    <button
      className="ctx-item"
      disabled={!enabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        action();
        onClose();
      }}
    >
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );

  const locked = page?.objects.filter((o) => selection.includes(o.id)).every((o) => o.locked) ?? false;

  return (
    <div className="ctx-menu" style={{ left: state.x, top: state.y }} onContextMenu={(e) => e.preventDefault()}>
      {item('Copy', () => useStore.getState().copySelection(), has, 'Ctrl+C')}
      {item('Paste here', () => useStore.getState().paste(state.world), clipboard.length > 0, 'Ctrl+V')}
      {item('Duplicate', () => useStore.getState().duplicateSelection(), has, 'Ctrl+D')}
      <div className="ctx-sep" />
      {item('Bring to front', () => selection.forEach((id) => useStore.getState().reorderObject(id, 'front')), has)}
      {item('Send to back', () => selection.forEach((id) => useStore.getState().reorderObject(id, 'back')), has)}
      <div className="ctx-sep" />
      {item(
        locked ? 'Unlock' : 'Lock',
        () => useStore.getState().updateObjects(selection, { locked: !locked } as Partial<TacticalObject>),
        has,
      )}
      {item('Delete', () => useStore.getState().deleteSelection(), has, 'Del')}
    </div>
  );
}
