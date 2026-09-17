/**
 * Vite config for the replay layer harness.
 *
 * Separate from the application config because that one starts Electron: the
 * whole point here is a plain browser page with nothing else running.
 *
 * Two endpoints stand in for what the app would supply through IPC — the baked
 * timeline named on the command line, and the map image out of `seed/`, looked
 * up by the space name the timeline itself carries. Serving the real seeded
 * image is what makes this a coordinate check and not just a shape check.
 */

import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = path.resolve(__dirname, '..');

/**
 * Set by `scripts/dev-replay.mjs`. Not read from argv: vite's CLI treats its
 * first positional argument as the project root, so a path passed there would
 * quietly reroot the server at a replay file.
 */
const timelineFile = process.env.REPLAY_TIMELINE ?? '';

function fixtures(): Plugin {
  return {
    name: 'replay-preview-fixtures',
    configureServer(server) {
      server.middlewares.use('/__timeline', (_req, res) => {
        if (!timelineFile || !fs.existsSync(timelineFile)) {
          res.statusCode = 404;
          res.end(
            `No timeline. Pass one:\n  npm run dev:replay -- <file.wtreply>\n\nBake one with:\n  sidecar\\target\\release\\wows-replay-sidecar.exe bake --game <dir> --replay <file> --out <file.wtreply>\n\nLooked for: ${timelineFile || '(nothing given)'}`,
          );
          return;
        }
        res.setHeader('content-type', 'application/octet-stream');
        res.end(fs.readFileSync(timelineFile));
      });

      server.middlewares.use('/__map', (req, res) => {
        const space = new URL(req.url ?? '', 'http://x').searchParams.get('space') ?? '';
        try {
          const maps = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'maps', 'maps.json'), 'utf8'));
          const list: any[] = Array.isArray(maps) ? maps : (maps.maps ?? []);
          // Prefer a live map over an archived stand-in, which carries a cap
          // layout burned into the artwork and would confuse the overlay.
          const match =
            list.find((m) => m.spaceName === space && !m.archived) ?? list.find((m) => m.spaceName === space);
          if (!match) {
            res.statusCode = 404;
            res.end(`no seeded map for ${space}`);
            return;
          }
          res.setHeader('content-type', match.mime ?? 'image/png');
          res.end(fs.readFileSync(path.join(root, 'seed', 'maps', 'assets', match.file)));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    },
  };
}

export default defineConfig({
  root,
  resolve: { alias: { '@': path.join(root, 'src') } },
  plugins: [react(), fixtures()],
  server: { host: '127.0.0.1', port: 5601, strictPort: false, open: '/dev/replay-preview.html' },
});
