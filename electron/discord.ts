/**
 * This copy of the app's link to a Discord account, for Share to Discord.
 *
 * Besides the updater this is the only module that talks to the network, and
 * only to the clan bot baked in at build time (BOT_URL in .env.release).
 *
 * Linking is the sign-in people know from other apps: Connect Discord opens
 * the browser on Discord's own consent page, and nothing is typed in here.
 * The bot runs that exchange, because it needs the application's client
 * secret, and hands the result back by redirecting the browser to a port this
 * process is listening on. A loopback redirect means whoever approved is
 * sitting at this machine, and the verifier below means only this process can
 * redeem what came back.
 *
 * The token that results stands for one person: the bot posts only where that
 * member could post themselves. It never reaches the renderer, and it is kept
 * encrypted with the operating system's own store.
 */

import { safeStorage, shell } from 'electron';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { readJson, storageRoot, writeJson } from './storage/db';

declare const __BOT_URL__: string;

export interface DiscordUser {
  id: string;
  name: string;
}

export interface DiscordChannel {
  id: string;
  name: string;
  category: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  channels: DiscordChannel[];
}

export type DiscordStatus =
  | { status: 'unavailable' }
  | { status: 'unlinked' }
  /** `error` is set when the bot could not be asked what this account may post in. */
  | { status: 'linked'; user: DiscordUser; guilds: DiscordGuild[]; error?: string };

interface StoredLink {
  token: string;
  /** False only where the system has no store to encrypt with. */
  encrypted: boolean;
  user: DiscordUser;
}

/** Long enough to sign in to Discord in the browser first, if need be. */
const LINK_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const UNREACHABLE = 'The clan bot could not be reached.';
const LINK_GONE = 'Discord is no longer connected. Connect it again in Settings.';

const FAILURES: Record<string, string> = {
  denied: 'The Discord sign-in was cancelled.',
  not_member: 'That Discord account is not in a server the clan bot is in.',
  discord: 'Discord did not complete the sign-in. Try again.',
};

const botUrl = __BOT_URL__.replace(/\/+$/, '');
const linkFile = () => path.join(storageRoot(), 'discord-link.json');

/** Ends the sign-in that is waiting on the browser, if one is. */
let abandon: ((reason: Error) => void) | null = null;

async function readLink(): Promise<{ token: string; user: DiscordUser } | null> {
  const stored = await readJson<StoredLink | null>(linkFile(), null);
  if (!stored?.token || !stored.user) return null;
  if (!stored.encrypted) return { token: stored.token, user: stored.user };
  try {
    return { token: safeStorage.decryptString(Buffer.from(stored.token, 'base64')), user: stored.user };
  } catch {
    // Encrypted under another Windows account or machine: a copied data
    // folder. It cannot be read here, so it is as good as not linked.
    return null;
  }
}

async function writeLink(token: string, user: DiscordUser): Promise<void> {
  const encrypted = safeStorage.isEncryptionAvailable();
  const stored: StoredLink = {
    token: encrypted ? safeStorage.encryptString(token).toString('base64') : token,
    encrypted,
    user,
  };
  await writeJson(linkFile(), stored);
}

async function forgetLink(): Promise<void> {
  await fsp.rm(linkFile(), { force: true });
}

/** A request to the bot. A failure to get any answer reads the same every time. */
async function ask(route: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
  try {
    return await fetch(`${botUrl}${route}`, { ...init, signal: AbortSignal.timeout(init.timeout ?? REQUEST_TIMEOUT_MS) });
  } catch {
    throw new Error(UNREACHABLE);
  }
}

export async function status(): Promise<DiscordStatus> {
  if (!botUrl) return { status: 'unavailable' };

  const link = await readLink();
  if (!link) return { status: 'unlinked' };

  let response: Response;
  try {
    response = await ask('/link/me', { headers: { authorization: `Bearer ${link.token}` } });
  } catch (err) {
    return { status: 'linked', user: link.user, guilds: [], error: (err as Error).message };
  }

  // Unlinked from the bot's side, or the bot's database was replaced.
  if (response.status === 401) {
    await forgetLink();
    return { status: 'unlinked' };
  }
  if (!response.ok) return { status: 'linked', user: link.user, guilds: [], error: UNREACHABLE };

  const body = (await response.json()) as { user: DiscordUser; guilds: DiscordGuild[] };
  return { status: 'linked', user: body.user, guilds: body.guilds };
}

