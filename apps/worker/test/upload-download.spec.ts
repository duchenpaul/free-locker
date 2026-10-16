import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import type { Env } from '../src/env';

const app = createApp();

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const context = createExecutionContext();
  const response = await app.fetch(new Request(input, init), env as unknown as Env, context);
  await waitOnExecutionContext(context);
  return response;
}

async function requestWithEnv(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  bindings: Env,
): Promise<Response> {
  const context = createExecutionContext();
  const response = await app.fetch(new Request(input, init), bindings, context);
  await waitOnExecutionContext(context);
  return response;
}

describe('small file transfer', () => {
  it('returns a terminal-friendly help page with truthful transfer limits', async () => {
    const response = await request('http://free-locker.test/help');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const body = await response.text();
    expect(body).toContain('free-locker  -  share files straight from the command line');
    expect(body).toContain('curl http://localhost:8787 -T ./file.zip');
    expect(body).toContain('curl http://localhost:8787 --upload-file ./file.zip');
    expect(body).toContain('curl -L -O http://localhost:8787/XXXXX/file.zip');
    expect(body).toContain('Max size     95 MiB per upload');
    expect(body).toContain('default deployments do not claim malware scanning');
    expect(body).toContain('http://localhost:8787/#/abuse');
  });

  it('accepts raw uploads under the /files namespace without exposing a listing', async () => {
    const response = await request('http://free-locker.test/files/namespace.txt', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Length': '9',
        'Content-Type': 'text/plain',
      },
      body: 'namespace',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      filename: 'namespace.txt',
      success: true,
    });

    const listingResponse = await request('http://free-locker.test/files');
    expect(listingResponse.status).toBe(404);
  });

  it('accepts curl -T uploads that use the filename as the root path', async () => {
    const response = await request('http://free-locker.test/README.md', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Length': '8',
        'Content-Type': 'text/markdown',
      },
      body: '# hello\n',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ filename: 'README.md', success: true });
  });

  it('lists active files only when the configured listing mode permits it', async () => {
    const uploadResponse = await request('http://free-locker.test/', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'CF-Connecting-IP': '203.0.113.14',
        'Content-Disposition': 'attachment; filename="listed.txt"',
        'Content-Length': '6',
        'Content-Type': 'text/plain',
      },
      body: 'listed',
    });
    expect(uploadResponse.status).toBe(201);

    const enabledEnv = { ...(env as unknown as Env), FILE_LISTING_MODE: 'enabled' };
    const listingResponse = await requestWithEnv(
      'http://free-locker.test/api/v1/file_browser',
      undefined,
      enabledEnv,
    );
    expect(listingResponse.status).toBe(200);
    expect(await listingResponse.json()).toEqual(
      expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({
            downloadCount: 0,
            downloadUrl: expect.stringMatching(/\/listed\.txt$/),
            filename: 'listed.txt',
            id: expect.any(String),
            size: 6,
            uploadIp: '203.0.113.14',
          }),
        ]),
        mode: 'enabled',
        success: true,
      }),
    );

    const hiddenEnv = { ...(env as unknown as Env), FILE_LISTING_MODE: 'hidden' };
    const hiddenRouteResponse = await requestWithEnv(
      'http://free-locker.test/file_browser',
      { redirect: 'manual' },
      hiddenEnv,
    );
    expect(hiddenRouteResponse.status).toBe(302);
    expect(hiddenRouteResponse.headers.get('location')).toBe('/#/file_browser');

    const hiddenApiResponse = await requestWithEnv(
      'http://free-locker.test/api/v1/file_browser',
      undefined,
      hiddenEnv,
    );
    expect(hiddenApiResponse.status).toBe(200);
    expect(await hiddenApiResponse.json()).toMatchObject({ mode: 'hidden', success: true });

    const disabledEnv = { ...(env as unknown as Env), FILE_LISTING_MODE: 'disabled' };
    const disabledListingResponse = await requestWithEnv(
      'http://free-locker.test/api/v1/file_browser',
      undefined,
      disabledEnv,
    );
    expect(disabledListingResponse.status).toBe(404);
  });

  it('returns a sendit-style download command for a plain CLI upload', async () => {
    const response = await request('http://free-locker.test/', {
      method: 'PUT',
      headers: {
        'Content-Disposition': 'attachment; filename="plain-cli.txt"',
        'Content-Length': '29',
        'Content-Type': 'text/plain',
      },
      body: new Uint8Array(29).fill(120),
    });

    expect(response.status).toBe(201);
    expect(await response.text()).toMatch(
      /^\n=========================\n\nUploaded 1 file, 29 bytes\n\nwget http:\/\/localhost:8787\/[A-Za-z0-9_-]+\/plain-cli\.txt\n\n=========================\n$/,
    );
  });

  it('accepts the versioned browser upload endpoint', async () => {
    const response = await request('http://free-locker.test/api/v1/uploads', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Disposition': 'attachment; filename="browser.txt"',
        'Content-Length': '7',
        'Content-Type': 'text/plain',
      },
      body: 'browser',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      success: true,
      filename: 'browser.txt',
    });
  });

  it('rejects uploads above the configured size limit with 413', async () => {
    const response = await request('http://free-locker.test/api/v1/uploads', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Length': String(96 * 1024 * 1024),
        'Content-Type': 'application/octet-stream',
      },
      body: 'x',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'UPLOAD_TOO_LARGE' },
    });
  });

  it('limits a positively detected encrypted ZIP archive to one download authorization', async () => {
    const encryptedZipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x01, 0x00]);
    const uploadResponse = await request('http://free-locker.test/', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Disposition': 'attachment; filename="protected.zip"',
        'Content-Length': String(encryptedZipHeader.byteLength),
        'Content-Type': 'application/zip',
      },
      body: encryptedZipHeader,
    });

    expect(uploadResponse.status).toBe(201);
    const upload = (await uploadResponse.json()) as { id: string; remainingDownloads: number };
    expect(upload.remainingDownloads).toBe(1);

    const metadataResponse = await request(`http://free-locker.test/api/v1/files/${upload.id}`);
    expect(await metadataResponse.json()).toMatchObject({
      file: {
        encryptionStatus: 'encrypted',
        maxDownloads: 1,
        remainingDownloads: 1,
      },
      success: true,
    });
  });

  it('stores a CLI upload and serves it through a download grant', async () => {
    const uploadResponse = await request('http://free-locker.test/', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Length': '22',
        'Content-Disposition': 'attachment; filename="release notes.txt"',
        'Content-Type': 'text/plain',
      },
      body: 'hello from free-locker',
    });

    expect(uploadResponse.status).toBe(201);
    const upload = (await uploadResponse.json()) as {
      downloadUrl: string;
      filename: string;
      remainingDownloads: number;
      success: boolean;
    };
    expect(upload).toMatchObject({
      success: true,
      filename: 'release notes.txt',
      remainingDownloads: 5,
    });

    const headResponse = await request(upload.downloadUrl, { method: 'HEAD' });
    expect(headResponse.status).toBe(200);

    const shareResponse = await request(upload.downloadUrl, { redirect: 'manual' });
    expect(shareResponse.status).toBe(302);
    const grantUrl = shareResponse.headers.get('location');
    expect(grantUrl).not.toBeNull();

    const downloadResponse = await request(grantUrl as string);
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get('content-disposition')).toContain('attachment');
    expect(downloadResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new TextDecoder().decode(await downloadResponse.arrayBuffer())).toBe(
      'hello from free-locker',
    );
  });

  it('sanitizes unsafe filename input without using it as an object key', async () => {
    const response = await request('http://free-locker.test/%2E%2E%2Fprivate.txt', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Length': '6',
        'Content-Type': 'application/octet-stream',
      },
      body: 'unsafe',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      success: true,
      filename: '.._private.txt',
    });
  });
});
