/**
 * Tactical ping presets.
 *
 * Pings are a first-class object type rather than a drawing: one click stamps
 * a labelled, colour-coded marker whose meaning is fixed by the preset, which
 * is what makes them useful for fast call-outs during planning.
 *
 * Glyphs are 24x24 SVG path data, drawn with Konva's Path shape so they stay
 * crisp at every zoom level.
 */

export interface PingPreset {
  id: string;
  label: string;
  color: string;
  icon: string;
  /** Directional pings expose a rotation handle and draw a pointer. */
  directional: boolean;
  builtIn?: boolean;
}

export const PING_ICONS: Record<string, string> = {
  attack: 'M4 20 L20 4 M12 4 H20 V12',
  shield: 'M12 2 L20 5.2 V12 C20 17 16.4 20.6 12 22 C7.6 20.6 4 17 4 12 V5.2 Z',
  target:
    'M12 12 m-8.5 0 a8.5 8.5 0 1 0 17 0 a8.5 8.5 0 1 0 -17 0 M12 12 m-3.5 0 a3.5 3.5 0 1 0 7 0 a3.5 3.5 0 1 0 -7 0 M12 1.5 V6 M12 18 V22.5 M1.5 12 H6 M18 12 H22.5',
  danger: 'M12 2.5 L22.5 20.5 H1.5 Z M12 9 V14.5 M12 16.8 V18.1',
  eye: 'M2 12 C5 6.4 8.8 4.2 12 4.2 C15.2 4.2 19 6.4 22 12 C19 17.6 15.2 19.8 12 19.8 C8.8 19.8 5 17.6 2 12 Z M12 8.9 a3.1 3.1 0 1 0 0 6.2 a3.1 3.1 0 1 0 0 -6.2',
  radar:
    'M12 12 m-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 M12 12 m-4.5 0 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0 M12 12 L19 6.5',
  hydro: 'M12 21 a9 9 0 0 1 0 -18 M12 17.5 a5.5 5.5 0 0 1 0 -11 M12 14 a2 2 0 0 1 0 -4',
  torpedo: 'M2.5 12 H15 M15 8.2 a3.8 3.8 0 0 1 0 7.6 M6.5 9 V15 M18.5 12 H22 M1 9.5 L3.5 12 L1 14.5',
  smoke: 'M6.5 17.5 a4.2 4.2 0 0 1 0.3 -8.4 a5.2 5.2 0 0 1 9.7 -1 A4.2 4.2 0 0 1 17.5 17.5 Z',
  retreat: 'M20.5 12 H6 M11 6.5 L5.5 12 L11 17.5 M3 4 V20',
  push: 'M12 20.5 V6 M6.5 11.5 L12 6 L17.5 11.5 M4.5 3 H19.5',
  hold: 'M5 5 H19 V19 H5 Z M9.5 9 V15 M14.5 9 V15',
  flag: 'M6 21.5 V3 H18.5 L15 7.8 L18.5 12.6 H6',
  recon: 'M11 11 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M16 16 L21.5 21.5',
  star: 'M12 2.5 L14.9 9 L21.9 9.8 L16.7 14.6 L18.2 21.5 L12 18 L5.8 21.5 L7.3 14.6 L2.1 9.8 L9.1 9 Z',
  pin: 'M12 22 C12 22 19 14.6 19 9.6 A7 7 0 0 0 5 9.6 C5 14.6 12 22 12 22 Z M12 9.6 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0',
  cross: 'M4 4 L20 20 M20 4 L4 20',
  diamond: 'M12 2.5 L21.5 12 L12 21.5 L2.5 12 Z',
  anchor: 'M12 7.5 V21 M12 7.5 m-2.6 -2.6 a2.6 2.6 0 1 1 5.2 0 a2.6 2.6 0 1 1 -5.2 0 M4 13 a8 8 0 0 0 16 0',
  clock: 'M12 12 m-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 M12 6.5 V12 L15.8 14.5',
};

export const BUILT_IN_PINGS: PingPreset[] = [
  { id: 'attack', label: 'Attack', color: '#ff5f56', icon: 'attack', directional: true, builtIn: true },
  { id: 'defend', label: 'Defend', color: '#4ea3ff', icon: 'shield', directional: false, builtIn: true },
  { id: 'focus', label: 'Focus Target', color: '#ff9f43', icon: 'target', directional: false, builtIn: true },
  { id: 'danger', label: 'Danger', color: '#ff3b58', icon: 'danger', directional: false, builtIn: true },
  { id: 'spotting', label: 'Spotting', color: '#f4d35e', icon: 'eye', directional: false, builtIn: true },
  { id: 'radar', label: 'Radar', color: '#5ad2f4', icon: 'radar', directional: false, builtIn: true },
  { id: 'hydro', label: 'Hydro', color: '#7ee787', icon: 'hydro', directional: false, builtIn: true },
  { id: 'torpedo', label: 'Torpedo Threat', color: '#8f7bff', icon: 'torpedo', directional: true, builtIn: true },
  { id: 'smoke', label: 'Smoke', color: '#c9d1d9', icon: 'smoke', directional: false, builtIn: true },
  { id: 'retreat', label: 'Retreat', color: '#ff8f5e', icon: 'retreat', directional: true, builtIn: true },
  { id: 'push', label: 'Push', color: '#3fd68a', icon: 'push', directional: true, builtIn: true },
  { id: 'hold', label: 'Hold', color: '#9aa7b4', icon: 'hold', directional: false, builtIn: true },
  { id: 'capture', label: 'Capture', color: '#ffd166', icon: 'flag', directional: false, builtIn: true },
  { id: 'recon', label: 'Recon', color: '#6ee7d5', icon: 'recon', directional: true, builtIn: true },
  { id: 'priority', label: 'Priority Target', color: '#ff4d9d', icon: 'star', directional: false, builtIn: true },
];

/* ------------------------------------------------------------------ */
/* Tactical zone presets                                               */
/* ------------------------------------------------------------------ */

export interface ZonePreset {
  id: string;
  label: string;
  color: string;
  shape: 'circle' | 'rect' | 'polygon' | 'cone';
  /** Default radius in km for circular / cone zones. */
  km?: number;
  coneAngle?: number;
  fill: boolean;
}

export const ZONE_PRESETS: ZonePreset[] = [
  { id: 'radar', label: 'Radar Range', color: '#5ad2f4', shape: 'circle', km: 10, fill: true },
  { id: 'hydro', label: 'Hydro Range', color: '#7ee787', shape: 'circle', km: 6, fill: true },
  { id: 'detection', label: 'Detection Range', color: '#f4c95d', shape: 'circle', km: 12, fill: false },
  { id: 'aa', label: 'AA Range', color: '#ff6b8a', shape: 'circle', km: 6.6, fill: false },
  { id: 'torpedo', label: 'Torpedo Range', color: '#8f7bff', shape: 'cone', km: 10, coneAngle: 35, fill: true },
  { id: 'firing', label: 'Firing Range', color: '#ff8f5e', shape: 'circle', km: 18, fill: false },
  { id: 'search', label: 'Search Area', color: '#9aa7b4', shape: 'rect', fill: true },
  { id: 'defensive', label: 'Defensive Area', color: '#4ea3ff', shape: 'polygon', fill: true },
  { id: 'attack', label: 'Attack Area', color: '#ff5f56', shape: 'polygon', fill: true },
  { id: 'capture', label: 'Capture Zone', color: '#ffd166', shape: 'circle', km: 4, fill: true },
  { id: 'nogo', label: 'No-Go Zone', color: '#ff3b58', shape: 'polygon', fill: true },
];