/** What the browser shows once it has been sent back here. */
function page(heading: string, text: string): string {
  return (
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>WoWs Tactics Suite</title><body style="font:16px system-ui;background:#0d1117;color:#e6edf3;' +
    'display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:28em;padding:24px">' +
    `<h1 style="font-size:20px">${heading}</h1><p style="color:#9aa7b4">${text}</p></main>`
  );
}

/**
 * Runs the sign-in: opens the browser, waits for it to come back, and stores
 * the token. Rejects with a sentence fit to show if it does not end in a link.
 */
export async function link(): Promise<DiscordStatus> {
  if (!botUrl) throw new Error('This build has no clan bot to connect to.');
  abandon?.(new Error('Another sign-in was started.'));

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  let timer: NodeJS.Timeout | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The Discord sign-in timed out.')), LINK_TIMEOUT_MS);
      abandon = reject;

      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (request.method !== 'GET' || url.pathname !== '/callback') {
          response.writeHead(404).end();
          return;
        }

        const answer = (heading: string, text: string) => {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
          response.end(page(heading, text));
        };

        void (async () => {
          const error = url.searchParams.get('error');
          const grant = url.searchParams.get('grant');
          if (error || !grant) throw new Error(FAILURES[error ?? ''] ?? FAILURES.discord);

          const finish = await ask('/link/finish', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ grant, verifier }),
          });
          if (!finish.ok) throw new Error(FAILURES.discord);

          const body = (await finish.json()) as { token: string; user: DiscordUser };
          await writeLink(body.token, body.user);
        })().then(
          () => {
            answer('Discord is connected', 'You can close this tab and go back to WoWs Tactics Suite.');
            resolve();
          },
          (err: Error) => {
            answer('Discord was not connected', `${err.message} You can close this tab.`);
            reject(err);
          },
        );
      });

      void shell.openExternal(`${botUrl}/link/start?port=${port}&challenge=${challenge}`).catch(() => {
        reject(new Error('The browser could not be opened.'));
      });
    });
  } finally {
    clearTimeout(timer);
    abandon = null;
    server.close();
    // The page has been answered; do not let a keep-alive hold the port open.
    setTimeout(() => server.closeAllConnections(), 1000).unref();
  }

  return status();
}

export function cancelLink(): void {
  abandon?.(new Error('The Discord sign-in was cancelled.'));
}

export async function unlink(): Promise<DiscordStatus> {
  const stored = await readLink();
  if (stored && botUrl) {
    // Best effort: if the bot cannot be told, the token is forgotten here
    // anyway and nothing else holds a copy.
    await ask('/link/revoke', { method: 'POST', headers: { authorization: `Bearer ${stored.token}` } }).catch(
      () => undefined,
    );
  }
  await forgetLink();
  return botUrl ? { status: 'unlinked' } : { status: 'unavailable' };
}

/**
 * Push a rendered page to the bot's plan endpoint.
 *
 * The bot runs on a server and cannot reach the project store on this
 * machine, so sharing is a push from here rather than a fetch from there.
 */
export async function share(opts: { channelId: string; title: string; note?: string; image: string }): Promise<string | null> {
  const stored = botUrl ? await readLink() : null;
  if (!stored) throw new Error(LINK_GONE);

  const response = await ask('/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${stored.token}` },
    body: JSON.stringify({ channelId: opts.channelId, title: opts.title, note: opts.note, image: opts.image }),
    timeout: 30_000,
  });

  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };

  if (response.status === 401) {
    await forgetLink();
    throw new Error(LINK_GONE);
  }
  if (!response.ok) throw new Error(body.error ?? `the bot answered ${response.status}`);

  return body.url ?? null;
}
