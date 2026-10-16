import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import type { Env } from '../src/env';

describe('application routing', () => {
  it('serves the frontend asset for the browser root', async () => {
    const app = createApp();
    const assetResponse = new Response('<!doctype html><title>free-locker</title>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    const fetchAsset = vi.fn(() => Promise.resolve(assetResponse));
    const executionContext = createExecutionContext();

    const response = await app.fetch(
      new Request('https://free-locker.example/'),
      { ASSETS: { fetch: fetchAsset } } as unknown as Env,
      executionContext,
    );
    await waitOnExecutionContext(executionContext);

    expect(fetchAsset).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('free-locker');
  });
});
