import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { runCleanup } from '../src/cron';
import type { Env } from '../src/env';

const app = createApp();

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const context = createExecutionContext();
  const response = await app.fetch(new Request(input, init), env as unknown as Env, context);
  await waitOnExecutionContext(context);
  return response;
}

async function upload(
  filename: string,
  clientIp?: string,
): Promise<{ downloadUrl: string; id: string }> {
  const response = await request('http://free-locker.test/', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': '4',
      'Content-Type': 'text/plain',
      ...(clientIp === undefined ? {} : { 'cf-connecting-ip': clientIp }),
    },
    body: 'data',
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ downloadUrl: string; id: string }>;
}

describe('operations controls', () => {
  it('accepts a public abuse report without granting deletion authority', async () => {
    const response = await request('http://free-locker.test/api/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: 'example-public-id',
        reason: 'This transfer contains material that should be reviewed.',
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true });
  });

  it('requires an operator secret to revoke and immediately blocks the share', async () => {
    const uploaded = await upload('revoke-me.txt');
    const unauthenticated = await request(
      `http://free-locker.test/api/v1/admin/files/${uploaded.id}/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Verified abuse report' }),
      },
    );
    expect(unauthenticated.status).toBe(401);

    const revoked = await request(
      `http://free-locker.test/api/v1/admin/files/${uploaded.id}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-operator-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Verified abuse report' }),
      },
    );
    expect(revoked.status).toBe(200);

    const unavailable = await request(uploaded.downloadUrl, {
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    });
    expect(unavailable.status).toBe(410);
    expect(await unavailable.json()).toMatchObject({
      error: { code: 'FILE_REVOKED' },
      success: false,
    });
  });

  it('returns a rate-limit error after the configured hourly quota', async () => {
    const clientIp = '203.0.113.99';
    for (let index = 0; index < 20; index += 1) {
      await upload(`quota-${index}.txt`, clientIp);
    }
    const response = await request('http://free-locker.test/', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Disposition': 'attachment; filename="third.txt"',
        'Content-Length': '4',
        'cf-connecting-ip': clientIp,
      },
      body: 'data',
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: 'RATE_LIMITED' },
      success: false,
    });
  });

  it('physically deletes an expired object during the bounded cleanup pass', async () => {
    const uploaded = await upload('expired.txt', '198.51.100.22');
    const row = await env.DB.prepare(`SELECT object_key FROM files WHERE public_id = ?`)
      .bind(uploaded.id)
      .first<{ object_key: string }>();
    expect(row).not.toBeNull();
    expect(await env.FILES_BUCKET.head(row?.object_key ?? '')).not.toBeNull();

    await env.DB.prepare(`UPDATE files SET expires_at = ? WHERE public_id = ?`)
      .bind('2000-01-01T00:00:00.000Z', uploaded.id)
      .run();
    await runCleanup(env as unknown as Env);

    expect(await env.FILES_BUCKET.head(row?.object_key ?? '')).toBeNull();
    const deleted = await env.DB.prepare(
      `SELECT lifecycle_status, deleted_at FROM files WHERE public_id = ?`,
    )
      .bind(uploaded.id)
      .first<{ deleted_at: string | null; lifecycle_status: string }>();
    expect(deleted).toMatchObject({ lifecycle_status: 'deleted' });
    expect(deleted?.deleted_at).not.toBeNull();
  });
});
