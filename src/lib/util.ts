import type { Vec2 } from '@/types/model';

export function uid(prefix = ''): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return prefix + crypto.randomUUID();
  return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}

/* ------------------------------------------------------------------ */
/* Geometry — everything in world metres unless stated otherwise        */
/* ------------------------------------------------------------------ */

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Path length in metres. */
export function pathLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/** Compass bearing, 0 deg = north (up), increasing clockwise. */
export function bearing(from: Vec2, to: Vec2): number {
  const deg = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Shoelace area of a closed polygon, in square metres. */
export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function rotatePoint(p: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

export function boundsOf(points: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Ramer-Douglas-Peucker simplification. Freehand strokes arrive with hundreds
 * of samples; thinning them on commit keeps redraw cheap when a page carries a
 * few hundred objects.
 */
export function simplifyPath(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return points;

  const sqTol = tolerance * tolerance;
  const sqSegDist = (p: Vec2, a: Vec2, b: Vec2): number => {
    let x = a.x;
    let y = a.y;
    let dx = b.x - x;
    let dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b.x;
        y = b.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  };

  const out: Vec2[] = [];
  const step = (first: number, last: number) => {
    let maxSq = sqTol;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(points[i], points[first], points[last]);
      if (sq > maxSq) {
        index = i;
        maxSq = sq;
      }
    }
    if (index === -1) return;
    if (index - first > 1) step(first, index);
    out.push(points[index]);
    if (last - index > 1) step(index, last);
  };

  out.push(points[0]);
  step(0, points.length - 1);
  out.push(points[points.length - 1]);
  out.sort((a, b) => points.indexOf(a) - points.indexOf(b));
  return out;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatKm(metres: number, digits = 1): string {
  return `${(metres / 1000).toFixed(digits)} km`;
}

export function formatArea(sqMetres: number): string {
  const sqKm = sqMetres / 1_000_000;
  return `${sqKm.toFixed(sqKm < 10 ? 2 : 1)} km²`;
}

export function formatBearing(deg: number): string {
  return `${deg.toFixed(0).padStart(3, '0')}°`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatRelative(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(ts);
}

/** Big Race style grid reference, e.g. "F7". */
export function gridRef(x: number, y: number, widthM: number, heightM: number, cols: number, rows: number): string {
  const c = clamp(Math.floor((x / widthM) * cols), 0, cols - 1);
  const r = clamp(Math.floor((y / heightM) * rows), 0, rows - 1);
  return `${columnLabel(c)}${r + 1}`;
}

export function columnLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Hex colour + alpha -> rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

export function dashArray(style: 'solid' | 'dashed' | 'dotted', width: number): number[] | undefined {
  if (style === 'dashed') return [width * 3.5, width * 2.5];
  if (style === 'dotted') return [width * 0.1, width * 2.2];
  return undefined;
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: any[] | null = null;
  const wrapped = ((...args: any[]) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = lastArgs;
      lastArgs = null;
      if (a) fn(...a);
    }, ms);
  }) as T & { cancel: () => void; flush: () => void };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      const a = lastArgs;
      lastArgs = null;
      if (a) fn(...a);
    }
  };
  return wrapped;
}

/* ------------------------------------------------------------------ */
/* Text search                                                         */
/* ------------------------------------------------------------------ */

/** Latin letters that carry no combining mark, so NFD leaves them untouched. */
const LETTER_FOLDS: Record<string, string> = {
  'ł': 'l',
  'ø': 'o',
  'đ': 'd',
  'ð': 'd',
  'þ': 'th',
  'ß': 'ss',
  'æ': 'ae',
  'œ': 'oe',
  'ħ': 'h',
  'ŧ': 't',
  'ı': 'i',
  'ĸ': 'k',
};

/**
 * Case- and accent-insensitive form used for matching. Half the roster is
 * spelled with diacritics nobody types — Myōkō, Błyskawica, Grosser Kurfürst —
 * so both the haystack and the needle get folded before comparing.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u00df\u00e6\u00f0\u00f8\u00fe\u0111\u0127\u0131\u0138\u0142\u0153\u0167]/g, (c) => LETTER_FOLDS[c] ?? c);
}
