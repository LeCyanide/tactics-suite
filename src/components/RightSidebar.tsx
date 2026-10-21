import { useMemo, useRef, useState } from 'react';
import { ChevronRight, Database, Lock, LockOpen, Palette, Radar as RadarIcon, RotateCcw, Save, Search, Trash2 } from 'lucide-react';
import {
  CHARACTERISTICS,
  SHIP_CLASSES,
  shipClassCode,
  DEFAULT_RANGE_STYLES,
  RANGE_KEYS,
  SHIP_CLASS_LABEL,
  type CharacteristicKey,
  type MarkerObject,
  type PathObject,
  type ShapeObject,
  type ID,
  type ShipClass,
  type ShipObject,
  type TacticalObject,
  type TextObject,
} from '@/types/model';
import {
  ARROW_TOOLS,
  ARROW_TOOL_LABELS,
  SHAPE_TOOLS,
  SHAPE_TOOL_LABELS,
  effectiveFlags,
  getActivePage,
  getRulesets,
  shipRangeKm,
  useStore,
  type ArrowTool,
  type ShapeTool,
  type ToolId,
} from '@/state/store';
import { Check, ColorInput, Field, NumInput, Panel, Slider, Tip } from './common/ui';
import { CLASS_COLORS } from '@/canvas/shipGlyphs';
import { useAsset } from '@/state/assets';
import { canvasApi } from '@/canvas/canvasBridge';
import { ClassIcon } from './common/ClassIcon';
import { ReplayOverlayPanel } from './ReplayOverlayPanel';
import { gridRef } from '@/lib/util';
import { filterShips, limitUse, type Availability } from '@/lib/shipFilters';

export function RightSidebar() {
  const open = useStore((s) => s.rightOpen);
  const width = useStore((s) => s.settings.rightSidebarWidth);
  const patchSettings = useStore((s) => s.patchSettings);
  const selection = useStore((s) => s.selection);
  const page = useStore(getActivePage);
  const resizing = useRef(false);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const move = (ev: MouseEvent) => {
      if (!resizing.current) return;
      patchSettings({ rightSidebarWidth: Math.max(230, Math.min(480, window.innerWidth - ev.clientX - 40)) });
    };
    const up = () => {
      resizing.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!open) return null;

  const selected = page?.objects.filter((o) => selection.includes(o.id)) ?? [];

  return (
    <div className="sidebar right" style={{ width }}>
      <div className="sidebar-resizer" onMouseDown={startResize} />
      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        {selected.length === 0 && <NoSelectionPanels />}
        {selected.length === 1 && <SingleObjectPanels obj={selected[0]} />}
        {selected.length > 1 && <MultiSelectionPanel objects={selected} />}
        <ToolVariantPanel />
        <ReplayOverlayPanel />
        <ShipBrowserPanel />
      </div>
    </div>
  );
}

/* ================================================================== */
/* Nothing selected — tool settings                                    */
/* ================================================================== */

function NoSelectionPanels() {
  const page = useStore(getActivePage);
  if (!page) return null;

  return <ToolDefaultsPanel />;
}

/**
 * Style controls for one range circle of one ship.
 *
 * A range belongs to the ship that
 * projects it, so its colour and weight are stored as an override on that
 * ship's object, layered over the built-in default.
 */
