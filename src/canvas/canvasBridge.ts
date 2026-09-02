import type { Vec2 } from '@/types/model';

export interface ExportOptions {
  background: boolean;
  grid: boolean;
  caps: boolean;
  ships: boolean;
  ranges: boolean;
  annotations: boolean;
  layerNames: boolean;
  /** Target width of the exported image in pixels. */
  width: number;
  format: 'png' | 'jpg';
  quality: number;
}

export const DEFAULT_EXPORT: ExportOptions = {
  background: true,
  grid: true,
  caps: true,
  ships: true,
  ranges: true,
  annotations: true,
  layerNames: false,
  width: 2560,
  format: 'png',
  quality: 0.92,
};

export interface CanvasApi {
  /** Re-centres and re-fits the map. The camera has no other state. */
  fit(): void;
  screenToWorld(p: Vec2): Vec2;
  worldToScreen(p: Vec2): Vec2;
  exportImage(opts: ExportOptions): Promise<string | null>;
  /** Camera scale at which the whole map exactly fills the viewport. */
  fitScale(): number;
  /** Viewport size in screen pixels. */
  viewport(): { width: number; height: number };
  /** Map extent in metres for the current page. */
  worldSize(): { width: number; height: number };
}

/**
 * A tiny imperative escape hatch so toolbars, the status bar and the export
 * dialog can drive the canvas without threading refs through the whole tree.
 */
let api: CanvasApi | null = null;

export function setCanvasApi(next: CanvasApi | null): void {
  api = next;
}

export function canvasApi(): CanvasApi | null {
  return api;
}
