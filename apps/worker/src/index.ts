import { createApp } from './app';
import { runCleanup } from './cron';
import type { Env } from './env';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, executionContext): Promise<void> {
    executionContext.waitUntil(runCleanup(env));
  },
} satisfies ExportedHandler<Env>;
