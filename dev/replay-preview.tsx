/**
 * Dev harness for the replay layer.
 *
 *   npm run dev:replay -- <path to a .wtreply>
 *
 * Renders `ReplayLayer` over the real map image on a bare Konva stage, with a
 * scrubber and the view toggles. Nothing else from the application is involved:
 * no store, no Electron, no project — so what shows up here is the layer's own
 * behaviour and nothing else.
 *
 * This exists because the layer's two hardest properties are visual. Whether a
 * ship sits on water rather than in a hillside, and whether it points where it
 * was actually going, are questions a typecheck cannot answer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image as KonvaImage, Layer, Rect, Stage } from 'react-konva';
import { DEFAULT_REPLAY_VIEW, ReplayLayer, type ReplayViewOptions } from '@/canvas/ReplayLayer';
import { ReplayTimeline } from '@/replay/timeline';
import { SPEEDS } from '@/state/replay';
import type { GameMap } from '@/types/model';

/** Stage edge in screen pixels. `?size=N` fits it to a smaller window. */
const SIZE = Number(new URLSearchParams(location.search).get('size') ?? 0) || 820;

const params = new URLSearchParams(location.search);
/** ?frame=N opens on a given frame. Frame 0 is before the ships spawn. */
const START_FRAME = Number(params.get('frame') ?? 0) || 0;
/** ?off=shipNames,capturePoints opens with those toggles cleared. */
const OFF = (params.get('off') ?? '').split(',').filter(Boolean);
/** ?nomap hides the map image, to check the marks against a flat background. */
const NO_MAP = params.has('nomap');

function useImage(src: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = src;
  }, [src]);
  return image;
}

function App() {
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(START_FRAME);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [options, setOptions] = useState<ReplayViewOptions>(() => {
    const next = { ...DEFAULT_REPLAY_VIEW };
    for (const key of OFF) if (key in next) next[key as keyof ReplayViewOptions] = false;
    return next;
  });
  const raf = useRef(0);
  const last = useRef(0);
  const carry = useRef(0);

  useEffect(() => {
    fetch('/__timeline')
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.arrayBuffer();
      })
      .then((buf) => setTimeline(new ReplayTimeline(buf)))
      .catch((err: Error) => setError(err.message));
  }, []);

  const mapMeta = useMemo<GameMap | null>(() => {
    if (!timeline) return null;
    const metres = timeline.spaceSize * 30;
    return {
      id: 'preview',
      name: timeline.header.map?.displayName ?? 'map',
      file: '',
      mime: 'image/png',
      pixelWidth: 760,
      pixelHeight: 760,
      widthMeters: metres,
      heightMeters: metres,
      gridCols: 10,
      gridRows: 10,
      addedAt: 0,
      updatedAt: 0,
    };
  }, [timeline]);

  const image = useImage(timeline ? `/__map?space=${encodeURIComponent(timeline.header.map?.name ?? '')}` : null);

  // The stage shows the whole map, exactly as the real canvas does.
  const world = mapMeta?.widthMeters ?? 42000;
  const scale = SIZE / world;

  // Playback advances by wall-clock time, so the scrubber matches the battle
  // clock rather than drifting with the frame rate of the browser.
  const tick = useCallback(
    (now: number) => {
      raf.current = requestAnimationFrame(tick);
      if (!timeline) return;
      const dt = last.current ? (now - last.current) / 1000 : 0;
      last.current = now;
      carry.current += dt * speed * timeline.fps;
      const step = Math.floor(carry.current);
      if (step > 0) {
        carry.current -= step;
        setFrame((f) => {
          const next = f + step;
          if (next >= timeline.frameCount) {
            setPlaying(false);
            return timeline.frameCount - 1;
          }
          return next;
        });
      }
    },
    [timeline, speed],
  );

  useEffect(() => {
    if (!playing) {
      last.current = 0;
      carry.current = 0;
      return;
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, tick]);

  if (error) return <pre style={{ color: '#ff8080', padding: 20 }}>{error}</pre>;
  if (!timeline || !mapMeta) return <p style={{ color: '#8aa', padding: 20 }}>Loading timeline…</p>;

  const clock = timeline.clockAt(frame);
  const mmss = `${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, color: '#cbd5e1', fontFamily: 'system-ui' }}>
      <div>
        <Stage width={SIZE} height={SIZE} scaleX={scale} scaleY={scale}>
          <Layer listening={false}>
            <Rect x={0} y={0} width={world} height={world} fill="#0b1622" />
            {image && !NO_MAP && <KonvaImage image={image} x={0} y={0} width={world} height={world} />}
          </Layer>
          <Layer listening={false}>
            <ReplayLayer
              timeline={timeline}
              frame={frame}
              map={mapMeta}
              options={options}
              inv={1 / scale}
              opacity={1}
            />
          </Layer>
        </Stage>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button onClick={() => setPlaying((p) => !p)} style={{ width: 70 }}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <input
            type="range"
            min={0}
            max={timeline.frameCount - 1}
            value={frame}
            onChange={(e) => {
              setPlaying(false);
              setFrame(Number(e.target.value));
            }}
            style={{ flex: 1, width: 440 }}
          />
          <code>
            {mmss} · {frame}/{timeline.frameCount - 1}
          </code>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ minWidth: 220, fontSize: 13 }}>
        <h3 style={{ margin: '0 0 8px' }}>{timeline.header.map?.displayName}</h3>
        <div style={{ opacity: 0.7, marginBottom: 12 }}>
          {timeline.header.mode?.scenario} · {timeline.header.player?.name}
          <br />
          {timeline.frameCount} frames @ {timeline.fps} fps
          <br />
          spaceSize {timeline.spaceSize} · minimap {timeline.minimapSize}
        </div>
        {(Object.keys(options) as (keyof ReplayViewOptions)[]).map((key) => (
          <label key={key} style={{ display: 'block', marginBottom: 3 }}>
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
            />{' '}
            {key}
          </label>
        ))}
        <pre style={{ marginTop: 12, opacity: 0.6, fontSize: 11 }}>
          {JSON.stringify(timeline.header.skipped, null, 1)}
        </pre>
      </div>
    </div>
  );
}

// Deliberately not inside StrictMode: its double-mount makes react-konva
// build the stage twice, which this harness has no reason to exercise.
createRoot(document.getElementById('root')!).render(<App />);
