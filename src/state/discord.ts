import { useEffect, useSyncExternalStore } from 'react';
import type { DiscordBot, DiscordChannel, DiscordGuild, DiscordStatus } from '../../electron/preload';
import { useStore } from './store';

export type { DiscordBot, DiscordChannel, DiscordGuild, DiscordStatus };

/**
 * Which Discord account this copy is connected to, and where it may post.
 *
 * Shared between Settings, which changes it, and the export dialog, which
 * only needs to know whether Share to Discord can work. Null until asked.
 */
let current: DiscordStatus | null = null;
let linking = false;
/** Set when the person gave up on a sign-in themselves: nothing to report. */
let cancelled = false;
const listeners = new Set<() => void>();

function publish(next: DiscordStatus | null, busy = linking): void {
  current = next;
  linking = busy;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshDiscord(): Promise<void> {
  try {
    publish(await window.api.discord.status());
  } catch {
    /* keep whatever was known */
  }
}

/** The connection, asked for afresh whenever something starts showing it. */
export function useDiscord(): { discord: DiscordStatus | null; linking: boolean } {
  const discord = useSyncExternalStore(subscribe, () => current);
  const busy = useSyncExternalStore(subscribe, () => linking);
  useEffect(() => {
    void refreshDiscord();
  }, []);
  return { discord, linking: busy };
}

/** Opens Discord's sign-in in the browser and waits for it to come back. */
export async function connectDiscord(): Promise<void> {
  const s = useStore.getState();
  cancelled = false;
  publish(current, true);
  try {
    const linked = await window.api.discord.link();
    publish(linked, false);
    if (linked.status === 'linked') s.toast(`Connected to Discord as ${linked.user.name}`, 'success');
  } catch (err) {
    publish(current, false);
    if (!cancelled) s.toast((err as Error).message, 'error');
  }
}

export function cancelConnectDiscord(): void {
  cancelled = true;
  void window.api.discord.cancelLink();
}

export async function disconnectDiscord(): Promise<void> {
  try {
    publish(await window.api.discord.unlink());
  } catch (err) {
    useStore.getState().toast((err as Error).message, 'error');
  }
}

/** The channel a stored id names, if this account can still post there. */
export function findChannel(discord: DiscordStatus | null, id: string): DiscordChannel | null {
  if (discord?.status !== 'linked') return null;
  for (const guild of discord.guilds) {
    const channel = guild.channels.find((c) => c.id === id);
    if (channel) return channel;
  }
  return null;
}

/**
 * Points this copy at another bot, or back at the built-in one with an empty
 * address. Throws a sentence fit to show when the address is not a bot.
 * Switching disconnects, so the connection is asked for again afterwards.
 */
export async function setDiscordBot(url: string): Promise<DiscordBot> {
  const bot = await window.api.discord.setBot(url.trim() === '' ? null : url);
  await refreshDiscord();
  return bot;
}
