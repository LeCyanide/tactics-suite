/**
 * Image asset cache.
 *
 * Map backgrounds and ship icons live on disk; they are pulled through IPC as
 * data URLs exactly once and then kept as decoded HTMLImageElements. Data URLs
 * (rather than a custom protocol) keep the export canvas untainted, so
 * `toDataURL` works for image export.
 */

import { useEffect, useState } from 'react';

type Kind = 'map' | 'icon';

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();
const listeners = new Set<() => void>();

function key(kind: Kind, file: string): string {
  return `${kind}:${file}`;
}

export function getCachedAsset(kind: Kind, file?: string | null): HTMLImageElement | null {
  if (!file) return null;
  return cache.get(key(kind, file)) ?? null;
}

export function loadAsset(kind: Kind, file: string, mime: string): Promise<HTMLImageElement | null> {
  const k = key(kind, file);
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(k);
  if (inflight) return inflight;

  const task = (async () => {
    const dataUrl =
      kind === 'map' ? await window.api.maps.dataUrl(file, mime) : await window.api.icons.dataUrl(file, mime);
    if (!dataUrl) return null;
    const img = await decode(dataUrl);
    if (img) {
      cache.set(k, img);
      listeners.forEach((fn) => fn());
    }
    return img;
  })()
    .catch(() => null)
    .finally(() => pending.delete(k));

  pending.set(k, task);
  return task;
}

function decode(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Subscribes a component to one asset; re-renders when it finishes decoding. */
export function useAsset(kind: Kind, file?: string | null, mime = ''): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(() => getCachedAsset(kind, file));

  useEffect(() => {
    let alive = true;
    if (!file) {
      setImg(null);
      return;
    }
    const hit = getCachedAsset(kind, file);
    if (hit) {
      setImg(hit);
      return;
    }
    void loadAsset(kind, file, mime).then((loaded) => {
      if (alive) setImg(loaded);
    });
    return () => {
      alive = false;
    };
  }, [kind, file, mime]);

  return img;
}

/** Warms the cache for a batch of icons so the canvas does not pop in. */
export async function preloadIcons(icons: { file: string; mime: string }[]): Promise<void> {
  await Promise.all(icons.map((i) => loadAsset('icon', i.file, i.mime)));
}

export function onAssetLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
