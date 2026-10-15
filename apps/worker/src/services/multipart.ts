import { AwsClient } from 'aws4fetch';
import {
  completeMultipartUploadSchema,
  type UploadIntent,
  type UploadSession,
  type UploadSuccess,
} from '@free-locker/shared';

import type { AppConfig } from '../config';
import type { Env } from '../env';
import { AppError } from '../errors';
import {
  abortMultipartUploadSession,
  completeMultipartUploadSession,
  findMultipartUploadSession,
  insertMultipartUploadSession,
  insertUploadingFile,
  markFileFailed,
} from '../repositories/files';
import {
  createArchiveInspector,
  createOpaqueId,
  sanitizeFilename,
  sha256Base64Url,
} from '../security';

const minimumMultipartPartBytes = 5 * 1024 * 1024;
const maximumMultipartParts = 10_000;
const multipartSessionLifetimeMilliseconds = 60 * 60 * 1000;
const multipartUrlLifetimeSeconds = 5 * 60;

interface MultipartCredentials {
  accountId: string;
  accessKeyId: string;
  bucketName: string;
  secretAccessKey: string;
}

interface MultipartSessionAccess {
  capabilityHash: string;
  session: NonNullable<Awaited<ReturnType<typeof findMultipartUploadSession>>>;
}

function normalizedContentType(value: string | undefined): string {
  const contentType = value?.split(';', 1)[0]?.trim();
  return contentType === undefined || contentType.length === 0
    ? 'application/octet-stream'
    : contentType;
}

function getMultipartCredentials(env: Env): MultipartCredentials {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucketName = env.R2_BUCKET_NAME;

  if (
    accountId === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    bucketName === undefined
  ) {
    throw new AppError(
      'MULTIPART_UNAVAILABLE',
      'Large-file uploads are not configured on this deployment.',
      503,
    );
  }

  return { accountId, accessKeyId, bucketName, secretAccessKey };
}

function assertPartSize(config: AppConfig): void {
  if (config.multipartPartSizeBytes < minimumMultipartPartBytes) {
    throw new AppError(
      'MULTIPART_UNAVAILABLE',
      'The multipart upload configuration is invalid.',
      503,
    );
  }
}

function expectedPartSize(totalSize: number, partSize: number, partNumber: number): number {
  const partCount = Math.ceil(totalSize / partSize);
  if (partNumber < 1 || partNumber > partCount) {
    throw new AppError('VALIDATION_ERROR', 'The requested part number is invalid.', 400);
  }

  if (partNumber === partCount) {
    return totalSize - partSize * (partCount - 1);
  }

  return partSize;
}

function buildDownloadUrl(baseUrl: string, publicId: string, filename: string): string {
  return `${baseUrl}/${publicId}/${encodeURIComponent(filename)}`;
}

async function getSessionAccess(
  env: Env,
  sessionId: string,
  capability: string | undefined,
): Promise<MultipartSessionAccess> {
  if (capability === undefined || capability.length < 24) {
    throw new AppError('UNAUTHORIZED', 'An upload capability is required.', 401);
  }

  const capabilityHash = await sha256Base64Url(capability);
  const session = await findMultipartUploadSession(
    env,
    sessionId,
    capabilityHash,
    new Date().toISOString(),
  );
  if (session === null) {
    throw new AppError(
      'UPLOAD_INCOMPLETE',
      'This upload session is unavailable or has expired.',
      410,
    );
  }

  return { capabilityHash, session };
}

function makeUploadSuccess(
  config: AppConfig,
  input: {
    expiresAt: string;
    filename: string;
    publicId: string;
    size: number;
  },
): UploadSuccess {
  return {
    success: true,
    id: input.publicId,
    filename: input.filename,
    size: input.size,
    downloadUrl: buildDownloadUrl(config.baseUrl, input.publicId, input.filename),
    expiresAt: input.expiresAt,
    remainingDownloads: config.maxDownloads,
    scanStatus: 'unscanned',
  };
}

