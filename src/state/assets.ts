/**
 * Image asset cache.
 *
 * Map backgrounds and ship icons live on disk; they are pulled through IPC as
 * data URLs and then kept as decoded HTMLImageElements. Data URLs (rather
 * than a custom protocol) keep the export canvas untainted, so `toDataURL`
 * works for image export.
 *
 * Reads can fail transiently (an import rewriting the store, a sync client
 * holding the file, a slow disk). A failed read is retried a few times. If it
 * still fails, the reason goes to the caller instead of a bare null, so a
 * broken image can be told apart from no image.
 */

import { useEffect, useState } from 'react';

type Kind = 'map' | 'icon';

/** How hard to try before a read is called a failure, and how long between. */
const ATTEMPTS = 3;
const RETRY_MS = 250;

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();
const failures = new Map<string, string>();
const listeners = new Set<() => void>();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function key(kind: Kind, file: string): string {
  return `${kind}:${file}`;
}

export function getCachedAsset(kind: Kind, file?: string | null): HTMLImageElement | null {
  if (!file) return null;
  return cache.get(key(kind, file)) ?? null;
}

/** Why the last attempt at this asset failed, if it did. */
export function getAssetError(kind: Kind, file?: string | null): string | null {
  if (!file) return null;
  return failures.get(key(kind, file)) ?? null;
}

async function fetchOnce(kind: Kind, file: string, mime: string): Promise<HTMLImageElement> {
  const res =
    kind === 'map' ? await window.api.maps.dataUrl(file, mime) : await window.api.icons.dataUrl(file, mime);
  // A build older than this one answered with the data URL itself.
  const asResult = typeof res === 'string' ? { dataUrl: res } : (res ?? { error: 'no answer', code: 'EMPTY' });
  if (!('dataUrl' in asResult)) throw new Error(asResult.error);
  const img = await decode(asResult.dataUrl);
  if (!img) throw new Error('the image could not be decoded');
  return img;
}

export function loadAsset(kind: Kind, file: string, mime: string): Promise<HTMLImageElement | null> {
  const k = key(kind, file);
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(k);
  if (inflight) return inflight;

  const task = (async () => {
    let last = 'unknown';
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const img = await fetchOnce(kind, file, mime);
        cache.set(k, img);
        failures.delete(k);
        listeners.forEach((fn) => fn());
        return img;
      } catch (err: any) {
        last = String(err?.message ?? err);
        if (attempt < ATTEMPTS) await wait(RETRY_MS * attempt);
      }
    }
    // Only a settled failure is recorded, and never in `cache`: the next
    // component to ask starts the attempts again, so a file that comes back
    // is picked up without restarting the application.
    failures.set(k, last);
    console.error(`[assets] ${kind} ${file}: ${last}`);
    listeners.forEach((fn) => fn());
    return null;
  })().finally(() => pending.delete(k));

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

/**
 * Subscribes a component to one asset; re-renders when it finishes decoding.
 *
 * `error` is set only once the retries above are spent, and only for a file
 * that was actually asked for -- a record with no image at all reports
 * neither an image nor an error.
 */
export function useAssetState(
  kind: Kind,
  file?: string | null,
  mime = '',
): { image: HTMLImageElement | null; error: string | null } {
  const [state, setState] = useState<{ image: HTMLImageElement | null; error: string | null }>(() => ({
    image: getCachedAsset(kind, file),
    error: getAssetError(kind, file),
  }));

  useEffect(() => {
    let alive = true;
    if (!file) {
      setState({ image: null, error: null });
      return;
    }
    const hit = getCachedAsset(kind, file);
    if (hit) {
      setState({ image: hit, error: null });
      return;
    }
    setState({ image: null, error: null });
    void loadAsset(kind, file, mime).then((loaded) => {
      if (alive) setState({ image: loaded, error: loaded ? null : getAssetError(kind, file) });
    });
    return () => {
      alive = false;
    };
  }, [kind, file, mime]);

  return state;
}

/** The image alone, for the callers that have nothing to say about a failure. */
export function useAsset(kind: Kind, file?: string | null, mime = ''): HTMLImageElement | null {
  return useAssetState(kind, file, mime).image;
}

/** Warms the cache for a batch of icons so the canvas does not pop in. */
export async function preloadIcons(icons: { file: string; mime: string }[]): Promise<void> {
  await Promise.all(icons.map((i) => loadAsset('icon', i.file, i.mime)));
}

export function onAssetLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
