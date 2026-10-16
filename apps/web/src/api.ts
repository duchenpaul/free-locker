import {
  DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES,
  errorEnvelopeSchema,
  publicAppConfigSchema,
  publicFileListingResponseSchema,
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

export function createUploadTask(
  file: File,
  singleUploadLimitBytes: number = DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES,
  onProgress: (percent: number) => void,
): UploadTask {
  if (file.size > singleUploadLimitBytes) {
    const promise = Promise.reject(
      new UploadRequestError(
        'The file exceeds the configured size limit.',
        413,
        'UPLOAD_TOO_LARGE',
      ),
    );
    return { abort: () => undefined, promise };
  }
  return createDirectUploadTask(file, onProgress);
}
