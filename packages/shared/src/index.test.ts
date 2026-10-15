import { describe, expect, it } from 'vitest';

import { isJsonResponseRequested, uploadSuccessSchema } from './index';

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
});