export async function createMultipartSession(
  env: Env,
  config: AppConfig,
  intent: UploadIntent,
  uploadIp: string | null,
): Promise<UploadSession> {
  if (config.runtimeMode === 'cloudflare') {
    getMultipartCredentials(env);
  }
  assertPartSize(config);

  if (intent.size <= config.maxSingleUploadBytes) {
    throw new AppError(
      'BAD_REQUEST',
      'Use the direct upload endpoint for files within the single-upload limit.',
      400,
    );
  }

  if (intent.size > config.maxMultipartUploadBytes) {
    throw new AppError(
      'UPLOAD_TOO_LARGE',
      'The upload exceeds the configured multipart size limit.',
      413,
    );
  }

  if (Math.ceil(intent.size / config.multipartPartSizeBytes) > maximumMultipartParts) {
    throw new AppError(
      'UPLOAD_TOO_LARGE',
      'The upload would exceed the maximum multipart part count.',
      413,
    );
  }

  const id = createOpaqueId(18);
  const publicId = createOpaqueId(18);
  const sessionId = createOpaqueId(24);
  const capability = createOpaqueId(32);
  const displayFilename = sanitizeFilename(intent.filename);
  const objectKey = `files/${id}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + config.retentionHours * 60 * 60 * 1000).toISOString();
  const sessionExpiresAt = new Date(
    Date.now() + multipartSessionLifetimeMilliseconds,
  ).toISOString();
  const contentType = normalizedContentType(intent.contentType);

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
    uploadIp,
  });

  let multipartUpload: R2MultipartUpload | undefined;
  try {
    multipartUpload = await env.FILES_BUCKET.createMultipartUpload(objectKey, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
    await insertMultipartUploadSession(env, {
      capabilityHash: await sha256Base64Url(capability),
      createdAt: now,
      expiresAt: sessionExpiresAt,
      fileId: id,
      multipartUploadId: multipartUpload.uploadId,
      sessionId,
      sizeBytes: intent.size,
    });
  } catch {
    if (multipartUpload !== undefined) {
      await multipartUpload.abort().catch(() => undefined);
    }
    await markFileFailed(env, id, new Date().toISOString());
    throw new AppError('INTERNAL_ERROR', 'The multipart upload could not be initialized.', 500);
  }

  return {
    success: true,
    uploadId: sessionId,
    capability,
    mode: 'multipart',
    expiresAt: sessionExpiresAt,
    partSize: config.multipartPartSizeBytes,
  };
}

export async function createMultipartPartUrl(
  env: Env,
  config: AppConfig,
  sessionId: string,
  capability: string | undefined,
  partNumber: number,
  requestedSize: number,
): Promise<{
  contentType: string;
  expiresAt: string;
  mode: 'direct' | 'presigned';
  partNumber: number;
  uploadUrl: string;
}> {
  assertPartSize(config);
  const { session } = await getSessionAccess(env, sessionId, capability);
  const expectedSize = expectedPartSize(
    session.expectedSizeBytes,
    config.multipartPartSizeBytes,
    partNumber,
  );

  if (requestedSize !== expectedSize) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The requested part size does not match the upload plan.',
      400,
    );
  }

  if (config.runtimeMode === 'local') {
    return {
      contentType: session.contentType,
      expiresAt: session.sessionExpiresAt,
      mode: 'direct',
      partNumber,
      uploadUrl: `/api/v1/uploads/${sessionId}/multipart/parts/${partNumber}/content`,
    };
  }

  const credentials = getMultipartCredentials(env);

  const endpoint = new URL(
    `https://${credentials.accountId}.r2.cloudflarestorage.com/${credentials.bucketName}/${session.objectKey}`,
  );
  endpoint.searchParams.set('partNumber', String(partNumber));
  endpoint.searchParams.set('uploadId', session.multipartUploadId);
  endpoint.searchParams.set('X-Amz-Expires', String(multipartUrlLifetimeSeconds));

  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
  });
  const signed = await client.sign(
    new Request(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': session.contentType },
    }),
    { aws: { signQuery: true } },
  );

  return {
    contentType: session.contentType,
    expiresAt: new Date(Date.now() + multipartUrlLifetimeSeconds * 1000).toISOString(),
    mode: 'presigned',
    partNumber,
    uploadUrl: signed.url,
  };
}

