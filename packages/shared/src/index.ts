import { z } from 'zod';

export const API_PREFIX = '/api/v1';

export const DEFAULT_RETENTION_HOURS = 24;
export const DEFAULT_MAX_DOWNLOADS = 5;
export const DEFAULT_ENCRYPTED_ARCHIVE_MAX_DOWNLOADS = 1;
export const DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES = 95 * 1024 * 1024;
export const DEFAULT_MAX_MULTIPART_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
export const DEFAULT_MULTIPART_PART_SIZE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_DOWNLOAD_GRANT_TTL_SECONDS = 10 * 60;

export const errorCodeSchema = z.enum([
  'BAD_REQUEST',
  'FILE_EXPIRED',
  'FILE_NOT_FOUND',
  'FILE_REVOKED',
  'DOWNLOAD_LIMIT_REACHED',
  'DOWNLOAD_GRANT_EXPIRED',
  'INVALID_FILENAME',
  'INVALID_UPLOAD_STATE',
  'MALWARE_REJECTED',
  'MULTIPART_UNAVAILABLE',
  'RATE_LIMITED',
  'STORAGE_QUOTA_REACHED',
  'UNAUTHORIZED',
  'UNSUPPORTED_MEDIA_TYPE',
  'UPLOAD_INCOMPLETE',
  'UPLOAD_TOO_LARGE',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const scanStatusSchema = z.enum(['unscanned', 'pending', 'clean', 'malicious', 'failed']);
export const encryptionStatusSchema = z.enum(['unknown', 'not_encrypted', 'encrypted']);
export const fileLifecycleStatusSchema = z.enum([
  'uploading',
  'pending_scan',
  'active',
  'revoked',
  'expired',
  'exhausted',
  'cleanup_pending',
  'deleted',
  'failed',
]);

export const fileListingModeSchema = z.enum(['enabled', 'hidden', 'disabled']);
export type FileListingMode = z.infer<typeof fileListingModeSchema>;

export const runtimeModeSchema = z.enum(['local', 'cloudflare']);
export type RuntimeMode = z.infer<typeof runtimeModeSchema>;

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const fileMetadataSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  contentType: z.string().min(1).max(255),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  remainingDownloads: z.number().int().nonnegative(),
  maxDownloads: z.number().int().positive(),
  scanStatus: scanStatusSchema,
  encryptionStatus: encryptionStatusSchema,
  status: fileLifecycleStatusSchema,
});

export type FileMetadata = z.infer<typeof fileMetadataSchema>;

export const uploadSuccessSchema = z.object({
  success: z.literal(true),
  id: z.string().min(1),
  filename: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  downloadUrl: z.string().url(),
  expiresAt: isoDateTimeSchema,
  remainingDownloads: z.number().int().nonnegative(),
  scanStatus: scanStatusSchema,
});

export type UploadSuccess = z.infer<typeof uploadSuccessSchema>;

export const fileMetadataResponseSchema = z.object({
  success: z.literal(true),
  file: fileMetadataSchema,
});

export type FileMetadataResponse = z.infer<typeof fileMetadataResponseSchema>;

export const publicFileListingItemSchema = z.object({
  downloadCount: z.number().int().nonnegative(),
  downloadUrl: z.string().url(),
  filename: z.string().min(1).max(255),
  id: z.string().min(1),
  size: z.number().int().nonnegative(),
  uploadedAt: isoDateTimeSchema,
  uploadIp: z.string().nullable(),
});

export const publicFileListingResponseSchema = z.object({
  files: z.array(publicFileListingItemSchema),
  mode: fileListingModeSchema,
  success: z.literal(true),
});

export type PublicFileListingItem = z.infer<typeof publicFileListingItemSchema>;
export type PublicFileListingResponse = z.infer<typeof publicFileListingResponseSchema>;

export const publicAppConfigSchema = z.object({
  fileListingMode: fileListingModeSchema,
  runtimeMode: runtimeModeSchema,
  maxMultipartUploadBytes: z.number().int().positive(),
  maxSingleUploadBytes: z.number().int().positive(),
  retentionHours: z.number().int().positive(),
  maxDownloads: z.number().int().positive(),
  success: z.literal(true),
});

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;

export const uploadIntentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative(),
  contentType: z.string().trim().min(1).max(255).optional(),
});

export type UploadIntent = z.infer<typeof uploadIntentSchema>;

export const uploadSessionSchema = z.object({
  success: z.literal(true),
  uploadId: z.string().min(1),
  capability: z.string().min(1),
  uploadUrl: z.string().url().optional(),
  mode: z.enum(['single', 'multipart']),
  expiresAt: isoDateTimeSchema,
  partSize: z.number().int().positive().optional(),
});

export type UploadSession = z.infer<typeof uploadSessionSchema>;

export const multipartPartRequestSchema = z.object({
  size: z.number().int().positive(),
});

export const multipartPartResponseSchema = z.object({
  success: z.literal(true),
  partNumber: z.number().int().positive(),
  mode: z.enum(['direct', 'presigned']),
  uploadUrl: z.string().min(1),
  contentType: z.string().min(1),
  expiresAt: isoDateTimeSchema,
});

export const multipartPartSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1).max(512),
});

export const completeMultipartUploadSchema = z.object({
  parts: z.array(multipartPartSchema).min(1).max(10_000),
});

export type CompleteMultipartUpload = z.infer<typeof completeMultipartUploadSchema>;

export const abuseReportSchema = z.object({
  fileId: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(10).max(2_000),
  contact: z.string().trim().email().max(320).optional(),
});

export type AbuseReport = z.infer<typeof abuseReportSchema>;

export const revokeFileSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

export type RevokeFile = z.infer<typeof revokeFileSchema>;

export function isJsonResponseRequested(acceptHeader: string | null): boolean {
  return acceptHeader?.toLowerCase().includes('application/json') ?? false;
}
