import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