function ShipRangeStyleEditor({ obj, rangeKey }: { obj: ShipObject; rangeKey: CharacteristicKey }) {
  const s = () => useStore.getState();
  const style = { ...DEFAULT_RANGE_STYLES[rangeKey], ...(obj.rangeStyles?.[rangeKey] ?? {}) };
  if (!DEFAULT_RANGE_STYLES[rangeKey]) return null;

  const patch = (p: Partial<typeof style>) =>
    s().updateObject(obj.id, {
      rangeStyles: { ...(obj.rangeStyles ?? {}), [rangeKey]: { ...style, ...p } },
    } as Partial<TacticalObject>);

  return (
    <div style={{ margin: '2px 0 6px 20px', paddingLeft: 8, borderLeft: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
        <ColorInput value={style.color} onChange={(v) => patch({ color: v })} />
        <NumInput value={style.lineWidth} min={0.5} max={8} step={0.5} onChange={(v) => patch({ lineWidth: v })} width={54} />
        <Tip label="Dashed" side="bottom">
          <button className={`icon-btn${style.dashed ? ' active' : ''}`} onClick={() => patch({ dashed: !style.dashed })}>
            ⋯
          </button>
        </Tip>
        <Tip label="Fill" side="bottom">
          <button className={`icon-btn${style.fill ? ' active' : ''}`} onClick={() => patch({ fill: !style.fill })}>
            <Palette size={12} />
          </button>
        </Tip>
      </div>
      <Field label="Opacity">
        <Slider value={style.opacity} onChange={(v) => patch({ opacity: v })} />
      </Field>
      {style.fill && (
        <Field label="Fill">
          <Slider value={style.fillOpacity} max={0.6} onChange={(v) => patch({ fillOpacity: v })} />
        </Field>
      )}
      <Check label="Show label" checked={style.showLabel} onChange={(v) => patch({ showLabel: v })} />
    </div>
  );
}

function ToolDefaultsPanel() {
  const options = useStore((s) => s.toolOptions);
  const s = () => useStore.getState();
  const stroke = options.stroke;

  return (
    <Panel title="Drawing defaults" storageKey="toolDefaults">
      <Field label="Colour">
        <ColorInput value={stroke.color} onChange={(v) => s().patchToolOptions({ stroke: { ...stroke, color: v } })} />
        <select
          value={stroke.dash}
          onChange={(e) => s().patchToolOptions({ stroke: { ...stroke, dash: e.target.value as typeof stroke.dash } })}
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </Field>
      <Field label="Width">
        <NumInput value={stroke.width} min={0.5} max={20} step={0.5} onChange={(v) => s().patchToolOptions({ stroke: { ...stroke, width: v } })} suffix="px" />
      </Field>
      <Field label="Fill">
        <input
          type="checkbox"
          checked={!!stroke.fill}
          onChange={(e) => s().patchToolOptions({ stroke: { ...stroke, fill: e.target.checked ? stroke.color : null } })}
          style={{ width: 13, height: 13, flex: 'none' }}
        />
        {stroke.fill && <ColorInput value={stroke.fill} onChange={(v) => s().patchToolOptions({ stroke: { ...stroke, fill: v } })} />}
        {stroke.fill && (
          <Slider value={stroke.fillOpacity} max={0.8} onChange={(v) => s().patchToolOptions({ stroke: { ...stroke, fillOpacity: v } })} />
        )}
      </Field>
      <Field label="Font size">
        <NumInput value={options.fontSize} min={40} max={4000} step={20} onChange={(v) => s().patchToolOptions({ fontSize: v })} />
      </Field>
      <Field label="Arrowhead">
        <NumInput value={options.arrowSize} min={4} max={48} step={1} onChange={(v) => s().patchToolOptions({ arrowSize: v })} suffix="px" />
      </Field>
      <Field label="Next number">
        <NumInput value={options.numberCounter} min={1} step={1} onChange={(v) => s().patchToolOptions({ numberCounter: Math.round(v) })} />
      </Field>
    </Panel>
  );
}

/**
 * Which shape or arrow the grouped rail button draws.
 *
 * The rail carries one button per family; the choice of variant lives here,
 * where there is room to show every option with its name.
 */
function ToolVariantPanel() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const patch = useStore((s) => s.patchToolOptions);

  const isShape = (SHAPE_TOOLS as readonly string[]).includes(tool);
  const isArrow = (ARROW_TOOLS as readonly string[]).includes(tool);
  if (!isShape && !isArrow) return null;

  const variants: readonly string[] = isShape ? SHAPE_TOOLS : ARROW_TOOLS;
  const labels = isShape ? SHAPE_TOOL_LABELS : ARROW_TOOL_LABELS;

  return (
    <Panel title={isShape ? 'Shape' : 'Line & arrow'} storageKey="toolVariant">
      <div className="variant-grid">
        {variants.map((v) => (
          <button
            key={v}
            className={`variant-chip${tool === v ? ' active' : ''}`}
            onClick={() => {
              if (isShape) patch({ shapeVariant: v as ShapeTool });
              else patch({ arrowVariant: v as ArrowTool });
              setTool(v as ToolId);
            }}
          >
            {labels[v as keyof typeof labels]}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function SingleObjectPanels({ obj }: { obj: TacticalObject }) {
  if (obj.type === 'ship') return <ShipPropertiesPanels obj={obj as ShipObject} />;
  return (
    <>
      <CommonObjectPanel obj={obj} />
      {['freehand', 'line', 'arrow', 'doubleArrow', 'curvedArrow', 'polygon', 'ruler', 'area'].includes(obj.type) && (
        <PathPropertiesPanel obj={obj as PathObject} />
      )}
      {['rect', 'roundRect', 'circle'].includes(obj.type) && <ShapePropertiesPanel obj={obj as ShapeObject} />}
      {(obj.type === 'text' || obj.type === 'number') && <TextPropertiesPanel obj={obj as TextObject} />}
      {obj.type === 'marker' && <MarkerPropertiesPanel obj={obj as MarkerObject} />}
    </>
  );
}

const TYPE_LABEL: Record<string, string> = {
  freehand: 'Freehand', line: 'Line', arrow: 'Arrow', doubleArrow: 'Double arrow', curvedArrow: 'Curved arrow',
  polygon: 'Polygon', ruler: 'Ruler', area: 'Area', rect: 'Rectangle', roundRect: 'Rounded rectangle',
  circle: 'Circle', text: 'Text', number: 'Number', marker: 'Marker',
};

function CommonObjectPanel({ obj }: { obj: TacticalObject }) {
  const page = useStore(getActivePage);
  const s = () => useStore.getState();
  if (!page) return null;
  const update = (patch: Partial<TacticalObject>) => s().updateObject(obj.id, patch);

  return (
    <Panel title={TYPE_LABEL[obj.type] ?? obj.type} storageKey="objCommon">
      <Field label="Layer">
        <select value={obj.layerId} onChange={(e) => update({ layerId: e.target.value } as Partial<TacticalObject>)}>
          {page.layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Position">
        <NumInput value={obj.x / 1000} step={0.1} onChange={(v) => update({ x: v * 1000 })} suffix="km" />
        <NumInput value={obj.y / 1000} step={0.1} onChange={(v) => update({ y: v * 1000 })} suffix="km" />
      </Field>
      <Field label="Rotation">
        <NumInput value={obj.rotation} step={1} onChange={(v) => update({ rotation: v })} suffix="°" />
      </Field>
      <Field label="Opacity">
        <Slider value={obj.opacity} onChange={(v) => update({ opacity: v })} />
      </Field>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button className="btn sm" style={{ flex: 1 }} onClick={() => update({ locked: !obj.locked })}>
          {obj.locked ? 'Unlock' : 'Lock'}
        </button>
        <button className="btn sm" style={{ flex: 1 }} onClick={() => s().duplicateSelection()}>
          Duplicate
        </button>
        <button className="btn sm danger" onClick={() => s().deleteSelection()}>
          <Trash2 size={12} />
        </button>
      </div>
    </Panel>
  );
}

function StrokeEditor({ obj }: { obj: PathObject | ShapeObject }) {
  const s = () => useStore.getState();
  const stroke = obj.stroke;
  const set = (patch: Partial<typeof stroke>) =>
    s().updateObject(obj.id, { stroke: { ...stroke, ...patch } } as Partial<TacticalObject>);

  return (
    <>
      <Field label="Colour">
        <ColorInput value={stroke.color} onChange={(v) => set({ color: v })} />
        <select value={stroke.dash} onChange={(e) => set({ dash: e.target.value as typeof stroke.dash })}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </Field>
      <Field label="Width">
        <NumInput value={stroke.width} min={0.5} max={20} step={0.5} onChange={(v) => set({ width: v })} suffix="px" />
      </Field>
      <Field label="Fill">
        <input
          type="checkbox"
          checked={!!stroke.fill}
          onChange={(e) => set({ fill: e.target.checked ? stroke.color : null })}
          style={{ width: 13, height: 13, flex: 'none' }}
        />
        {stroke.fill && <ColorInput value={stroke.fill} onChange={(v) => set({ fill: v })} />}
      </Field>
      {stroke.fill && (
        <Field label="Fill opacity">
          <Slider value={stroke.fillOpacity} max={0.9} onChange={(v) => set({ fillOpacity: v })} />
        </Field>
      )}
    </>
  );
}

function PathPropertiesPanel({ obj }: { obj: PathObject }) {
  const s = () => useStore.getState();
  const update = (patch: Partial<PathObject>) => s().updateObject(obj.id, patch as Partial<TacticalObject>);
  const isArrow = ['arrow', 'doubleArrow', 'curvedArrow', 'ruler'].includes(obj.type);

  return (
    <Panel title="Style" storageKey="pathStyle">
      <StrokeEditor obj={obj} />
      {isArrow && (
        <Field label="Arrowhead">
          <NumInput value={obj.arrowSize ?? 14} min={4} max={60} step={1} onChange={(v) => update({ arrowSize: v })} suffix="px" />
        </Field>
      )}
      {obj.type === 'curvedArrow' && (
        <Field label="Curvature">
          <Slider value={obj.curvature ?? 0.25} min={-0.8} max={0.8} step={0.02} onChange={(v) => update({ curvature: v })} format={(v) => v.toFixed(2)} />
        </Field>
      )}
      {['ruler', 'area'].includes(obj.type) && (
        <Check label="Show measurement" checked={obj.showMeasurement !== false} onChange={(v) => update({ showMeasurement: v })} />
      )}
      {['polygon', 'area', 'freehand'].includes(obj.type) && (
        <Check label="Closed shape" checked={!!obj.closed} onChange={(v) => update({ closed: v })} />
      )}
      <div className="faint mono" style={{ fontSize: 10.5, marginTop: 6 }}>
        {obj.points.length} points
      </div>
    </Panel>
  );
}

function ShapePropertiesPanel({ obj }: { obj: ShapeObject }) {
  const s = () => useStore.getState();
  const update = (patch: Partial<ShapeObject>) => s().updateObject(obj.id, patch as Partial<TacticalObject>);

  return (
    <Panel title="Style" storageKey="shapeStyle">
      <StrokeEditor obj={obj} />
      <Field label={obj.type === 'circle' ? 'Radius' : 'Width'}>
        <NumInput value={obj.rx / 1000} step={0.1} min={0.01} onChange={(v) => update({ rx: v * 1000 })} suffix="km" />
      </Field>
      {obj.type !== 'circle' && (
        <Field label="Height">
          <NumInput value={obj.ry / 1000} step={0.1} min={0.01} onChange={(v) => update({ ry: v * 1000 })} suffix="km" />
        </Field>
      )}
      {obj.type === 'roundRect' && (
        <Field label="Corner">
          <NumInput value={(obj.cornerRadius ?? 0) / 1000} step={0.05} min={0} onChange={(v) => update({ cornerRadius: v * 1000 })} suffix="km" />
        </Field>
      )}
    </Panel>
  );
}

function TextPropertiesPanel({ obj }: { obj: TextObject }) {
  const s = () => useStore.getState();
  const update = (patch: Partial<TextObject>) => s().updateObject(obj.id, patch as Partial<TacticalObject>);

  return (
    <Panel title="Text" storageKey="textStyle">
      <textarea value={obj.text} rows={3} onChange={(e) => update({ text: e.target.value })} />
      <Field label="Size">
        <NumInput value={obj.fontSize} min={20} step={20} onChange={(v) => update({ fontSize: v })} />
      </Field>
      <Field label="Colour">
        <ColorInput value={obj.color} onChange={(v) => update({ color: v })} />
        <button className={`btn sm${obj.bold ? ' primary' : ''}`} onClick={() => update({ bold: !obj.bold })}>
          B
        </button>
        <button className={`btn sm${obj.italic ? ' primary' : ''}`} onClick={() => update({ italic: !obj.italic })}>
          <em>I</em>
        </button>
      </Field>
      <Field label="Align">
        <select value={obj.align} onChange={(e) => update({ align: e.target.value as TextObject['align'] })}>
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
        </select>
      </Field>
      <Field label="Background">
        <input
          type="checkbox"
          checked={!!obj.background}
          onChange={(e) => update({ background: e.target.checked ? '#0d1117' : null })}
          style={{ width: 13, height: 13, flex: 'none' }}
        />
        {obj.background && <ColorInput value={obj.background} onChange={(v) => update({ background: v })} />}
      </Field>
    </Panel>
  );
}

function MarkerPropertiesPanel({ obj }: { obj: MarkerObject }) {
  const s = () => useStore.getState();
  const update = (patch: Partial<MarkerObject>) => s().updateObject(obj.id, patch as Partial<TacticalObject>);

  return (
    <Panel title="Marker" storageKey="markerStyle">
      <Field label="Shape">
        <select value={obj.shape} onChange={(e) => update({ shape: e.target.value as MarkerObject['shape'] })}>
          <option value="pin">Pin</option>
          <option value="cross">Cross</option>
          <option value="diamond">Diamond</option>
          <option value="star">Star</option>
          <option value="flag">Flag</option>
        </select>
      </Field>
      <Field label="Colour">
        <ColorInput value={obj.color} onChange={(v) => update({ color: v })} />
      </Field>
      <Field label="Size">
        <NumInput value={obj.size} min={8} max={80} onChange={(v) => update({ size: v })} suffix="px" />
      </Field>
      <Field label="Label">
        <input type="text" value={obj.label} onChange={(e) => update({ label: e.target.value })} />
      </Field>
    </Panel>
  );
}

/** Marker colour for a ship with no custom colour and no team. */
const NEUTRAL_ICON_COLOR = '#8b98a5';

function ShipPropertiesPanels({ obj }: { obj: ShipObject }) {
  const project = useStore((s) => s.project);
  const page = useStore(getActivePage);
  const ships = useStore((s) => s.ships);
  const maps = useStore((s) => s.maps);
  const s = () => useStore.getState();

  const ship = useMemo(() => ships.find((x) => x.id === obj.shipId), [ships, obj.shipId]);
  if (!page || !project) return null;

  const map = maps.find((m) => m.id === page.mapId);
  const team = project.teams.find((t) => t.id === obj.teamId);
  const flags = effectiveFlags(page, obj);
  const update = (patch: Partial<ShipObject>) => s().updateObject(obj.id, patch as Partial<TacticalObject>);

  const ref = gridRef(
    obj.x,
    obj.y,
    map?.widthMeters ?? 30000,
    map?.heightMeters ?? 30000,
    page.mapView.gridCols ?? map?.gridCols ?? 10,
    page.mapView.gridRows ?? map?.gridRows ?? 10,
  );

  return (
    <>
      <Panel
        title={obj.shipName}
        storageKey="shipMain"
        actions={
          <>
            <button
              className={`icon-btn${obj.locked ? ' active' : ''}`}
              title={obj.locked ? 'Unlock ship' : 'Lock ship'}
              onClick={() => update({ locked: !obj.locked })}
            >
              {obj.locked ? <Lock size={12} /> : <LockOpen size={12} />}
            </button>
            <button className="icon-btn danger" title="Delete ship" onClick={() => s().deleteSelection()}>
              <Trash2 size={12} />
            </button>
          </>
        }
      >
        <div className="faint mono" style={{ fontSize: 10.5, marginBottom: 6 }}>
          {SHIP_CLASS_LABEL[obj.shipClass]} · Tier {obj.tier} · {ship?.nation ?? 'Unknown'}
        </div>

        <Field label="Team">
          <select value={obj.teamId ?? ''} onChange={(e) => update({ teamId: e.target.value || null })}>
            <option value="">No team</option>
            {project.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <input
            type="text"
            placeholder={obj.shipName}
            value={obj.label ?? ''}
            onChange={(e) => update({ label: e.target.value || undefined })}
          />
        </Field>
        <Field label="Note">
          <input
            type="text"
            placeholder="Shown under the name"
            value={obj.note ?? ''}
            onChange={(e) => update({ note: e.target.value || undefined })}
          />
        </Field>
        <Field label="Position">
          <NumInput value={obj.x / 1000} step={0.1} onChange={(v) => update({ x: v * 1000 })} suffix="km" />
          <NumInput value={obj.y / 1000} step={0.1} onChange={(v) => update({ y: v * 1000 })} suffix="km" />
        </Field>
        <Field label="Grid">
          <span className="mono dim">{ref}</span>
        </Field>
        <Field label="Icon size">
          <Slider value={obj.iconScale} min={0.5} max={2.5} step={0.05} onChange={(v) => update({ iconScale: v })} format={(v) => `${v.toFixed(2)}x`} />
        </Field>
        <Field label="Icon colour">
          <ColorInput
            value={obj.iconColor ?? team?.color ?? NEUTRAL_ICON_COLOR}
            onChange={(v) => update({ iconColor: v })}
          />
          {(obj.opacity !== 1 || obj.iconColor) && (
            <button
              className="icon-btn"
              title="Reset to the team default: team colour, full opacity"
              onClick={() => update(STANDARD_LOOK)}
            >
              <RotateCcw size={13} />
            </button>
          )}
        </Field>
        <Field label="Opacity">
          <Slider value={obj.opacity} onChange={(v) => update({ opacity: v })} />
        </Field>
      </Panel>

      {/* Range rings, per ship --------------------------------------- */}
      <Panel
        title="Ranges"
        storageKey="shipRanges"
        actions={
          Object.keys(obj.display).length > 0 ? (
            <Tip label="Switch every range off" side="bottom">
              <button className="icon-btn" onClick={() => update({ display: {} })}>
                <RadarIcon size={12} />
              </button>
            </Tip>
          ) : undefined
        }
      >
        {CHARACTERISTICS.filter((c) => c.group === 'range').map((c) => {
          const km = shipRangeKm(ship, c.key);
          const on = flags[c.key] ?? false;
          return (
            <div key={c.key}>
              <ShipFlagCheck
                obj={obj}
                flagKey={c.key}
                label={
                  <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    {c.label}
                    <span className="mono faint" style={{ fontSize: 10 }}>
                      {km ? `${km.toFixed(1)} km` : 'n/a'}
                    </span>
                  </span>
                }
                value={on}
                disabledReason={km ? undefined : 'This ship has no value for that characteristic'}
              />
              {on && !!km && <ShipRangeStyleEditor obj={obj} rangeKey={c.key} />}
            </div>
          );
        })}
      </Panel>
    </>
  );
}

function ShipFlagCheck({
  obj,
  flagKey,
  label,
  value,
  disabledReason,
}: {
  obj: ShipObject;
  flagKey: CharacteristicKey;
  label: React.ReactNode;
  value: boolean;
  disabledReason?: string;
}) {
  const s = () => useStore.getState();
  // Ranges are set per ship and have no page default to differ from, so there
  // is nothing an override badge could mean here.
  return (
    <Check
      label={label}
      checked={value}
      title={disabledReason}
      onChange={(v) => s().setShipDisplay(obj.id, flagKey, v)}
    />
  );
}

/**
 * How a freshly placed ship looks: full opacity, in its team colour. Extracted
 * replay ships arrive faded (unspotted) or black (sunk); this puts them back.
 */
const STANDARD_LOOK = { opacity: 1, iconColor: undefined } as Partial<ShipObject>;

function MultiSelectionPanel({ objects }: { objects: TacticalObject[] }) {
  const page = useStore(getActivePage);
  const s = () => useStore.getState();
  const ids = objects.map((o) => o.id);
  const shipIds = objects.filter((o) => o.type === 'ship').map((o) => o.id);
  if (!page) return null;

  return (
    <Panel title={`${objects.length} objects selected`} storageKey="multi">
      <Field label="Layer">
        <select value="" onChange={(e) => e.target.value && s().assignLayer(ids, e.target.value)}>
          <option value="">Move to layer…</option>
          {page.layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Opacity">
        <Slider
          value={objects[0].opacity}
          onChange={(v) => s().updateObjects(ids, { opacity: v } as Partial<TacticalObject>)}
        />
      </Field>
      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => s().duplicateSelection()}>
          Duplicate
        </button>
        <button className="btn sm" onClick={() => s().copySelection()}>
          Copy
        </button>
        <button
          className="btn sm"
          onClick={() => s().updateObjects(ids, { locked: !objects[0].locked } as Partial<TacticalObject>)}
        >
          {objects[0].locked ? 'Unlock' : 'Lock'}
        </button>
        <button className="btn sm danger" onClick={() => s().deleteSelection()}>
          Delete
        </button>
      </div>
      {shipIds.length > 0 && (
        <Tip label="Full opacity and the team colour for every selected ship" side="bottom">
          <button
            className="btn sm"
            style={{ width: '100%', marginTop: 6 }}
            onClick={() => s().updateObjects(shipIds, STANDARD_LOOK as Partial<TacticalObject>)}
          >
            Standard look for {shipIds.length} ship{shipIds.length === 1 ? '' : 's'}
          </button>
        </Tip>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

/* ================================================================== */
/* Ship selector                                                       */
/* ================================================================== */

function ShipBrowserPanel() {
  const ships = useStore((s) => s.ships);
  const icons = useStore((s) => s.icons);
  const project = useStore((s) => s.project);
  const [query, setQuery] = useState('');
  const [nation, setNation] = useState('');
  const [cls, setCls] = useState<'' | ShipClass>('');
  const [tier, setTier] = useState('');
  const [radar, setRadar] = useState<Availability>('');
  const [smoke, setSmoke] = useState<Availability>('');
  const [team, setTeam] = useState<ID | ''>('');
  const rulesets = useStore(getRulesets);
  const s = () => useStore.getState();

  const nations = useMemo(() => [...new Set(ships.map((x) => x.nation))].sort(), [ships]);
  const tiers = useMemo(() => [...new Set(ships.map((x) => x.tier))].sort((a, b) => b - a), [ships]);
  // The ruleset is the page's: picking one here holds the page's lineup to it.
  const page = useStore(getActivePage);
  const ruleset = rulesets.find((r) => r.id === page?.rulesetId) ?? null;

  const filtered = useMemo(
    () => filterShips(ships, { query, searchNation: true, nation, cls, tier, radar, smoke, ruleset }),
    [ships, query, nation, cls, tier, radar, smoke, ruleset],
  );

  const teamId = team || project?.settings.defaultTeamId || project?.teams[0]?.id || null;
  const iconById = useMemo(() => new Map(icons.map((i) => [i.id, i])), [icons]);

  // What the side being placed for already has on the page, for the ruleset's
  // limits: "max two of these" is counted per team.
  const placed = useMemo(
    () =>
      (page?.objects ?? [])
        .filter((o): o is ShipObject => o.type === 'ship' && o.teamId === teamId)
        .map((o) => o.shipId),
    [page?.objects, teamId],
  );
  const teamFull = !!ruleset && ruleset.maxShips > 0 && placed.length >= ruleset.maxShips;

  return (
    <Panel
      title="Ships"
      count={`${filtered.length}/${ships.length}`}
      storageKey="ships"
      grow
      actions={
        <Tip label="Open ship database — add, edit and assign icons" side="bottom">
          <button className="icon-btn" onClick={() => s().openModal('shipDb')}>
            <Database size={13} />
          </button>
        </Tip>
      }
    >
      {ships.length === 0 ? (
        <div className="empty-note">
          No ships yet.
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <button className="btn sm block" onClick={() => void s().importShipData()}>
              Import ship data…
            </button>
            <button className="btn sm block ghost" onClick={() => void s().loadSampleShips()}>
              Load sample ships
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', marginBottom: 4 }}>
            <Search size={12} style={{ position: 'absolute', left: 7, top: 6, color: 'var(--fg-faint)' }} />
            <input
              type="search"
              placeholder="Search ships…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 24 }}
            />
          </div>

          <div className="ship-filters">
            <select value={nation} onChange={(e) => setNation(e.target.value)}>
              <option value="">Nation</option>
              {nations.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select value={cls} onChange={(e) => setCls(e.target.value as ShipClass | '')}>
              <option value="">Class</option>
              {SHIP_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">Tier</option>
              {tiers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select value={radar} onChange={(e) => setRadar(e.target.value as Availability)}>
              <option value="">Radar</option>
              <option value="yes">Has radar</option>
              <option value="no">No radar</option>
            </select>
            <select value={smoke} onChange={(e) => setSmoke(e.target.value as Availability)}>
              <option value="">Smoke</option>
              <option value="yes">Has smoke</option>
              <option value="no">No smoke</option>
            </select>
            <select
              value={ruleset?.id ?? ''}
              title="The ship restrictions this page is held to — add and edit them in the ship database"
              onChange={(e) => s().setPageRuleset(e.target.value || null)}
            >
              <option value="">Ruleset</option>
              {rulesets.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {project && project.teams.length > 0 && (
            <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ marginBottom: 5 }}>
              <option value="">Place on default team</option>
              {project.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  Place on {t.name}
                </option>
              ))}
            </select>
          )}

          {ruleset && ruleset.maxShips > 0 && (
            <div className={`team-count${placed.length >= ruleset.maxShips ? ' full' : ''}`}>
              <span>{project?.teams.find((t) => t.id === teamId)?.name ?? 'Team'}</span>
              <span className="mono">
                {placed.length}/{ruleset.maxShips} ships
              </span>
            </div>
          )}

          <div className="ship-list">
            {filtered.map((ship) => {
              const iconAsset = ship.iconId ? iconById.get(ship.iconId) : undefined;
              const use = ruleset ? limitUse(ruleset, ship.id, placed) : null;
              const full = teamFull || (!!use && use.used >= use.max);
              return (
                <div
                  key={ship.id}
                  className={`ship-item${full ? ' limit-full' : ''}`}
                  draggable
                  title={
                    teamFull
                      ? `${ruleset?.name}: this team already has its ${ruleset?.maxShips} ships`
                      : use && full
                        ? `${ruleset?.name}: this team already has ${use.used} of the ${use.max} allowed from this group`
                        : 'Drag onto the map, or double-click to place at the centre'
                  }
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-wows-ship', ship.id);
                    if (teamId) e.dataTransfer.setData('application/x-wows-team', teamId);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDoubleClick={() => {
                    const api = canvasApi();
                    if (!api) return;
                    const centre = api.screenToWorld({
                      x: (document.querySelector('.canvas-host')?.clientWidth ?? 800) / 2,
                      y: (document.querySelector('.canvas-host')?.clientHeight ?? 600) / 2,
                    });
                    s().placeShip(ship.id, centre, teamId);
                  }}
                >
                  <ShipThumb file={iconAsset?.file} mime={iconAsset?.mime} cls={ship.class} />
                  <div className="ship-meta">
                    <div className="ship-name">{ship.name}</div>
                    <div className="ship-sub">{ship.nation}</div>
                  </div>
                  {/* Before the class, so class and tier stay in line whether a row has a limit or not. */}
                  {use && (
                    <span className={`tier-chip limit-chip${use.used >= use.max ? ' full' : ''}`}>
                      {use.used}/{use.max}
                    </span>
                  )}
                  <span className="class-chip" style={{ background: `${CLASS_COLORS[ship.class]}22`, color: CLASS_COLORS[ship.class] }}>
                    {shipClassCode(ship)}
                  </span>
                  <span className="tier-chip">{ship.tier}</span>
                </div>
              );
            })}
            {!filtered.length && <div className="empty-note">No ships match those filters.</div>}
          </div>
        </>
      )}
    </Panel>
  );
}

function ShipThumb({ file, mime, cls }: { file?: string; mime?: string; cls: ShipClass }) {
  const img = useAsset('icon', file, mime ?? '');
  return (
    <div className="ship-icon">
      {img ? <img src={img.src} alt="" /> : <ClassIcon cls={cls} size={19} />}
    </div>
  );
}

export function GlyphIcon({ path, color, size = 14 }: { path: string; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export function RightRailToggle() {
  const open = useStore((s) => s.rightOpen);
  const toggle = useStore((s) => s.toggleRight);
  if (open) return null;
  return (
    <button className="rail-toggle right" onClick={toggle} title="Show properties (Ctrl+J)">
      <ChevronRight size={11} style={{ transform: 'rotate(180deg)' }} />
    </button>
  );
}
