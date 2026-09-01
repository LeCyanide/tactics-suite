import type { ThemeName } from '@/types/model';

/**
 * Theme handling.
 *
 * The DOM half is trivial: a `data-theme` attribute on <html> flips the CSS
 * custom properties in global.css.
 *
 * The canvas half is not. Konva paints onto a bitmap and cannot resolve CSS
 * custom properties, so every colour the map draws has to exist as a real
 * string. CANVAS_THEMES is that palette, and `canvasTheme()` returns the
 * active one. Anything drawn on the map should take its colour from here
 * rather than hard-coding a hex value, or it will stay dark in light mode.
 */

export interface CanvasTheme {
  /** Map sheet backing, behind the image. */
  sheet: string;
  border: string;
  grid: string;
  gridLabel: string;
  /** Label plates drawn over the map. */
  plate: string;
  plateText: string;
  /** Outline that keeps glyphs legible over bright terrain. */
  contrast: string;
  accent: string;
  /** Fallback for a ship with no team. */
  neutral: string;
  selection: string;
  marquee: string;
  marqueeFill: string;
}

export const CANVAS_THEMES: Record<ThemeName, CanvasTheme> = {
  dark: {
    sheet: '#0e1620',
    border: '#2a3948',
    grid: '#8b98a5',
    gridLabel: '#97a5b4',
    plate: 'rgba(9,13,18,0.78)',
    plateText: '#e8eef5',
    contrast: '#080c11',
    accent: '#4ea3ff',
    neutral: '#8b98a5',
    selection: '#4ea3ff',
    marquee: '#4ea3ff',
    marqueeFill: 'rgba(78,163,255,0.12)',
  },
  light: {
    sheet: '#f4f6f9',
    border: '#9aa7b6',
    grid: '#5d6b7a',
    gridLabel: '#48576a',
    plate: 'rgba(255,255,255,0.86)',
    plateText: '#16202b',
    contrast: '#f2f5f8',
    accent: '#1f6feb',
    neutral: '#66717d',
    selection: '#1f6feb',
    marquee: '#1f6feb',
    marqueeFill: 'rgba(31,111,235,0.12)',
  },
};

let active: ThemeName = 'dark';

/** Flips the CSS custom properties and records the theme for canvas use. */
export function applyTheme(theme: ThemeName): void {
  active = theme;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/** Palette for an explicit theme; preferred, because it is a pure lookup. */
export function canvasThemeFor(theme: ThemeName): CanvasTheme {
  return CANVAS_THEMES[theme] ?? CANVAS_THEMES.dark;
}

/** Palette for whatever theme is currently applied. */
export function canvasTheme(): CanvasTheme {
  return canvasThemeFor(active);
}
