import { useMemo, useState } from 'react';
import { Copy, Database, FileDown, FileUp, Image as ImageIcon, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { getActivePage, useStore } from '@/state/store';
import { Check, ColorInput, Field, InlineEdit, Modal, NumInput, SectionLabel, Tip } from '../common/ui';
import { useAsset } from '@/state/assets';
import { SHIP_CLASSES, shipClassCode, type GameMap, type Ship, type ShipClass } from '@/types/model';
import { CLASS_COLORS } from '@/canvas/shipGlyphs';
import { ClassIcon } from '../common/ClassIcon';
import { foldForSearch, uid } from '@/lib/util';

/* ================================================================== */
/* Map manager                                                         */
/* ================================================================== */

export function MapManagerModal() {
  const maps = useStore((s) => s.maps);
  const page = useStore(getActivePage);
  const s = () => useStore.getState();

  return (
    <Modal
      title="Map Manager"
      subtitle={`${maps.length} maps stored locally`}
      size="wide"
      onClose={() => s().closeModal()}
      footer={
        <>
          <button className="btn primary" onClick={() => void s().importMaps()}>
            <ImageIcon size={13} /> Import map image…
          </button>
          <span className="faint" style={{ fontSize: 11 }}>
            PNG · JPG · WEBP
          </span>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => s().closeModal()}>
            Close
          </button>
        </>
      }
    >
      {maps.length === 0 ? (
        <div className="empty-note" style={{ padding: 40 }}>
          No maps yet. Import a minimap screenshot or map render, then set its real-world size so ranges measure
          correctly.
        </div>
      ) : (
        <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))' }}>
          {maps.map((map) => (
            <MapCard key={map.id} map={map} active={page?.mapId === map.id} />
          ))}
        </div>
      )}
    </Modal>
  );
}

