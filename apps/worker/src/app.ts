import {
  isJsonResponseRequested,
  multipartPartRequestSchema,
  uploadIntentSchema,
  type UploadSuccess,
} from '@free-locker/shared';
import { Hono } from 'hono';

import { getConfig } from './config';
import type { Env } from './env';
import { AppError, isAppError } from './errors';
import { createDownloadGrant, getFileMetadata, serveDownloadGrant } from './services/downloads';
import {
  abortMultipartSession,
  completeMultipartSession,
  createMultipartPartUrl,
  createMultipartSession,
  uploadMultipartPart,
} from './services/multipart';
import { assertFileListingAvailable, getPublicFileListing } from './services/file-listing';
import { revokeFile, submitAbuseReport } from './services/operations';
import { enforceUploadRateLimit } from './services/rate-limit';
import { uploadRawFile } from './services/uploads';
import { createOpaqueId, filenameFromContentDisposition, parseContentLength } from './security';

export interface AppEnvironment {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
}

function errorResponse(error: AppError, requestId: string, wantsJson: boolean): Response {
  if (wantsJson) {
    return Response.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
      { status: error.status },
    );
  }

  return new Response(`${error.message}\n`, { status: error.status });
}

function responseWantsJson(request: Request): boolean {
  return (
    new URL(request.url).pathname.startsWith('/api/') ||
    isJsonResponseRequested(request.headers.get('accept'))
  );
}

