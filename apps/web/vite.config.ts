import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@free-locker/shared': path.resolve(
        import.meta.dirname,
        '../../packages/shared/src/index.ts',
      ),
    },
  },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${process.env.WORKER_PORT ?? 8787}`,
      '/': {
        target: `http://127.0.0.1:${process.env.WORKER_PORT ?? 8787}`,
        bypass(request) {
          if (request.method === 'GET' || request.method === 'HEAD') {
            return request.url;
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
