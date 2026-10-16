import { describe, expect, it } from 'vitest';

import { isJsonResponseRequested, publicAppConfigSchema, uploadSuccessSchema } from './index';

describe('shared API contracts', () => {
  it('recognizes JSON response negotiation', () => {
    expect(isJsonResponseRequested('application/json')).toBe(true);
    expect(isJsonResponseRequested('text/plain, application/json;q=0.9')).toBe(true);
    expect(isJsonResponseRequested('text/plain')).toBe(false);
    expect(isJsonResponseRequested(null)).toBe(false);
  });

  it('requires the stable upload success fields', () => {
    expect(
      uploadSuccessSchema.safeParse({
        success: true,
        id: 'opaque-id',
        filename: 'release.zip',
        size: 1024,
        downloadUrl: 'https://locker.example/opaque-id/release.zip',
        expiresAt: '2026-10-16T12:00:00.000Z',
        remainingDownloads: 5,
        scanStatus: 'unscanned',
      }).success,
    ).toBe(true);
    expect(
      uploadSuccessSchema.safeParse({
        success: true,
        id: 'opaque-id',
      }).success,
    ).toBe(false);
  });

  it('requires the public limit fields on the app configuration', () => {
    const payload = {
      success: true,
      fileListingMode: 'disabled',
      runtimeMode: 'local',
      maxMultipartUploadBytes: 10737418240,
      maxSingleUploadBytes: 99614720,
      retentionHours: 24,
      maxDownloads: 5,
    };
    expect(publicAppConfigSchema.safeParse(payload).success).toBe(true);
    expect(publicAppConfigSchema.safeParse({ ...payload, maxDownloads: undefined }).success).toBe(
      false,
    );
  });
});
