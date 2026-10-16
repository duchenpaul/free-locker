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

  it('exposes configured limits through the public config endpoint', async () => {
    const app = createApp();
    const executionContext = createExecutionContext();

    const response = await app.fetch(
      new Request('https://free-locker.example/api/v1/config'),
      {
        MAX_SINGLE_UPLOAD_BYTES: '10485760',
        RETENTION_HOURS: '48',
        MAX_DOWNLOADS: '3',
      } as unknown as Env,
      executionContext,
    );
    await waitOnExecutionContext(executionContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      fileListingMode: 'disabled',
      runtimeMode: 'local',
      maxSingleUploadBytes: 10485760,
      retentionHours: 48,
      maxDownloads: 3,
    });
  });

  it('falls back to product defaults when limit variables are unset', async () => {
    const app = createApp();
    const executionContext = createExecutionContext();

    const response = await app.fetch(
      new Request('https://free-locker.example/api/v1/config'),
      {} as unknown as Env,
      executionContext,
    );
    await waitOnExecutionContext(executionContext);

    expect(await response.json()).toMatchObject({
      maxSingleUploadBytes: 99614720,
      retentionHours: 24,
      maxDownloads: 5,
    });
  });
});
