import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// The web app lives in /web and builds into /dist (served by Vercel as static
// output). In dev, /api is proxied to the local NestJS server on :3001.
export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  server: {
    port: 5173,
    // host:true binds 0.0.0.0 so the dev server is reachable from the host
    // when running inside Docker (harmless for plain local dev).
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, '..', 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
