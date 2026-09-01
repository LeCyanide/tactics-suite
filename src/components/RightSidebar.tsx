import { useMemo, useRef } from 'react';
import { ChevronRight, Palette, Radar as RadarIcon, Save, Trash2 } from 'lucide-react';
import {
  CHARACTERISTICS,
  DEFAULT_CHARACTERISTICS,
  DEFAULT_RANGE_STYLES,
  RANGE_KEYS,
  SHIP_CLASS_LABEL,
  type CharacteristicKey,
  type MarkerObject,
  type PathObject,
  type ShapeObject,
  type ShipObject,
  type TacticalObject,
  type TextObject,
} from '@/types/model';
import { effectiveFlags, getActivePage, shipRangeKm, useStore } from '@/state/store';
import { Check, ColorInput, Field, NumInput, Panel, SectionLabel, Slider, Tip } from './common/ui';
import { gridRef } from '@/lib/util';

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
      </div>
    </div>
  );
}

/* ================================================================== */
/* Nothing selected — page-level display defaults & tool settings      */
/* ================================================================== */

function NoSelectionPanels() {
  const page = useStore(getActivePage);
  const tool = useStore((s) => s.tool);
  if (!page) return null;

  return (
    <>
      <MapDisplayPanel />
      <ToolDefaultsPanel />
      <PresetsPanel />
    </>
  );
}

/**
 * Page-level characteristic defaults.
 *
 * These are the "global" toggles: they decide what every ship on the page
 * shows unless that ship overrides it. Everything is off by default, which is
 * what keeps a freshly-populated map clean.
 */
function MapDisplayPanel() {
  const page = useStore(getActivePage);
  const s = () => useStore.getState();
  if (!page) return null;

  return (
    <Panel title="Map Display" storageKey="mapDisplay">
      <SectionLabel>Labels</SectionLabel>
      {CHARACTERISTICS.filter((c) => c.group === 'label').map((c) => (
        <Check
          key={c.key}
          label={c.label}
          checked={page.display[c.key] ?? DEFAULT_CHARACTERISTICS[c.key] ?? false}
          onChange={(v) => s().setPageDisplay(c.key, v)}
        />
      ))}

      <SectionLabel>Other</SectionLabel>
      {CHARACTERISTICS.filter((c) => c.group === 'other').map((c) => (
        <Check
          key={c.key}
          label={c.label}
          checked={page.display[c.key] ?? DEFAULT_CHARACTERISTICS[c.key] ?? false}
          onChange={(v) => s().setPageDisplay(c.key, v)}
        />
      ))}

      <div className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.45 }}>
        Ranges are set per ship. Select a ship to switch its detection, radar,
        hydro, gun or torpedo circles on.
      </div>
    </Panel>
  );
}

/**
 * Style controls for one range circle of one ship.
 *
 * There is no page-level equivalent any more: a range belongs to the ship that
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
    <Panel title="Drawing Defaults" storageKey="toolDefaults">
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

function PresetsPanel() {
  const project = useStore((s) => s.project);
  const s = () => useStore.getState();
  if (!project) return null;

  return (
    <Panel title="Tactical Presets" count={project.presets.length} storageKey="presets">
      {project.presets.length === 0 ? (
        <div className="empty-note">
          Select an object and use <em>Save as preset</em> in its properties to keep a reusable copy here.
        </div>
      ) : (
        project.presets.map((preset) => (
          <div key={preset.id} className="row">
            <span className="row-label">{preset.name}</span>
            <span className="count mono">{preset.kind}</span>
            <div className="row-actions">
              <Tip label="Stamp at map centre" side="bottom">
                <button
                  className="icon-btn"
                  onClick={() => {
                    const page = getActivePage(useStore.getState());
                    if (!page) return;
                    const data = { ...(preset.data as Record<string, unknown>) };
                    s().addObjects([
                      {
                        ...(data as unknown as TacticalObject),
                        id: `obj-${Math.random().toString(36).slice(2)}`,
                      } as TacticalObject,
                    ]);
                  }}
                >
                  <ChevronRight size={12} />
                </button>
              </Tip>
              <button className="icon-btn danger" onClick={() => s().removePreset(preset.id)}>
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))
      )}
    </Panel>
  );
}

/* ================================================================== */
/* Single object                                                       */
/* ================================================================== */

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
  freehand: 'Freehand', line: 'Line', arrow: 'Arrow', doubleArrow: 'Double Arrow', curvedArrow: 'Curved Arrow',
  polygon: 'Polygon', ruler: 'Ruler', area: 'Area', rect: 'Rectangle', roundRect: 'Rounded Rectangle',
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
        <Tip label="Save as preset" side="bottom">
          <button
            className="btn sm"
            onClick={() =>
              s().savePreset({
                name: `${TYPE_LABEL[obj.type] ?? obj.type} preset`,
                kind: 'shape',
                data: { ...obj },
              })
            }
          >
            <Save size={12} />
          </button>
        </Tip>
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
          <option value="center">Center</option>
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

