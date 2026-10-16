import type { UploadSuccess } from '@free-locker/shared';

import type { AppConfig } from '../config';
import type { Env } from '../env';
import { AppError, isAppError } from '../errors';
import { activateFile, insertUploadingFile, markFileFailed } from '../repositories/files';
import {
  createArchiveInspector,
  createOpaqueId,
  enforceContentLength,
  limitReadableStream,
  sanitizeFilename,
} from '../security';

export interface RawUploadInput {
  body: ReadableStream<Uint8Array>;
  contentLength?: number | undefined;
  contentType?: string | undefined;
  filename?: string | undefined;
  uploadIp?: string | null | undefined;
}

function normalizedContentType(value: string | undefined): string {
  const contentType = value?.split(';', 1)[0]?.trim();
  return contentType === undefined || contentType.length === 0
    ? 'application/octet-stream'
    : contentType;
}

function buildDownloadUrl(baseUrl: string, publicId: string, filename: string): string {
  return `${baseUrl}/${publicId}/${encodeURIComponent(filename)}`;
}

export async function uploadRawFile(
  env: Env,
  config: AppConfig,
  input: RawUploadInput,
): Promise<UploadSuccess> {
  enforceContentLength(input.contentLength, config.maxSingleUploadBytes);
  if (input.contentLength === undefined) {
    throw new AppError('BAD_REQUEST', 'Content-Length is required for an upload.', 411);
  }

  const id = createOpaqueId(18);
  const publicId = createOpaqueId(18);
  const displayFilename = sanitizeFilename(input.filename);
  const objectKey = `files/${id}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + config.retentionHours * 60 * 60 * 1000).toISOString();
  const contentType = normalizedContentType(input.contentType);

  await insertUploadingFile(env, {
    contentType,
    createdAt: now,
    displayFilename,
    encryptionStatus: 'unknown',
    expiresAt,
    id,
    maxDownloads: config.maxDownloads,
    objectKey,
    originalFilename: displayFilename,
    publicId,
    scanStatus: 'unscanned',
    uploadIp: input.uploadIp ?? null,
  });

  const archiveInspector = createArchiveInspector();
  const limitedBody = limitReadableStream(
    input.body,
    config.maxSingleUploadBytes,
    archiveInspector.inspect,
  );
  const fixedLengthStream = new FixedLengthStream(input.contentLength);
  let maxDownloads = config.maxDownloads;

  try {
    await Promise.all([
      limitedBody.stream.pipeTo(fixedLengthStream.writable),
      env.FILES_BUCKET.put(objectKey, fixedLengthStream.readable, {
        httpMetadata: {
          contentType: 'application/octet-stream',
        },
      }),
    ]);
    const encryptionStatus = archiveInspector.status();
    maxDownloads = encryptionStatus === 'encrypted' ? 1 : config.maxDownloads;
    await activateFile(
      env,
      id,
      limitedBody.bytesRead(),
      encryptionStatus,
      maxDownloads,
      new Date().toISOString(),
    );
  } catch (error) {
    await Promise.allSettled([
      env.FILES_BUCKET.delete(objectKey),
      markFileFailed(env, id, new Date().toISOString()),
    ]);

    if (isAppError(error)) {
      throw error;
    }

    console.error({
      event: 'upload_storage_failed',
      message: error instanceof Error ? error.message : 'unknown error',
    });

    throw new AppError('INTERNAL_ERROR', 'The upload could not be stored.', 500);
  }

  return {
    success: true,
    id: publicId,
    filename: displayFilename,
    size: limitedBody.bytesRead(),
    downloadUrl: buildDownloadUrl(config.baseUrl, publicId, displayFilename),
    expiresAt,
    remainingDownloads: maxDownloads,
    scanStatus: 'unscanned',
  };
}
