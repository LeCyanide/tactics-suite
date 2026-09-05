import { memo, useMemo } from 'react';
import { Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva';
import type { GameMap, MapViewConfig } from '@/types/model';
import { columnLabel } from '@/lib/util';
import type { CanvasTheme } from '@/state/theme';

interface Props {
  map: GameMap | null;
  view: MapViewConfig;
  image: HTMLImageElement | null;
  /** Why the map's image could not be read, once the retries are spent. */
  imageError?: string | null;
  /** World extent used when no map is assigned yet. */
  fallbackWidth: number;
  fallbackHeight: number;
  /**
   * Canvas palette. Passed in rather than read from a module global so that
   * switching theme invalidates this component's memo and repaints the map.
   */
  theme: CanvasTheme;
}

/**
 * Map image, grid and coordinate labels.
 *
 * Everything here is inert (`listening={false}`) so pointer events always
 * reach the tactical objects above it, and it lives on its own Konva layer
 * because it only changes when the map or its grid settings change.
 */
export const MapBackground = memo(function MapBackground({
  map,
  view,
  image,
  imageError,
  fallbackWidth,
  fallbackHeight,
  theme,
}: Props) {
  const w = map?.widthMeters ?? fallbackWidth;
  const h = map?.heightMeters ?? fallbackHeight;
  const cols = view.gridCols ?? map?.gridCols ?? 10;
  const rows = view.gridRows ?? map?.gridRows ?? 10;

  const grid = useMemo(() => {
    if (!view.showGrid) return null;
    const vertical: number[][] = [];
    const horizontal: number[][] = [];
    for (let c = 1; c < cols; c++) {
      const x = (w / cols) * c;
      vertical.push([x, 0, x, h]);
    }
    for (let r = 1; r < rows; r++) {
      const y = (h / rows) * r;
      horizontal.push([0, y, w, y]);
    }
    return { vertical, horizontal };
  }, [view.showGrid, cols, rows, w, h]);

  const cellW = w / cols;
  const cellH = h / rows;
  const labelSize = Math.min(cellW, cellH) * 0.16;

  return (
    <Group listening={false}>
      {/* Sea backdrop so an unassigned map still looks intentional */}
      <Rect x={0} y={0} width={w} height={h} fill={theme.sheet} />

      {image && <KonvaImage image={image} x={0} y={0} width={w} height={h} opacity={view.mapOpacity} />}

      {/*
        A map whose image would not load draws the same empty sheet as a map
        that has no image, and the two are worth telling apart: the first is a
        fault to go and fix, the second is just an unassigned page. Say so on
        the sheet rather than leaving open water to be read as the terrain.
      */}
      {!image && imageError && (
        <Text
          text={`Map image could not be loaded
${imageError}`}
          x={0}
          y={h / 2 - labelSize}
          width={w}
          align="center"
          lineHeight={1.6}
          fontSize={labelSize * 0.6}
          fontFamily="JetBrains Mono, Consolas, monospace"
          fill={theme.gridLabel}
        />
      )}

      {grid && (
        <Group opacity={view.gridOpacity}>
          {grid.vertical.map((pts, i) => (
            <Line key={`v${i}`} points={pts} stroke={theme.grid} strokeWidth={w * 0.0004} />
          ))}
          {grid.horizontal.map((pts, i) => (
            <Line key={`h${i}`} points={pts} stroke={theme.grid} strokeWidth={w * 0.0004} />
          ))}
        </Group>
      )}

      {view.showCoordinates && (
        <Group opacity={0.55}>
          {Array.from({ length: cols }, (_, c) => (
            <Text
              key={`c${c}`}
              text={columnLabel(c)}
              x={cellW * c}
              y={labelSize * 0.35}
              width={cellW}
              align="center"
              fontSize={labelSize}
              fontFamily="JetBrains Mono, Consolas, monospace"
              fill={theme.gridLabel}
            />
          ))}
          {Array.from({ length: rows }, (_, r) => (
            <Text
              key={`r${r}`}
              text={String(r + 1)}
              x={labelSize * 0.35}
              y={cellH * r + cellH / 2 - labelSize * 0.6}
              fontSize={labelSize}
              fontFamily="JetBrains Mono, Consolas, monospace"
              fill={theme.gridLabel}
            />
          ))}
        </Group>
      )}

      {view.showBorder && (
        <Rect x={0} y={0} width={w} height={h} stroke={theme.border} strokeWidth={w * 0.0009} />
      )}
    </Group>
  );
});
