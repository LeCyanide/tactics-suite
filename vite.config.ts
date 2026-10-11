import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

// Update server and token, and the clan bot's address, baked into the main
// process at build time. They come from the untracked .env.release (see
// .env.release.example); without it the build simply has no updater and no
// Connect Discord.
const release = loadEnv('release', __dirname, ['UPDATE_', 'BOT_']);

export default defineConfig({
  // Relative base so the production build loads from file:// inside Electron.
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          define: {
            __UPDATE_URL__: JSON.stringify(release.UPDATE_URL ?? ''),
            __UPDATE_TOKEN__: JSON.stringify(release.UPDATE_TOKEN ?? ''),
            __BOT_URL__: JSON.stringify(release.BOT_URL ?? ''),
          },
        },
      },
      preload: { input: path.join(__dirname, 'electron/preload.ts') },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // Loopback only: the dev server has no business being reachable from the
    // network, and binding to 127.0.0.1 avoids a Windows Firewall prompt.
    host: '127.0.0.1',
    port: 5599,
    strictPort: false,
  },
});
