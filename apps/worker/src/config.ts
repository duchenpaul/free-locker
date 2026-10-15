import {
  fileListingModeSchema,
  runtimeModeSchema,
  type FileListingMode,
  type RuntimeMode,
} from '@free-locker/shared';

import transferDefaults from '../../../config/transfer.defaults.json';
import type { Env } from './env';

const platformSingleUploadLimitBytes = 95 * 1024 * 1024;
const maximumFileListingRows = 500;

export interface AppConfig {
  baseUrl: string;
  downloadGrantTtlSeconds: number;
  fileListingMaxRows: number;
  fileListingMode: FileListingMode;
  maxDownloads: number;
  maxMultipartUploadBytes: number;
  multipartPartSizeBytes: number;
  maxSingleUploadBytes: number;
  retentionHours: number;
  runtimeMode: RuntimeMode;
  uploadRateLimitPerHour: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedBaseUrl(value: string | undefined): string {
  const fallback = 'http://localhost:8787';

  try {
    return new URL(value ?? fallback).toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function fileListingMode(value: string | undefined): FileListingMode {
  return (
    fileListingModeSchema.safeParse(value ?? transferDefaults.fileListingMode).data ?? 'disabled'
  );
}

function runtimeMode(value: string | undefined): RuntimeMode {
  return runtimeModeSchema.safeParse(value ?? transferDefaults.runtimeMode).data ?? 'local';
}

export function getConfig(env: Env): AppConfig {
  return {
    baseUrl: normalizedBaseUrl(env.PUBLIC_BASE_URL),
    downloadGrantTtlSeconds: positiveInteger(
      env.DOWNLOAD_GRANT_TTL_SECONDS,
      transferDefaults.downloadGrantTtlSeconds,
    ),
    fileListingMaxRows: Math.min(
      positiveInteger(env.FILE_LISTING_MAX_ROWS, transferDefaults.fileListingMaxRows),
      maximumFileListingRows,
    ),
    fileListingMode: fileListingMode(env.FILE_LISTING_MODE),
    maxDownloads: positiveInteger(env.MAX_DOWNLOADS, transferDefaults.maxDownloads),
    maxMultipartUploadBytes: positiveInteger(
      env.MAX_MULTIPART_UPLOAD_BYTES,
      transferDefaults.maxMultipartUploadBytes,
    ),
    multipartPartSizeBytes: positiveInteger(
      env.MULTIPART_PART_SIZE_BYTES,
      transferDefaults.multipartPartSizeBytes,
    ),
    maxSingleUploadBytes: Math.min(
      positiveInteger(env.MAX_SINGLE_UPLOAD_BYTES, transferDefaults.maxSingleUploadBytes),
      platformSingleUploadLimitBytes,
    ),
    retentionHours: positiveInteger(env.RETENTION_HOURS, transferDefaults.retentionHours),
    runtimeMode: runtimeMode(env.RUNTIME_MODE),
    uploadRateLimitPerHour: positiveInteger(
      env.UPLOAD_RATE_LIMIT_PER_HOUR,
      transferDefaults.uploadRateLimitPerHour,
    ),
  };
}