function MapCard({ map, active }: { map: GameMap; active: boolean }) {
  const img = useAsset('map', map.file, map.mime);
  const s = () => useStore.getState();
  const update = (patch: Partial<GameMap>) => void s().updateMap({ ...map, ...patch });

  return (
    <div className={`card${active ? ' selected' : ''}`}>
      <div className="thumb">{img ? <img src={img.src} alt="" /> : <span className="faint">loading…</span>}</div>
      <InlineEdit value={map.name} onCommit={(v) => update({ name: v })} className="card-title" />
      <div className="card-sub">
        {map.pixelWidth} × {map.pixelHeight} px
      </div>

      <Field label="Size">
        <NumInput value={map.widthMeters / 1000} step={1} min={1} onChange={(v) => update({ widthMeters: v * 1000 })} suffix="km" />
        <NumInput value={map.heightMeters / 1000} step={1} min={1} onChange={(v) => update({ heightMeters: v * 1000 })} suffix="km" />
      </Field>
      <Field label="Grid">
        <NumInput value={map.gridCols} step={1} min={1} max={40} onChange={(v) => update({ gridCols: Math.round(v) })} />
        <NumInput value={map.gridRows} step={1} min={1} max={40} onChange={(v) => update({ gridRows: Math.round(v) })} />
      </Field>
      <div className="faint mono" style={{ fontSize: 10 }}>
        1 cell = {(map.widthMeters / map.gridCols / 1000).toFixed(2)} × {(map.heightMeters / map.gridRows / 1000).toFixed(2)} km
      </div>

      <div className="card-actions">
        <button className="btn sm primary" style={{ flex: 1 }} onClick={() => s().setPageMap(map.id)}>
          Use on page
        </button>
        <Tip label="Replace image" side="top">
          <button className="btn sm" onClick={() => void s().replaceMapImage(map.id)}>
            <RefreshCw size={12} />
          </button>
        </Tip>
        <Tip label="Duplicate" side="top">
          <button className="btn sm" onClick={() => void s().duplicateMap(map.id)}>
            <Copy size={12} />
          </button>
        </Tip>
        <button className="btn sm danger" onClick={() => void s().deleteMap(map.id)}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Ship database                                                       */
/* ================================================================== */

export function ShipDatabaseModal() {
  const ships = useStore((s) => s.ships);
  const icons = useStore((s) => s.icons);
  const s = () => useStore.getState();

  const [query, setQuery] = useState('');
  const [nation, setNation] = useState('');
  const [cls, setCls] = useState<'' | ShipClass>('');
  const [tier, setTier] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nations = useMemo(() => [...new Set(ships.map((x) => x.nation))].sort(), [ships]);
  const tiers = useMemo(() => [...new Set(ships.map((x) => x.tier))].sort((a, b) => b - a), [ships]);

  const filtered = useMemo(() => {
    const q = foldForSearch(query.trim());
    return ships.filter(
      (ship) =>
        (!q || foldForSearch(ship.name).includes(q)) &&
        (!nation || ship.nation === nation) &&
        (!cls || ship.class === cls) &&
        (!tier || String(ship.tier) === tier),
    );
  }, [ships, query, nation, cls, tier]);

  const selected = ships.find((x) => x.id === selectedId) ?? null;
  const withoutIcon = ships.filter((x) => !x.iconId).length;

  return (
    <Modal
      title="Ship Database"
      subtitle={`${ships.length} ships · ${icons.length} icons`}
      size="wide"
      onClose={() => s().closeModal()}
      footer={
        <>
          <button className="btn primary" onClick={() => void s().importShipData()}>
            <FileUp size={13} /> Import data…
          </button>
          <button className="btn" onClick={() => void s().importIcons()}>
            <ImageIcon size={13} /> Import icons…
          </button>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn sm" onClick={() => void s().exportShipData('json')}>
              <FileDown size={12} /> JSON
            </button>
            <button className="btn sm" onClick={() => void s().exportShipData('csv')}>
              CSV
            </button>
            <button className="btn sm" onClick={() => void s().exportShipData('yaml')}>
              YAML
            </button>
          </div>
          <span className="spacer" />
          <button
            className="btn"
            onClick={() => {
              const ship: Ship = { id: uid('ship-'), name: 'New Ship', nation: 'Unknown', class: 'CA', tier: 10, iconId: null };
              void s().upsertShip(ship);
              setSelectedId(ship.id);
            }}
          >
            <Plus size={13} /> Add ship
          </button>
          <button className="btn ghost" onClick={() => s().closeModal()}>
            Close
          </button>
        </>
      }
    >
      {ships.length === 0 ? (
        <div className="empty-note" style={{ padding: 34 }}>
          <Database size={26} style={{ opacity: 0.4, marginBottom: 10 }} />
          <div>The ship database is empty.</div>
          <div style={{ marginTop: 6, maxWidth: 420, margin: '6px auto 0' }}>
            Import your own ship data as JSON, CSV or YAML — column names are matched loosely, so an export from a
            spreadsheet usually works as-is.
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => void s().importShipData()}>
              Import ship data…
            </button>
            <button className="btn" onClick={() => void s().loadSampleShips()}>
              Load sample set
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 330px' : '1fr', gap: 12, minHeight: 400 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 100px 90px', gap: 6, marginBottom: 8 }}>
              <div style={{ position: 'relative' }}>
                <Search size={12} style={{ position: 'absolute', left: 7, top: 6, color: 'var(--fg-faint)' }} />
                <input type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 24 }} />
              </div>
              <select value={nation} onChange={(e) => setNation(e.target.value)}>
                <option value="">All nations</option>
                {nations.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <select value={cls} onChange={(e) => setCls(e.target.value as ShipClass | '')}>
                <option value="">All classes</option>
                {SHIP_CLASSES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">All tiers</option>
                {tiers.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>

            {withoutIcon > 0 && (
              <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>
                {withoutIcon} ship{withoutIcon === 1 ? '' : 's'} without an icon — those fall back to a class glyph on
                the map. Imported icon files are matched to ships by file name automatically.
              </div>
            )}

            <div style={{ maxHeight: 440, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 4 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th>Ship</th>
                    <th>Nation</th>
                    <th style={{ width: 46 }}>Class</th>
                    <th style={{ width: 40 }}>Tier</th>
                    <th style={{ width: 62 }}>Conceal</th>
                    <th style={{ width: 56 }}>Radar</th>
                    <th style={{ width: 56 }}>Hydro</th>
                    <th style={{ width: 56 }}>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ship) => (
                    <tr
                      key={ship.id}
                      className={ship.id === selectedId ? 'selected' : ''}
                      onClick={() => setSelectedId(ship.id)}
                    >
                      <td>
                        <IconCell iconId={ship.iconId ?? null} cls={ship.class} />
                      </td>
                      <td style={{ color: 'var(--fg)' }}>{ship.name}</td>
                      <td>{ship.nation}</td>
                      <td>
                        <span className="class-chip" style={{ background: `${CLASS_COLORS[ship.class]}22`, color: CLASS_COLORS[ship.class] }}>
                          {shipClassCode(ship)}
                        </span>
                      </td>
                      <td className="num">{ship.tier}</td>
                      <td className="num">{ship.concealment_km?.toFixed(1) ?? '—'}</td>
                      <td className="num">{ship.radar_km?.toFixed(1) ?? '—'}</td>
                      <td className="num">{ship.hydro_km?.toFixed(1) ?? '—'}</td>
                      <td className="num">{ship.mainBatteryRange_km?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selected && <ShipEditor ship={selected} onDeleted={() => setSelectedId(null)} />}
        </div>
      )}
    </Modal>
  );
}

function IconCell({ iconId, cls }: { iconId: string | null; cls: ShipClass }) {
  const icons = useStore((s) => s.icons);
  const asset = icons.find((i) => i.id === iconId);
  const img = useAsset('icon', asset?.file, asset?.mime ?? '');
  return (
    <div className="ship-icon" style={{ width: 22, height: 22 }}>
      {img ? <img src={img.src} alt="" /> : <ClassIcon cls={cls} size={17} />}
    </div>
  );
}

function ShipEditor({ ship, onDeleted }: { ship: Ship; onDeleted: () => void }) {
  const icons = useStore((s) => s.icons);
  const s = () => useStore.getState();
  const set = (patch: Partial<Ship>) => void s().upsertShip({ ...ship, ...patch });

  const numField = (label: string, key: keyof Ship, suffix?: string, step = 0.1) => (
    <Field label={label}>
      <NumInput
        value={(ship[key] as number) ?? 0}
        step={step}
        onChange={(v) => set({ [key]: v } as Partial<Ship>)}
        suffix={suffix}
      />
    </Field>
  );

  return (
    <div style={{ borderLeft: '1px solid var(--line)', paddingLeft: 12, overflowY: 'auto', maxHeight: 480 }}>
      <SectionLabel>Identity</SectionLabel>
      <Field label="Name">
        <input type="text" value={ship.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Nation">
        <input type="text" value={ship.nation} onChange={(e) => set({ nation: e.target.value })} />
      </Field>
      <Field label="Class">
        <select value={ship.class} onChange={(e) => set({ class: e.target.value as ShipClass })}>
          {SHIP_CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      {ship.class === 'CA' && (
        <Field label="Cruiser type">
          <select
            value={ship.cruiserType ?? 'CA'}
            onChange={(e) => set({ cruiserType: e.target.value as 'CA' | 'CL' })}
          >
            <option value="CA">CA — Heavy Cruiser</option>
            <option value="CL">CL — Light Cruiser</option>
          </select>
        </Field>
      )}
      <Field label="Tier">
        <NumInput value={ship.tier} min={1} max={12} step={1} onChange={(v) => set({ tier: Math.round(v) })} />
      </Field>

      <SectionLabel>Map icon</SectionLabel>
      <Field label="Icon">
        <select value={ship.iconId ?? ''} onChange={(e) => void s().assignIcon(ship.id, e.target.value || null)}>
          <option value="">Class glyph (no icon)</option>
          {icons.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <IconCell iconId={ship.iconId ?? null} cls={ship.class} />
      </Field>
      <button className="btn sm block" onClick={() => void s().importIcons()}>
        Import icon files…
      </button>

      <SectionLabel>Survivability</SectionLabel>
      {numField('HP', 'hp', undefined, 100)}
      {numField('Speed', 'speed_kn', 'kn')}
      {numField('Rudder', 'rudderShift_s', 's')}
      {numField('Turning', 'turningCircle_m', 'm', 10)}

      <SectionLabel>Detection</SectionLabel>
      {numField('Concealment', 'concealment_km', 'km')}
      {numField('Air detect', 'concealmentAir_km', 'km')}

      <SectionLabel>Armament</SectionLabel>
      {numField('Main range', 'mainBatteryRange_km', 'km')}
      <Field label="Main guns">
        <input type="text" value={ship.mainBattery ?? ''} onChange={(e) => set({ mainBattery: e.target.value })} />
      </Field>
      {numField('Secondary', 'secondaryRange_km', 'km')}
      {numField('Torp range', 'torpedoRange_km', 'km')}
      {numField('Torp arc', 'torpedoArc_deg', '°', 5)}
      {numField('Airstrike min', 'airstrikeMinRange_km', 'km')}
      {numField('Airstrike max', 'airstrikeMaxRange_km', 'km')}
      {numField('AA range', 'aaRange_km', 'km')}

      <SectionLabel>Consumables</SectionLabel>
      {numField('Radar', 'radar_km', 'km')}
      {numField('Radar time', 'radarDuration_s', 's', 5)}
      {numField('Hydro', 'hydro_km', 'km')}
      {numField('Hydro time', 'hydroDuration_s', 's', 5)}
      {numField('Smoke radius', 'smokeRadius_km', 'km', 0.05)}
      {numField('Smoke time', 'smokeDuration_s', 's', 5)}
      <Check label="Fighter" checked={!!ship.fighter} onChange={(v) => set({ fighter: v })} />
      <Check label="Spotting aircraft" checked={!!ship.spottingAircraft} onChange={(v) => set({ spottingAircraft: v })} />

      <SectionLabel>Notes</SectionLabel>
      <textarea rows={3} value={ship.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />

      <button
        className="btn sm danger block"
        style={{ marginTop: 10 }}
        onClick={async () => {
          const ok = await window.api.dialog.confirm({
            title: 'Delete ship',
            message: `Remove "${ship.name}" from the ship database?`,
            confirmLabel: 'Delete',
            danger: true,
          });
          if (!ok) return;
          await s().deleteShip(ship.id);
          onDeleted();
        }}
      >
        <Trash2 size={12} /> Delete ship
      </button>
    </div>
  );
}
