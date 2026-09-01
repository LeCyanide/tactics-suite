import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

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
      main: { entry: 'electron/main.ts' },
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
