import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('../../migrations');

export default defineConfig({
  resolve: {
    alias: {
      '@free-locker/shared': path.resolve(
        import.meta.dirname,
        '../../packages/shared/src/index.ts',
      ),
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './wrangler.jsonc',
      },
      miniflare: {
        bindings: {
          ADMIN_TOKEN: 'test-operator-secret',
          TEST_MIGRATIONS: migrations,
          UPLOAD_RATE_LIMIT_PER_HOUR: '20',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