export async function uploadMultipartPart(
  env: Env,
  config: AppConfig,
  sessionId: string,
  capability: string | undefined,
  partNumber: number,
  contentLength: number | undefined,
  body: ReadableStream<Uint8Array>,
): Promise<R2UploadedPart> {
  if (config.runtimeMode !== 'local') {
    throw new AppError('FILE_NOT_FOUND', 'The requested resource was not found.', 404);
  }

  assertPartSize(config);
  const { session } = await getSessionAccess(env, sessionId, capability);
  const expectedSize = expectedPartSize(
    session.expectedSizeBytes,
    config.multipartPartSizeBytes,
    partNumber,
  );
  if (contentLength !== expectedSize) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The multipart part size does not match the upload plan.',
      400,
    );
  }

  const stream = new FixedLengthStream(contentLength);
  const upload = env.FILES_BUCKET.resumeMultipartUpload(
    session.objectKey,
    session.multipartUploadId,
  );
  const [part] = await Promise.all([
    upload.uploadPart(partNumber, stream.readable),
    body.pipeTo(stream.writable),
  ]);

  return part;
}

export async function completeMultipartSession(
  env: Env,
  config: AppConfig,
  sessionId: string,
  capability: string | undefined,
  body: unknown,
): Promise<UploadSuccess> {
  const parsed = completeMultipartUploadSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'The multipart completion payload is invalid.', 400);
  }

  const { session } = await getSessionAccess(env, sessionId, capability);
  const expectedPartCount = Math.ceil(session.expectedSizeBytes / config.multipartPartSizeBytes);
  const orderedParts = [...parsed.data.parts].sort(
    (left, right) => left.partNumber - right.partNumber,
  );

  if (
    orderedParts.length !== expectedPartCount ||
    orderedParts.some((part, index) => part.partNumber !== index + 1)
  ) {
    throw new AppError('VALIDATION_ERROR', 'The multipart completion list is incomplete.', 400);
  }

  const upload = env.FILES_BUCKET.resumeMultipartUpload(
    session.objectKey,
    session.multipartUploadId,
  );
  try {
    await upload.complete(orderedParts);
    const object = await env.FILES_BUCKET.head(session.objectKey);
    if (object === null || object.size !== session.expectedSizeBytes) {
      await upload.abort().catch(() => undefined);
      throw new AppError(
        'UPLOAD_INCOMPLETE',
        'The uploaded object size could not be verified.',
        400,
      );
    }
    const firstBytes = await env.FILES_BUCKET.get(session.objectKey, {
      range: { length: 8, offset: 0 },
    });
    const archiveInspector = createArchiveInspector();
    if (firstBytes !== null) {
      archiveInspector.inspect(new Uint8Array(await firstBytes.arrayBuffer()));
    }
    const encryptionStatus = archiveInspector.status();
    await completeMultipartUploadSession(
      env,
      session.sessionId,
      object.size,
      encryptionStatus,
      encryptionStatus === 'encrypted' ? 1 : config.maxDownloads,
      new Date().toISOString(),
    );
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('UPLOAD_INCOMPLETE', 'The multipart upload could not be completed.', 400);
  }

  return makeUploadSuccess(config, {
    expiresAt: session.expiresAt,
    filename: session.displayFilename,
    publicId: session.publicId,
    size: session.expectedSizeBytes,
  });
}

export async function abortMultipartSession(
  env: Env,
  sessionId: string,
  capability: string | undefined,
): Promise<void> {
  const { session } = await getSessionAccess(env, sessionId, capability);
  const upload = env.FILES_BUCKET.resumeMultipartUpload(
    session.objectKey,
    session.multipartUploadId,
  );

  try {
    await upload.abort();
  } finally {
    await abortMultipartUploadSession(env, session.sessionId, new Date().toISOString());
  }
}
