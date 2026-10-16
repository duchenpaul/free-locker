#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES,
  errorEnvelopeSchema,
  uploadSuccessSchema,
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
    `Each file must be at most ${DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES / (1024 * 1024)} MiB. Larger files are rejected with 413 Payload Too Large.`,
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

  if (fileInfo.size > DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES) {
    throw new CliError(
      `The file exceeds the ${DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES / (1024 * 1024)} MiB upload limit.`,
    );
  }

  const result = await uploadDirect(options, fileInfo.size);
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