function ShipPropertiesPanels({ obj }: { obj: ShipObject }) {
  const project = useStore((s) => s.project);
  const page = useStore(getActivePage);
  const ships = useStore((s) => s.ships);
  const maps = useStore((s) => s.maps);
  const s = () => useStore.getState();

  const ship = useMemo(() => ships.find((x) => x.id === obj.shipId), [ships, obj.shipId]);
  if (!page || !project) return null;

  const map = maps.find((m) => m.id === page.mapId);
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
      <Panel title={obj.shipName} storageKey="shipMain">
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
        <Field label="Position">
          <NumInput value={obj.x / 1000} step={0.1} onChange={(v) => update({ x: v * 1000 })} suffix="km" />
          <NumInput value={obj.y / 1000} step={0.1} onChange={(v) => update({ y: v * 1000 })} suffix="km" />
        </Field>
        <Field label="Grid">
          <span className="mono dim">{ref}</span>
        </Field>
        <Field label="Heading">
          <NumInput value={obj.rotation} step={5} onChange={(v) => update({ rotation: ((v % 360) + 360) % 360 })} suffix="°" />
        </Field>
        <Field label="Icon size">
          <Slider value={obj.iconScale} min={0.5} max={2.5} step={0.05} onChange={(v) => update({ iconScale: v })} format={(v) => `${v.toFixed(2)}x`} />
        </Field>
        <Field label="Layer">
          <select value={obj.layerId} onChange={(e) => update({ layerId: e.target.value })}>
            {page.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
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

      {/* Per-ship display overrides ---------------------------------- */}
      <Panel
        title="Display on Map"
        storageKey="shipDisplay"
        actions={
          Object.keys(obj.display).length > 0 ? (
            <Tip label="Clear all overrides — follow page defaults" side="bottom">
              <button className="icon-btn" onClick={() => update({ display: {} })}>
                <RadarIcon size={12} />
              </button>
            </Tip>
          ) : undefined
        }
      >
        <div className="faint" style={{ fontSize: 11, marginBottom: 4, lineHeight: 1.45 }}>
          Labels follow the page defaults until you change one here; an{' '}
          <span className="badge-override">OVR</span> badge marks a per-ship override, and clicking it falls back to the
          page setting. Ranges have no page default — they belong to this ship alone.
        </div>

        <SectionLabel>Labels</SectionLabel>
        {CHARACTERISTICS.filter((c) => c.group === 'label').map((c) => (
          <ShipFlagCheck key={c.key} obj={obj} flagKey={c.key} label={c.label} value={flags[c.key] ?? false} />
        ))}

        <SectionLabel>Ranges</SectionLabel>
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

        <SectionLabel>Other</SectionLabel>
        {CHARACTERISTICS.filter((c) => c.group === 'other').map((c) => (
          <ShipFlagCheck key={c.key} obj={obj} flagKey={c.key} label={c.label} value={flags[c.key] ?? false} />
        ))}
      </Panel>

      {/* Consumables ------------------------------------------------- */}
      <Panel title="Consumables" storageKey="shipConsumables">
        {ship ? (
          <ConsumableList shipId={ship.id} />
        ) : (
          <div className="empty-note">This ship is no longer in the database.</div>
        )}
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
  const overridden = Object.prototype.hasOwnProperty.call(obj.display, flagKey);
  return (
    <Check
      label={label}
      checked={value}
      title={disabledReason}
      onChange={(v) => s().setShipDisplay(obj.id, flagKey, v)}
      overridden={overridden}
      onClearOverride={() => s().setShipDisplay(obj.id, flagKey, undefined)}
    />
  );
}

function ConsumableList({ shipId }: { shipId: string }) {
  const ship = useStore((s) => s.ships.find((x) => x.id === shipId));
  if (!ship) return null;

  const rows: { name: string; value: string }[] = [];
  if (ship.radar_km) rows.push({ name: 'Radar', value: `${ship.radar_km.toFixed(1)} km${ship.radarDuration_s ? ` · ${ship.radarDuration_s}s` : ''}` });
  if (ship.hydro_km) rows.push({ name: 'Hydro', value: `${ship.hydro_km.toFixed(1)} km${ship.hydroDuration_s ? ` · ${ship.hydroDuration_s}s` : ''}` });
  if (ship.smokeDuration_s || ship.smokeRadius_km)
    rows.push({
      name: 'Smoke',
      value: `${ship.smokeRadius_km ? `${ship.smokeRadius_km.toFixed(2)} km` : ''}${ship.smokeDuration_s ? ` · ${ship.smokeDuration_s}s` : ''}`.trim(),
    });
  if (ship.fighter) rows.push({ name: 'Fighter', value: 'yes' });
  if (ship.spottingAircraft) rows.push({ name: 'Spotting Aircraft', value: 'yes' });
  for (const c of ship.consumables ?? []) {
    rows.push({ name: c.name, value: c.range_km ? `${c.range_km.toFixed(1)} km` : c.duration_s ? `${c.duration_s}s` : '—' });
  }

  if (!rows.length) return <div className="empty-note">No consumables recorded for this ship.</div>;

  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="field" style={{ padding: '1px 0' }}>
          <label style={{ width: 'auto', flex: 1 }}>{r.name}</label>
          <span className="mono dim" style={{ fontSize: 11 }}>
            {r.value || '—'}
          </span>
        </div>
      ))}
      <div className="faint" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.45 }}>
        Radar and Hydro draw as range circles when their toggle above is on. Everything else, smoke included, can be
        listed on the map with <em>Other Consumables</em>.
      </div>
    </div>
  );
}

function MultiSelectionPanel({ objects }: { objects: TacticalObject[] }) {
  const page = useStore(getActivePage);
  const s = () => useStore.getState();
  const ids = objects.map((o) => o.id);
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
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

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
