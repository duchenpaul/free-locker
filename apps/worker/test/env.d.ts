import type { D1Migration } from '@cloudflare/vitest-plugin/config';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    TEST_MIGRATIONS: D1Migration[];
  }
}
