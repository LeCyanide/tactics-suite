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
  dusk: {
    sheet: '#15110d',
    border: '#3a3129',
    grid: '#9a8b7a',
    gridLabel: '#b0a394',
    plate: 'rgba(15,12,9,0.8)',
    plateText: '#eee6dc',
    contrast: '#0a0807',
    accent: '#ff8a3d',
    neutral: '#9a8b7a',
    selection: '#ff8a3d',
    marquee: '#ff8a3d',
    marqueeFill: 'rgba(255,138,61,0.12)',
  },
  aurora: {
    sheet: '#0f1611',
    border: '#2c3a30',
    grid: '#8a9a8e',
    gridLabel: '#9aaa9e',
    plate: 'rgba(9,14,11,0.8)',
    plateText: '#e3ece5',
    contrast: '#070b08',
    accent: '#d9b36c',
    neutral: '#8a9a8e',
    selection: '#d9b36c',
    marquee: '#d9b36c',
    marqueeFill: 'rgba(217,179,108,0.12)',
  },
  midnight: {
    sheet: '#100e1c',
    border: '#2e2a48',
    grid: '#8e8bae',
    gridLabel: '#a29fc0',
    plate: 'rgba(10,9,20,0.8)',
    plateText: '#e8e6f5',
    contrast: '#07060e',
    accent: '#c77dff',
    neutral: '#8e8bae',
    selection: '#c77dff',
    marquee: '#c77dff',
    marqueeFill: 'rgba(199,125,255,0.12)',
  },
  nocturne: {
    sheet: '#0b1522',
    border: '#24374f',
    grid: '#8299b2',
    gridLabel: '#93a9c2',
    plate: 'rgba(6,12,20,0.8)',
    plateText: '#e2ecf7',
    contrast: '#050a10',
    accent: '#3ec7ff',
    neutral: '#8299b2',
    selection: '#3ec7ff',
    marquee: '#3ec7ff',
    marqueeFill: 'rgba(62,199,255,0.12)',
  },
  dawn: {
    sheet: '#f7f4ee',
    border: '#b5aa96',
    grid: '#6e6455',
    gridLabel: '#574d40',
    plate: 'rgba(250,247,241,0.88)',
    plateText: '#2a241d',
    contrast: '#f5f1ea',
    accent: '#c4572e',
    neutral: '#7a7062',
    selection: '#c4572e',
    marquee: '#c4572e',
    marqueeFill: 'rgba(196,87,46,0.12)',
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
