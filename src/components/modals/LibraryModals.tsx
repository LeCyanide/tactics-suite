import { useMemo, useState } from 'react';
import { Copy, Database, FileDown, FileUp, Image as ImageIcon, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { getActivePage, getRulesets, useStore } from '@/state/store';
import { Check, ColorInput, Field, InlineEdit, Modal, NumInput, SectionLabel, Tip } from '../common/ui';
import { useAsset } from '@/state/assets';
import {
  SHIP_CLASSES,
  shipClassCode,
  type GameMap,
  type Ship,
  type ShipClass,
  type ShipLimit,
  type ShipRuleset,
} from '@/types/model';
import { CLASS_COLORS } from '@/canvas/shipGlyphs';
import { ClassIcon } from '../common/ClassIcon';
import { uid } from '@/lib/util';
import { filterShips, hasRadar, hasSmoke, inScope, type Availability } from '@/lib/shipFilters';

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
          No maps yet. Import a minimap image, then set its real size so ranges measure correctly.
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
  const [radar, setRadar] = useState<Availability>('');
  const [smoke, setSmoke] = useState<Availability>('');
  const [rulesetId, setRulesetId] = useState('');
  const [bannedOnly, setBannedOnly] = useState(false);
  // The limit whose ships are being picked; the table's switches then set
  // membership of that group instead of bans.
  const [limitId, setLimitId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const hasProject = useStore((s) => !!s.project);
  const rulesets = useStore(getRulesets);
  const ruleset = rulesets.find((r) => r.id === rulesetId) ?? null;
  const saveRulesets = (next: ShipRuleset[]) => s().setRulesets(next);
  const patchRuleset = (id: string, patch: Partial<ShipRuleset>) =>
    saveRulesets(rulesets.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const nations = useMemo(() => [...new Set(ships.map((x) => x.nation))].sort(), [ships]);
  const tiers = useMemo(() => [...new Set(ships.map((x) => x.tier))].sort((a, b) => b - a), [ships]);

  const pickingLimit = ruleset?.limits.find((l) => l.id === limitId) ?? null;

  // A banned ship stays on the list here, switched off: this is where a
  // ruleset is set up, and a ship that vanished when banned could neither be
  // checked nor brought back. Only tiers and classes take ships off it.
  const filtered = useMemo(() => {
    const list = filterShips(ships, { query, nation, cls, tier, radar, smoke, ruleset: null });
    if (!ruleset) return list;
    return list.filter((ship) => inScope(ruleset, ship) && (!bannedOnly || ruleset.banned.includes(ship.id)));
  }, [ships, query, nation, cls, tier, radar, smoke, ruleset, bannedOnly]);

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
            <FileUp size={13} /> Import ship data…
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
              const ship: Ship = { id: uid('ship-'), name: 'New ship', nation: 'Unknown', class: 'CA', tier: 10, iconId: null };
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
            Import ship data as JSON, CSV or YAML. Column names are matched loosely, so most spreadsheet exports work
            as-is.
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => void s().importShipData()}>
              Import ship data…
            </button>
            <button className="btn" onClick={() => void s().loadSampleShips()}>
              Load sample ships
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 100px 90px', gap: 6, marginBottom: 8 }}>
              <select
                value={ruleset?.id ?? ''}
                disabled={!rulesets.length}
                title="Ship restrictions belonging to this project"
                onChange={(e) => setRulesetId(e.target.value)}
              >
                <option value="">No ruleset</option>
                {rulesets.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                className="btn sm"
                disabled={!hasProject}
                title={hasProject ? 'Add a ruleset to this project' : 'Open a project to add a ruleset'}
                onClick={() => {
                  const created: ShipRuleset = {
                    id: uid('rules-'),
                    name: 'New ruleset',
                    tiers: [],
                    classes: [],
                    banned: [],
                    limits: [],
                    maxShips: 0,
                  };
                  saveRulesets([...rulesets, created]);
                  setRulesetId(created.id);
                }}
              >
                <Plus size={12} /> Ruleset
              </button>
              <select value={radar} onChange={(e) => setRadar(e.target.value as Availability)}>
                <option value="">Radar: any</option>
                <option value="yes">Has radar</option>
                <option value="no">No radar</option>
              </select>
              <select value={smoke} onChange={(e) => setSmoke(e.target.value as Availability)}>
                <option value="">Smoke: any</option>
                <option value="yes">Has smoke</option>
                <option value="no">No smoke</option>
              </select>
            </div>

            {ruleset && (
              <RulesetEditor
                key={ruleset.id}
                ruleset={ruleset}
                tiers={tiers}
                ships={ships}
                bannedOnly={bannedOnly}
                onBannedOnly={setBannedOnly}
                limitId={pickingLimit?.id ?? ''}
                onLimitId={setLimitId}
                onChange={(patch) => patchRuleset(ruleset.id, patch)}
                onDelete={() => {
                  saveRulesets(rulesets.filter((r) => r.id !== ruleset.id));
                  setRulesetId('');
                }}
              />
            )}

            {withoutIcon > 0 && (
              <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>
                {withoutIcon} ship{withoutIcon === 1 ? '' : 's'} without an icon use a class glyph. Icon files are
                matched to ships by file name.
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
                    <th style={{ width: 50 }}>Smoke</th>
                    <th style={{ width: 56 }}>Range</th>
                    {ruleset && <th style={{ width: 96 }}>{pickingLimit ? 'In limit' : 'Ruleset'}</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ship) => (
                    <tr
                      key={ship.id}
                      className={ship.id === selectedId ? 'selected' : ''}
                      style={ruleset?.banned.includes(ship.id) ? { opacity: 0.55 } : undefined}
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
                      <td className="num">{ship.radar_km?.toFixed(1) ?? (hasRadar(ship) ? 'yes' : '—')}</td>
                      <td className="num">{ship.hydro_km?.toFixed(1) ?? '—'}</td>
                      <td className="num">{hasSmoke(ship) ? 'yes' : '—'}</td>
                      <td className="num">{ship.mainBatteryRange_km?.toFixed(1) ?? '—'}</td>
                      {ruleset && (
                        <td onClick={(e) => e.stopPropagation()}>
                          {pickingLimit ? (
                            <Switch
                              on={pickingLimit.ships.includes(ship.id)}
                              label={pickingLimit.ships.includes(ship.id) ? 'In limit' : 'Add'}
                              onChange={() =>
                                patchRuleset(ruleset.id, {
                                  limits: ruleset.limits.map((l) =>
                                    l.id === pickingLimit.id ? { ...l, ships: toggled(l.ships, ship.id) } : l,
                                  ),
                                })
                              }
                            />
                          ) : (
                            <Switch
                              on={!ruleset.banned.includes(ship.id)}
                              label={ruleset.banned.includes(ship.id) ? 'Banned' : 'Allowed'}
                              offIsDanger
                              onChange={() => patchRuleset(ruleset.id, { banned: toggled(ruleset.banned, ship.id) })}
                            />
                          )}
                        </td>
                      )}
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

const toggled = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

/**
 * A two-state switch that says what state it is in. Used where a tick would
 * leave "off" looking like nothing was decided: a banned ship reads "Banned".
 */
function Switch({
  on,
  label,
  offIsDanger,
  onChange,
}: {
  on: boolean;
  label: string;
  offIsDanger?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`switch${on ? ' on' : offIsDanger ? ' danger' : ''}`}
      onClick={onChange}
    >
      <span className="switch-track">
        <span className="switch-knob" />
      </span>
      <span>{label}</span>
    </button>
  );
}

/** A name field that commits when left, so renaming is one undo step and not one per key. */
function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

/**
 * One ruleset. Tiers and classes are allow-lists where nothing picked means
 * no limit, so "Any" is the empty list rather than a full one and a ruleset
 * does not have to be revisited when a new tier turns up. Bans and the ships
 * of a limit are set from the table underneath.
 */
function RulesetEditor({
  ruleset,
  tiers,
  ships,
  bannedOnly,
  onBannedOnly,
  limitId,
  onLimitId,
  onChange,
  onDelete,
}: {
  ruleset: ShipRuleset;
  tiers: number[];
  ships: Ship[];
  bannedOnly: boolean;
  onBannedOnly: (v: boolean) => void;
  limitId: string;
  onLimitId: (id: string) => void;
  onChange: (patch: Partial<ShipRuleset>) => void;
  onDelete: () => void;
}) {
  const nameOf = useMemo(() => new Map(ships.map((x) => [x.id, x.name])), [ships]);
  const patchLimit = (id: string, patch: Partial<ShipLimit>) =>
    onChange({ limits: ruleset.limits.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  const chips = <T extends string | number>(all: T[], picked: T[], onPick: (next: T[]) => void) => (
    <div className="ruleset-chips">
      <button className={`variant-chip${picked.length ? '' : ' active'}`} onClick={() => onPick([])}>
        Any
      </button>
      {all.map((value) => (
        <button
          key={value}
          className={`variant-chip${picked.includes(value) ? ' active' : ''}`}
          onClick={() => onPick(toggled(picked, value))}
        >
          {value}
        </button>
      ))}
    </div>
  );

  return (
    <div className="ruleset-editor">
      <Field label="Name">
        <NameInput value={ruleset.name} onCommit={(name) => onChange({ name })} />
        <Tip label="Delete ruleset" side="top">
          <button className="btn sm danger" onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        </Tip>
      </Field>
      <Field label="Tiers">{chips([...tiers].sort((a, b) => a - b), ruleset.tiers, (next) => onChange({ tiers: next }))}</Field>
      <Field label="Classes">{chips(SHIP_CLASSES, ruleset.classes, (next) => onChange({ classes: next }))}</Field>

      <Field label="Team size">
        <div style={{ width: 52, flex: 'none' }}>
          <NumInput
            value={ruleset.maxShips}
            min={0}
            max={30}
            step={1}
            onChange={(v) => onChange({ maxShips: Math.max(0, Math.round(v)) })}
          />
        </div>
        <span className="faint" style={{ fontSize: 11 }}>
          {ruleset.maxShips ? 'ships per team at most' : 'no limit — set a number to cap ships per team'}
        </span>
      </Field>

      <Field label="Bans">
        <div className="ruleset-chips">
          <span className="faint" style={{ fontSize: 11 }}>
            {ruleset.banned.length} banned — switch a ship off in the table to ban it.
          </span>
          <button
            className={`variant-chip${bannedOnly ? ' active' : ''}`}
            disabled={!ruleset.banned.length && !bannedOnly}
            onClick={() => onBannedOnly(!bannedOnly)}
          >
            Show only banned
          </button>
        </div>
      </Field>

      <Field label="Limits">
        <div className="ruleset-limits">
          {ruleset.limits.map((limit) => {
            const picking = limit.id === limitId;
            return (
              <div key={limit.id} className={`ruleset-limit${picking ? ' active' : ''}`}>
                <span>Max</span>
                <div style={{ width: 52, flex: 'none' }}>
                  <NumInput
                    value={limit.max}
                    min={0}
                    max={12}
                    step={1}
                    onChange={(v) => patchLimit(limit.id, { max: Math.max(0, Math.round(v)) })}
                  />
                </div>
                <span>of</span>
                <div className="ruleset-chips" style={{ flex: 1 }}>
                  {limit.ships.map((id) => (
                    <button
                      key={id}
                      className="variant-chip"
                      title="Take out of this limit"
                      onClick={() => patchLimit(limit.id, { ships: limit.ships.filter((x) => x !== id) })}
                    >
                      {nameOf.get(id) ?? 'Unknown ship'} ×
                    </button>
                  ))}
                  {!limit.ships.length && <span className="faint">no ships yet</span>}
                </div>
                <button className={`btn sm${picking ? ' primary' : ''}`} onClick={() => onLimitId(picking ? '' : limit.id)}>
                  {picking ? 'Done' : 'Pick ships'}
                </button>
                <button
                  className="btn sm danger"
                  onClick={() => onChange({ limits: ruleset.limits.filter((l) => l.id !== limit.id) })}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
          <div>
            <button
              className="btn sm"
              onClick={() => {
                const limit: ShipLimit = { id: uid('limit-'), max: 2, ships: [] };
                onChange({ limits: [...ruleset.limits, limit] });
                onLimitId(limit.id);
              }}
            >
              <Plus size={12} /> Limit
            </button>
          </div>
        </div>
      </Field>
    </div>
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
            <option value="CA">CA — Heavy cruiser</option>
            <option value="CL">CL — Light cruiser</option>
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
      {numField('Air detection', 'concealmentAir_km', 'km')}

      <SectionLabel>Armament</SectionLabel>
      {numField('Main range', 'mainBatteryRange_km', 'km')}
      <Field label="Main guns">
        <input type="text" value={ship.mainBattery ?? ''} onChange={(e) => set({ mainBattery: e.target.value })} />
      </Field>
      {numField('Secondary', 'secondaryRange_km', 'km')}
      {numField('Torpedo range', 'torpedoRange_km', 'km')}
      {numField('Torpedo arc', 'torpedoArc_deg', '°', 5)}
      {numField('Airstrike min', 'airstrikeMinRange_km', 'km')}
      {numField('Airstrike max', 'airstrikeMaxRange_km', 'km')}
      {numField('AA range', 'aaRange_km', 'km')}

      <SectionLabel>Consumables</SectionLabel>
      {numField('Radar', 'radar_km', 'km')}
      {numField('Radar time', 'radarDuration_s', 's', 5)}
      {numField('Hydro', 'hydro_km', 'km')}
      {numField('Hydro time', 'hydroDuration_s', 's', 5)}
      <Check label="Smoke generator" checked={hasSmoke(ship)} onChange={(v) => set({ smoke: v })} />
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
