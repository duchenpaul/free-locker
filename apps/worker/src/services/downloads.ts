import type { FileMetadata } from '@free-locker/shared';

import type { AppConfig } from '../config';
import type { Env } from '../env';
import { AppError } from '../errors';
import {
  findActiveGrantFile,
  findFileByPublicId,
  reserveDownloadGrant,
  touchGrant,
  type FileRecord,
} from '../repositories/files';
import { contentDisposition, createOpaqueId, sanitizeFilename } from '../security';

export interface DownloadGrant {
  expiresAt: string;
  id: string;
  url: string;
}

interface ByteRange {
  end: number;
  length: number;
  offset: number;
}

function isAvailable(file: FileRecord, now: string): boolean {
  return (
    file.lifecycleStatus === 'active' &&
    (file.scanStatus === 'unscanned' || file.scanStatus === 'clean') &&
    file.expiresAt > now
  );
}

function toMetadata(file: FileRecord): FileMetadata {
  return {
    id: file.publicId,
    filename: file.displayFilename,
    size: file.sizeBytes,
    contentType: file.contentType,
    createdAt: file.createdAt,
    expiresAt: file.expiresAt,
    remainingDownloads: Math.max(0, file.maxDownloads - file.successfulDownloads),
    maxDownloads: file.maxDownloads,
    scanStatus: file.scanStatus,
    encryptionStatus: file.encryptionStatus,
    status: file.lifecycleStatus,
  };
}

function downloadError(file: FileRecord | null, now: string): AppError {
  if (file === null) {
    return new AppError('FILE_NOT_FOUND', 'This file is not available.', 404);
  }

  if (file.lifecycleStatus === 'revoked') {
    return new AppError('FILE_REVOKED', 'This file has been revoked.', 410);
  }

  if (file.expiresAt <= now || file.lifecycleStatus === 'expired') {
    return new AppError('FILE_EXPIRED', 'This file has expired.', 410);
  }

  if (file.successfulDownloads >= file.maxDownloads || file.lifecycleStatus === 'exhausted') {
    return new AppError('DOWNLOAD_LIMIT_REACHED', 'This file has reached its download limit.', 410);
  }

  return new AppError('FILE_NOT_FOUND', 'This file is not available.', 404);
}

function parseRange(header: string | undefined, size: number): ByteRange | undefined {
  if (header === undefined) {
    return undefined;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === '' && match[2] === '')) {
    throw new AppError('BAD_REQUEST', 'The requested byte range is invalid.', 416);
  }

  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  const offset =
    startText === ''
      ? Math.max(0, size - Number.parseInt(endText, 10))
      : Number.parseInt(startText, 10);
  const end = endText === '' ? size - 1 : Number.parseInt(endText, 10);

  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(end) ||
    offset < 0 ||
    end < offset ||
    offset >= size
  ) {
    throw new AppError('BAD_REQUEST', 'The requested byte range is invalid.', 416);
  }

  const boundedEnd = Math.min(end, size - 1);
  return { end: boundedEnd, length: boundedEnd - offset + 1, offset };
}

function validateFilename(file: FileRecord, filename: string): void {
  if (sanitizeFilename(filename) !== file.displayFilename) {
    throw new AppError('FILE_NOT_FOUND', 'This file is not available.', 404);
  }
}

export async function getFileMetadata(env: Env, publicId: string): Promise<FileMetadata> {
  const file = await findFileByPublicId(env, publicId);
  const now = new Date().toISOString();

  if (file === null || !isAvailable(file, now)) {
    throw downloadError(file, now);
  }

  return toMetadata(file);
}

export async function createDownloadGrant(
  env: Env,
  config: AppConfig,
  publicId: string,
  filename: string,
): Promise<DownloadGrant> {
  const now = new Date().toISOString();
  const file = await findFileByPublicId(env, publicId);

  if (file === null || !isAvailable(file, now)) {
    throw downloadError(file, now);
  }
  validateFilename(file, filename);

  const id = createOpaqueId(24);
  const expiresAt = new Date(Date.now() + config.downloadGrantTtlSeconds * 1000).toISOString();
  const reserved = await reserveDownloadGrant(env, {
    grantExpiresAt: expiresAt,
    grantId: id,
    now,
    publicId,
  });

  if (!reserved) {
    throw downloadError(await findFileByPublicId(env, publicId), new Date().toISOString());
  }

  return {
    id,
    expiresAt,
    url: `${config.baseUrl}/download/${id}/${encodeURIComponent(file.displayFilename)}`,
  };
}

export async function serveDownloadGrant(
  env: Env,
  grantId: string,
  filename: string,
  rangeHeader: string | undefined,
): Promise<Response> {
  const now = new Date().toISOString();
  const file = await findActiveGrantFile(env, grantId, now);
  if (file === null) {
    throw new AppError('DOWNLOAD_GRANT_EXPIRED', 'This download link is no longer available.', 410);
  }
  validateFilename(file, filename);

  const requestedRange = parseRange(rangeHeader, file.sizeBytes);
  const object = await env.FILES_BUCKET.get(
    file.objectKey,
    requestedRange === undefined
      ? undefined
      : {
          range: {
            offset: requestedRange.offset,
            length: requestedRange.length,
          },
        },
  );

  if (object === null) {
    throw new AppError('FILE_NOT_FOUND', 'This file is not available.', 404);
  }

  await touchGrant(env, file.grantId, now);

  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store, private',
    'Content-Disposition': contentDisposition(file.displayFilename),
    'Content-Length': String(requestedRange?.length ?? file.sizeBytes),
    'Content-Type': 'application/octet-stream',
    'Cross-Origin-Resource-Policy': 'same-site',
    'X-Content-Type-Options': 'nosniff',
  });

  if (requestedRange !== undefined) {
    headers.set(
      'Content-Range',
      `bytes ${requestedRange.offset}-${requestedRange.end}/${file.sizeBytes}`,
    );
  }

  return new Response(object.body, {
    headers,
    status: requestedRange === undefined ? 200 : 206,
  });
}
