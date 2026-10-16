import {
  DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES,
  errorEnvelopeSchema,
  multipartPartResponseSchema,
  publicAppConfigSchema,
  publicFileListingResponseSchema,
  uploadSessionSchema,
  type CompleteMultipartUpload,
  type PublicAppConfig,
  type PublicFileListingResponse,
  type UploadSuccess,
  uploadSuccessSchema,
} from '@free-locker/shared';

interface SafeParser<T> {
  safeParse: (input: unknown) => { data: T; success: true } | { success: false };
}

export interface UploadTask {
  abort: () => void;
  promise: Promise<UploadSuccess>;
}

export class UploadRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'UploadRequestError';
  }
}

function parseError(responseText: string, status: number): UploadRequestError {
  try {
    const parsed = errorEnvelopeSchema.safeParse(JSON.parse(responseText));
    if (parsed.success) {
      return new UploadRequestError(parsed.data.error.message, status, parsed.data.error.code);
    }
  } catch {
    // Command-line compatible routes may return non-JSON errors.
  }

  return new UploadRequestError('The upload did not complete. Please try again.', status);
}

function createDirectUploadTask(file: File, onProgress: (percent: number) => void): UploadTask {
  const request = new XMLHttpRequest();
  const promise = new Promise<UploadSuccess>((resolve, reject) => {
    request.open('POST', '/api/v1/uploads');
    request.responseType = 'text';
    request.setRequestHeader('Accept', 'application/json');
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.setRequestHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => reject(new UploadRequestError('The network request failed.', 0));
    request.onabort = () => reject(new DOMException('The upload was cancelled.', 'AbortError'));
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(parseError(request.responseText, request.status));
        return;
      }

      try {
        const parsed = uploadSuccessSchema.safeParse(JSON.parse(request.responseText));
        if (!parsed.success) {
          reject(
            new UploadRequestError(
              'The server returned an invalid upload response.',
              request.status,
            ),
          );
          return;
        }
        resolve(parsed.data);
      } catch {
        reject(
          new UploadRequestError('The server returned an invalid upload response.', request.status),
        );
      }
    };
    request.send(file);
  });

  return { abort: () => request.abort(), promise };
}

async function parseJsonResponse<T>(response: Response, parser: SafeParser<T>): Promise<T> {
  if (!response.ok) {
    throw parseError(await response.text(), response.status);
  }

  const parsed = parser.safeParse(await response.json());
  if (!parsed.success) {
    throw new UploadRequestError('The server returned an invalid response.', response.status);
  }

  return parsed.data;
}

export async function fetchPublicAppConfig(): Promise<PublicAppConfig> {
  const response = await fetch('/api/v1/config', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return parseJsonResponse(response, publicAppConfigSchema);
}

export async function fetchPublicFileListing(): Promise<PublicFileListingResponse> {
  const response = await fetch('/api/v1/file_browser', {
    headers: { Accept: 'application/json' },
  });
  return parseJsonResponse(response, publicFileListingResponseSchema);
}

export async function revokePublicFile(fileId: string, operatorToken: string): Promise<void> {
  const response = await fetch(`/api/v1/admin/files/${encodeURIComponent(fileId)}/revoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${operatorToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Removed from the file browser' }),
  });

  if (!response.ok) {
    throw parseError(await response.text(), response.status);
  }
}

function putMultipartPart(
  url: string,
  contentType: string,
  mode: 'direct' | 'presigned',
  body: Blob,
  signal: AbortSignal,
  capability: string,
  onProgress: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    if (mode === 'direct') {
      request.setRequestHeader('X-Upload-Capability', capability);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    };
    request.onerror = () =>
      reject(new UploadRequestError('A multipart part could not be uploaded.', 0));
    request.onabort = () => reject(new DOMException('The upload was cancelled.', 'AbortError'));
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(
          new UploadRequestError(
            `R2 rejected a multipart part with HTTP ${request.status}.`,
            request.status,
          ),
        );
        return;
      }

      const etag = request.getResponseHeader('ETag');
      if (etag === null) {
        reject(
          new UploadRequestError('R2 did not return an ETag for a multipart part.', request.status),
        );
        return;
      }
      resolve(etag);
    };
    signal.addEventListener('abort', () => request.abort(), { once: true });
    if (signal.aborted) {
      request.abort();
      return;
    }
    request.send(body);
  });
}

function createMultipartUploadTask(file: File, onProgress: (percent: number) => void): UploadTask {
  const controller = new AbortController();
  let cleanupSession: { capability: string; uploadId: string } | undefined;

  const promise = (async () => {
    const sessionResponse = await fetch('/api/v1/uploads', {
      method: 'POST',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
      }),
    });
    const session = await parseJsonResponse(sessionResponse, uploadSessionSchema);
    if (session.mode !== 'multipart' || session.partSize === undefined) {
      throw new UploadRequestError('The server did not create a multipart upload session.', 500);
    }

    const sessionDetails = { capability: session.capability, uploadId: session.uploadId };
    cleanupSession = sessionDetails;
    const parts: CompleteMultipartUpload['parts'] = [];
    let offset = 0;
    let partNumber = 1;

    while (offset < file.size) {
      const partSize = Math.min(session.partSize, file.size - offset);
      const authorizationResponse = await fetch(
        `/api/v1/uploads/${sessionDetails.uploadId}/multipart/parts/${partNumber}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Upload-Capability': sessionDetails.capability,
          },
          body: JSON.stringify({ size: partSize }),
        },
      );
      const authorization = await parseJsonResponse(
        authorizationResponse,
        multipartPartResponseSchema,
      );
      const partStart = offset;
      const etag = await putMultipartPart(
        authorization.uploadUrl,
        authorization.contentType,
        authorization.mode,
        file.slice(partStart, partStart + partSize),
        controller.signal,
        sessionDetails.capability,
        (loaded) => onProgress(Math.round(((partStart + loaded) / file.size) * 100)),
      );
      parts.push({ partNumber, etag });
      offset += partSize;
      partNumber += 1;
      onProgress(Math.round((offset / file.size) * 100));
    }

    const completionResponse = await fetch(
      `/api/v1/uploads/${sessionDetails.uploadId}/multipart/complete`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Upload-Capability': sessionDetails.capability,
        },
        body: JSON.stringify({ parts }),
      },
    );
    const result = await parseJsonResponse(completionResponse, uploadSuccessSchema);
    cleanupSession = undefined;
    return result;
  })().catch(async (error: unknown) => {
    if (cleanupSession !== undefined) {
      await fetch(`/api/v1/uploads/${cleanupSession.uploadId}/multipart/abort`, {
        method: 'POST',
        headers: { 'X-Upload-Capability': cleanupSession.capability },
      }).catch(() => undefined);
    }
    throw error;
  });

  return { abort: () => controller.abort(), promise };
}

export function createUploadTask(
  file: File,
  singleUploadLimitBytes: number = DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES,
  onProgress: (percent: number) => void,
): UploadTask {
  return file.size > singleUploadLimitBytes
    ? createMultipartUploadTask(file, onProgress)
    : createDirectUploadTask(file, onProgress);
}
