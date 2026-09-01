import { memo, useMemo } from 'react';
import { Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva';
import type { GameMap, MapViewConfig } from '@/types/model';
import { columnLabel } from '@/lib/util';

interface Props {
  map: GameMap | null;
  view: MapViewConfig;
  image: HTMLImageElement | null;
  /** World extent used when no map is assigned yet. */
  fallbackWidth: number;
  fallbackHeight: number;
}

/**
 * Map image, grid and coordinate labels.
 *
 * Everything here is inert (`listening={false}`) so pointer events always
 * reach the tactical objects above it, and it lives on its own Konva layer
 * because it only changes when the map or its grid settings change.
 */
export const MapBackground = memo(function MapBackground({ map, view, image, fallbackWidth, fallbackHeight }: Props) {
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
      <Rect x={0} y={0} width={w} height={h} fill="#0e1620" />

      {image && <KonvaImage image={image} x={0} y={0} width={w} height={h} opacity={view.mapOpacity} />}

      {grid && (
        <Group opacity={view.gridOpacity}>
          {grid.vertical.map((pts, i) => (
            <Line key={`v${i}`} points={pts} stroke="#9fb4c8" strokeWidth={w * 0.0004} />
          ))}
          {grid.horizontal.map((pts, i) => (
            <Line key={`h${i}`} points={pts} stroke="#9fb4c8" strokeWidth={w * 0.0004} />
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
              fill="#c8d6e5"
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
              fill="#c8d6e5"
            />
          ))}
        </Group>
      )}

      {view.showBorder && (
        <Rect x={0} y={0} width={w} height={h} stroke="#4b6076" strokeWidth={w * 0.0009} />
      )}
    </Group>
  );
});