function responseForUpload(result: UploadSuccess, request: Request): Response {
  if (isJsonResponseRequested(request.headers.get('accept'))) {
    return Response.json(result, { status: 201 });
  }

  const unit = result.size === 1 ? 'byte' : 'bytes';
  const body = [
    '',
    '=========================',
    '',
    `Uploaded 1 file, ${result.size} ${unit}`,
    '',
    `wget ${result.downloadUrl}`,
    '',
    '=========================',
    '',
  ].join('\n');

  return new Response(body, {
    status: 201,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function responseForHelp(env: Env): Response {
  const config = getConfig(env);
  const baseUrl = config.baseUrl;
  const formatByteLimit = (bytes: number): string => {
    const gibibyte = 1024 * 1024 * 1024;
    const mebibyte = 1024 * 1024;

    if (bytes >= gibibyte && bytes % gibibyte === 0) {
      return `${bytes / gibibyte} GiB`;
    }

    return `${Math.floor(bytes / mebibyte)} MiB`;
  };
  const retention = config.retentionHours === 1 ? '1 hour' : `${config.retentionHours} hours`;
  const downloads =
    config.maxDownloads === 1 ? '1 download' : `up to ${config.maxDownloads} downloads`;
  const divider = '=====================================================================';
  const body = [
    divider,
    ` free-locker  -  share files straight from the command line`,
    divider,
    '',
    'UPLOAD',
    `  curl ${baseUrl} -T ./file.zip`,
    `  curl ${baseUrl} --upload-file ./file.zip      # same thing`,
    `  curl ${baseUrl}/name.zip --data-binary @./file.zip`,
    '',
    '  The reply is a ready-to-run download command.',
    '',
    'DOWNLOAD',
    `  wget ${baseUrl}/XXXXX/file.zip`,
    `  curl -L -O ${baseUrl}/XXXXX/file.zip`,
    '',
    'COMING FROM transfer.sh?',
    '  Your muscle memory still works - the classic upload flag is',
    '  supported as-is. Just point it here:',
    '',
    `  curl ${baseUrl} --upload-file ./file.zip`,
    '',
    'LIMITS',
    `  Max size     ${formatByteLimit(config.maxMultipartUploadBytes)} per multipart upload`,
    `  Direct       ${formatByteLimit(config.maxSingleUploadBytes)} through a single Worker request`,
    '  Large files  multipart upload when R2 signing is configured',
    `  Kept for     ${retention}  Downloads    ${downloads}, then the link is gone`,
    '  Encrypted    detected encrypted ZIP archives are limited to a single download',
    '  Malware      default deployments do not claim malware scanning',
    '',
    'SHELL SHORTCUT',
    `  alias free-locker='curl ${baseUrl} -T'`,
    '  free-locker ./file.zip',
    '',
    'ABUSE / TAKEDOWN',
    `  ${baseUrl}/#/abuse      terms: ${baseUrl}/#/disclaimer`,
    divider,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Cache-Control': 'no-store, private',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

async function handleRawUpload(
  request: Request,
  env: Env,
  suppliedFilename: string | undefined,
): Promise<Response> {
  if (request.body === null) {
    throw new AppError('BAD_REQUEST', 'An upload body is required.', 400);
  }

  const config = getConfig(env);
  await enforceUploadRateLimit(env, config, request.headers.get('cf-connecting-ip') ?? undefined);
  const result = await uploadRawFile(env, config, {
    body: request.body,
    contentLength: parseContentLength(request.headers.get('content-length') ?? undefined),
    contentType: request.headers.get('content-type') ?? undefined,
    filename:
      suppliedFilename ??
      filenameFromContentDisposition(request.headers.get('content-disposition') ?? undefined),
    uploadIp: request.headers.get('cf-connecting-ip') ?? null,
  });

  return responseForUpload(result, request);
}

export function createApp(): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();

  app.use('*', async (context, next) => {
    const requestId = context.req.header('cf-ray') ?? createOpaqueId(12);
    context.set('requestId', requestId);
    await next();
    context.header('Referrer-Policy', 'no-referrer');
    context.header('X-Content-Type-Options', 'nosniff');
    context.header('X-Frame-Options', 'DENY');
  });

  app.onError((error, context) => {
    const appError = isAppError(error)
      ? error
      : new AppError('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
    if (!isAppError(error)) {
      console.error({
        event: 'unhandled_request_error',
        message: error instanceof Error ? error.message : 'unknown error',
        requestId: context.get('requestId'),
      });
    }
    return errorResponse(appError, context.get('requestId'), responseWantsJson(context.req.raw));
  });

  app.get('/healthz', (context) =>
    context.json({
      success: true,
      service: 'free-locker',
    }),
  );
  app.get('/help', (context) => responseForHelp(context.env));

  app.put('/', async (context) => handleRawUpload(context.req.raw, context.env, undefined));
  app.put('/files', async (context) => handleRawUpload(context.req.raw, context.env, undefined));
  app.put('/files/:filename', async (context) =>
    handleRawUpload(context.req.raw, context.env, context.req.param('filename')),
  );
  app.put('/:filename', async (context) =>
    handleRawUpload(context.req.raw, context.env, context.req.param('filename')),
  );
  app.post('/api/v1/uploads', async (context) => {
    const contentType = context.req.header('content-type') ?? '';
    if (contentType.startsWith('application/json')) {
      const intent = uploadIntentSchema.safeParse(await context.req.json());
      if (!intent.success) {
        throw new AppError('VALIDATION_ERROR', 'The upload intent is invalid.', 400);
      }
      const config = getConfig(context.env);
      await enforceUploadRateLimit(
        context.env,
        config,
        context.req.header('cf-connecting-ip') ?? undefined,
      );
      return context.json(
        await createMultipartSession(
          context.env,
          config,
          intent.data,
          context.req.header('cf-connecting-ip') ?? null,
        ),
        201,
      );
    }

    return handleRawUpload(context.req.raw, context.env, undefined);
  });
  app.post('/api/v1/uploads/:id/multipart/parts/:partNumber', async (context) => {
    const partNumber = Number.parseInt(context.req.param('partNumber'), 10);
    const part = multipartPartRequestSchema.safeParse(await context.req.json());
    if (!Number.isSafeInteger(partNumber) || !part.success) {
      throw new AppError('VALIDATION_ERROR', 'The multipart part request is invalid.', 400);
    }

    return context.json(
      await createMultipartPartUrl(
        context.env,
        getConfig(context.env),
        context.req.param('id'),
        context.req.header('x-upload-capability') ?? undefined,
        partNumber,
        part.data.size,
      ),
    );
  });
  app.put('/api/v1/uploads/:id/multipart/parts/:partNumber/content', async (context) => {
    const partNumber = Number.parseInt(context.req.param('partNumber'), 10);
    if (!Number.isSafeInteger(partNumber) || context.req.raw.body === null) {
      throw new AppError('VALIDATION_ERROR', 'The multipart part upload is invalid.', 400);
    }

    const part = await uploadMultipartPart(
      context.env,
      getConfig(context.env),
      context.req.param('id'),
      context.req.header('x-upload-capability') ?? undefined,
      partNumber,
      parseContentLength(context.req.header('content-length') ?? undefined),
      context.req.raw.body,
    );
    return new Response(null, { headers: { ETag: part.etag }, status: 204 });
  });
  app.post('/api/v1/uploads/:id/multipart/complete', async (context) =>
    context.json(
      await completeMultipartSession(
        context.env,
        getConfig(context.env),
        context.req.param('id'),
        context.req.header('x-upload-capability') ?? undefined,
        await context.req.json(),
      ),
    ),
  );
  app.post('/api/v1/uploads/:id/multipart/abort', async (context) => {
    await abortMultipartSession(
      context.env,
      context.req.param('id'),
      context.req.header('x-upload-capability') ?? undefined,
    );
    return new Response(null, { status: 204 });
  });
  app.post('/files', async (context) => handleRawUpload(context.req.raw, context.env, undefined));
  app.post('/files/:filename', async (context) =>
    handleRawUpload(context.req.raw, context.env, context.req.param('filename')),
  );
  app.post('/:filename', async (context) =>
    handleRawUpload(context.req.raw, context.env, context.req.param('filename')),
  );

  app.get('/api/v1/files/:id', async (context) => {
    const file = await getFileMetadata(context.env, context.req.param('id'));
    return context.json({ success: true, file });
  });
  app.get('/api/v1/config', (context) => {
    const config = getConfig(context.env);
    return context.json({
      success: true,
      fileListingMode: config.fileListingMode,
      runtimeMode: config.runtimeMode,
      maxMultipartUploadBytes: config.maxMultipartUploadBytes,
      maxSingleUploadBytes: config.maxSingleUploadBytes,
      retentionHours: config.retentionHours,
      maxDownloads: config.maxDownloads,
    });
  });
  app.get('/api/v1/file_browser', async (context) =>
    context.json(await getPublicFileListing(context.env, getConfig(context.env))),
  );
  app.post('/api/v1/reports', async (context) =>
    context.json(
      { success: true, ...(await submitAbuseReport(context.env, await context.req.json())) },
      201,
    ),
  );
  app.post('/api/v1/admin/files/:id/revoke', async (context) => {
    await revokeFile(
      context.env,
      context.req.param('id'),
      context.req.header('authorization') ?? undefined,
      await context.req.json(),
    );
    return context.json({ success: true });
  });

  app.get('/download/:grant/:filename', async (context) =>
    serveDownloadGrant(
      context.env,
      context.req.param('grant'),
      context.req.param('filename'),
      context.req.header('range') ?? undefined,
    ),
  );

  app.get('/file_browser', async (context) => {
    const config = getConfig(context.env);
    assertFileListingAvailable(config.fileListingMode);
    if (isJsonResponseRequested(context.req.header('accept') ?? null)) {
      return context.json(await getPublicFileListing(context.env, config));
    }
    return context.redirect('/#/file_browser', 302);
  });

  app.get('/:id/:filename', async (context) => {
    if (context.req.method === 'HEAD') {
      const file = await getFileMetadata(context.env, context.req.param('id'));
      if (file.filename !== context.req.param('filename')) {
        throw new AppError('FILE_NOT_FOUND', 'This file is not available.', 404);
      }

      return new Response(null, {
        headers: {
          'Cache-Control': 'no-store, private',
          'Content-Length': String(file.size),
          'Content-Type': 'application/octet-stream',
        },
      });
    }

    const grant = await createDownloadGrant(
      context.env,
      getConfig(context.env),
      context.req.param('id'),
      context.req.param('filename'),
    );
    return context.redirect(grant.url, 302);
  });

  app.notFound((context) => {
    const request = context.req.raw;
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      !new URL(request.url).pathname.startsWith('/api/')
    ) {
      return context.env.ASSETS.fetch(request);
    }

    const wantsJson = responseWantsJson(context.req.raw);
    return errorResponse(
      new AppError('FILE_NOT_FOUND', 'The requested resource was not found.', 404),
      context.get('requestId'),
      wantsJson,
    );
  });

  return app;
}
