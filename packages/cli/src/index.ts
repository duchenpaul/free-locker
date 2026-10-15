#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES,
  errorEnvelopeSchema,
  multipartPartResponseSchema,
  uploadSessionSchema,
  uploadSuccessSchema,
  type CompleteMultipartUpload,
  type UploadSuccess,
} from '@free-locker/shared';

interface CliOptions {
  baseUrl: string;
  filePath: string;
  json: boolean;
}

class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

function usage(): string {
  return [
    'Usage: free-locker <file> [--url https://locker.example] [--json]',
    '',
    'Files up to 95 MiB use the simple PUT endpoint. Larger files use the multipart API.',
  ].join('\n');
}

export function parseArguments(argumentsList: string[]): CliOptions {
  let baseUrl = process.env.FREE_LOCKER_URL ?? 'http://localhost:8787';
  let filePath: string | undefined;
  let json = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--url') {
      const nextValue = argumentsList[index + 1];
      if (nextValue === undefined) {
        throw new CliError('--url requires a value.');
      }
      baseUrl = nextValue;
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      throw new CliError(usage(), 0);
    }
    if (argument?.startsWith('-') ?? false) {
      throw new CliError(`Unknown option: ${argument}`);
    }
    if (filePath !== undefined) {
      throw new CliError('Upload one file at a time.');
    }
    filePath = argument;
  }

  if (filePath === undefined) {
    throw new CliError(usage());
  }

  let normalizedBaseUrl: string;
  try {
    normalizedBaseUrl = new URL(baseUrl).toString().replace(/\/$/, '');
  } catch {
    throw new CliError('The upload URL must be an absolute HTTP URL.');
  }

  return { baseUrl: normalizedBaseUrl, filePath, json };
}

async function parseResponseError(response: Response): Promise<CliError> {
  const text = await response.text();
  try {
    const parsed = errorEnvelopeSchema.safeParse(JSON.parse(text));
    if (parsed.success) {
      return new CliError(`${parsed.data.error.code}: ${parsed.data.error.message}`);
    }
  } catch {
    // Fall through to a stable generic error without printing potentially sensitive response data.
  }

  return new CliError(`The server rejected the request with HTTP ${response.status}.`);
}

async function parseSuccess(response: Response): Promise<UploadSuccess> {
  if (!response.ok) {
    throw await parseResponseError(response);
  }

  const parsed = uploadSuccessSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new CliError('The server returned an invalid upload response.');
  }

  return parsed.data;
}

function requestInitWithStream(stream: Readable, size: number, filename: string): RequestInit {
  return {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(size),
      'Content-Type': 'application/octet-stream',
    },
    body: Readable.toWeb(stream) as unknown as BodyInit,
    duplex: 'half',
  } as RequestInit;
}

async function uploadDirect(options: CliOptions, size: number): Promise<UploadSuccess> {
  const filename = path.basename(options.filePath);
  const response = await fetch(
    `${options.baseUrl}/`,
    requestInitWithStream(createReadStream(options.filePath), size, filename),
  );
  return parseSuccess(response);
}

async function requestMultipartSession(options: CliOptions, size: number) {
  const response = await fetch(`${options.baseUrl}/api/v1/uploads`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: path.basename(options.filePath),
      size,
      contentType: 'application/octet-stream',
    }),
  });
  if (!response.ok) {
    throw await parseResponseError(response);
  }

  const session = uploadSessionSchema.safeParse(await response.json());
  if (
    !session.success ||
    session.data.mode !== 'multipart' ||
    session.data.partSize === undefined
  ) {
    throw new CliError('The server returned an invalid multipart upload session.');
  }

  return session.data;
}

async function requestPartUrl(
  options: CliOptions,
  uploadId: string,
  capability: string,
  partNumber: number,
  size: number,
) {
  const response = await fetch(
    `${options.baseUrl}/api/v1/uploads/${uploadId}/multipart/parts/${partNumber}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Upload-Capability': capability,
      },
      body: JSON.stringify({ size }),
    },
  );
  if (!response.ok) {
    throw await parseResponseError(response);
  }

  const part = multipartPartResponseSchema.safeParse(await response.json());
  if (!part.success) {
    throw new CliError('The server returned an invalid signed part URL.');
  }

  return part.data;
}

async function abortMultipart(
  options: CliOptions,
  uploadId: string,
  capability: string,
): Promise<void> {
  await fetch(`${options.baseUrl}/api/v1/uploads/${uploadId}/multipart/abort`, {
    method: 'POST',
    headers: { 'X-Upload-Capability': capability },
  }).catch(() => undefined);
}

async function uploadMultipart(options: CliOptions, size: number): Promise<UploadSuccess> {
  const session = await requestMultipartSession(options, size);
  const partSize = session.partSize ?? DEFAULT_MULTIPART_PART_SIZE_BYTES;
  const parts: CompleteMultipartUpload['parts'] = [];
  const fileHandle = await open(options.filePath, 'r');

  try {
    let offset = 0;
    let partNumber = 1;
    while (offset < size) {
      const partLength = Math.min(partSize, size - offset);
      const buffer = Buffer.allocUnsafe(partLength);
      const readResult = await fileHandle.read(buffer, 0, partLength, offset);
      if (readResult.bytesRead !== partLength) {
        throw new CliError('The file changed while it was being uploaded.');
      }

      const authorization = await requestPartUrl(
        options,
        session.uploadId,
        session.capability,
        partNumber,
        partLength,
      );
      const partResponse = await fetch(authorization.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': authorization.contentType },
        body: buffer,
      });
      if (!partResponse.ok) {
        throw new CliError(
          `R2 rejected multipart part ${partNumber} with HTTP ${partResponse.status}.`,
        );
      }

      const etag = partResponse.headers.get('etag');
      if (etag === null) {
        throw new CliError(`R2 did not return an ETag for multipart part ${partNumber}.`);
      }
      parts.push({ partNumber, etag });
      offset += partLength;
      partNumber += 1;
      process.stderr.write(`Uploaded ${Math.min(100, Math.round((offset / size) * 100))}%\r`);
    }
  } catch (error) {
    await abortMultipart(options, session.uploadId, session.capability);
    throw error;
  } finally {
    await fileHandle.close();
  }

  process.stderr.write('Uploaded 100%\n');
  const completeResponse = await fetch(
    `${options.baseUrl}/api/v1/uploads/${session.uploadId}/multipart/complete`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Upload-Capability': session.capability,
      },
      body: JSON.stringify({ parts }),
    },
  );
  return parseSuccess(completeResponse);
}

function printSuccess(result: UploadSuccess, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write(`Download: ${result.downloadUrl}\n`);
  process.stdout.write(`Expires: ${result.expiresAt}\n`);
  process.stdout.write(`Download authorizations remaining: ${result.remainingDownloads}\n`);
}

export async function run(argumentsList: string[]): Promise<void> {
  const options = parseArguments(argumentsList);
  const fileInfo = await stat(options.filePath);
  if (!fileInfo.isFile()) {
    throw new CliError('The upload path must point to a regular file.');
  }

  const result =
    fileInfo.size <= DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES
      ? await uploadDirect(options, fileInfo.size)
      : await uploadMultipart(options, fileInfo.size);
  printSuccess(result, options.json);
}

if (import.meta.main) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    const cliError =
      error instanceof CliError ? error : new CliError('The upload failed unexpectedly.');
    process.stderr.write(`${cliError.message}\n`);
    process.exitCode = cliError.exitCode;
  });
}
