import { AppError } from './errors';
import type { EncryptionStatus } from './repositories/types';

const unsafeFilenameCharacters = /[\\/]/g;

function removeControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })
    .join('');
}

export function createOpaqueId(byteLength = 18): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let binary = '';

  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function constantTimeEquals(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export function sanitizeFilename(value: string | undefined): string {
  const fallback = 'upload.bin';
  if (value === undefined || value.length === 0) {
    return fallback;
  }

  const filename = removeControlCharacters(value.normalize('NFC'))
    .replace(unsafeFilenameCharacters, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');

  return filename.length === 0 ? fallback : filename.slice(0, 180);
}

export function filenameFromContentDisposition(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8Match?.[1] !== undefined) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return undefined;
    }
  }

  const quotedMatch = /filename="([^"]+)"/i.exec(value);
  if (quotedMatch?.[1] !== undefined) {
    return quotedMatch[1];
  }

  const unquotedMatch = /filename=([^;\s]+)/i.exec(value);
  return unquotedMatch?.[1];
}

export function contentDisposition(filename: string): string {
  const asciiFilename = filename
    .replace(/["\\]/g, '_')
    .replace(/[^\x20-\x7e]/g, '_')
    .slice(0, 180);
  const encodedFilename = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

export function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function enforceContentLength(contentLength: number | undefined, maxBytes: number): void {
  if (contentLength !== undefined && contentLength > maxBytes) {
    throw new AppError('UPLOAD_TOO_LARGE', 'The upload exceeds the configured size limit.', 413);
  }
}

export function limitReadableStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  onChunk?: (chunk: Uint8Array) => void,
): { bytesRead: () => number; stream: ReadableStream<Uint8Array> } {
  let bytesRead = 0;
  const limit = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesRead += chunk.byteLength;
      if (bytesRead > maxBytes) {
        throw new AppError(
          'UPLOAD_TOO_LARGE',
          'The upload exceeds the configured size limit.',
          413,
        );
      }
      onChunk?.(chunk);
      controller.enqueue(chunk);
    },
  });

  return {
    bytesRead: () => bytesRead,
    stream: body.pipeThrough(limit),
  };
}

export function createArchiveInspector(): {
  inspect: (chunk: Uint8Array) => void;
  status: () => EncryptionStatus;
} {
  const header = new Uint8Array(8);
  let bytesRead = 0;

  return {
    inspect(chunk) {
      const available = Math.min(header.length - bytesRead, chunk.length);
      if (available > 0) {
        header.set(chunk.subarray(0, available), bytesRead);
        bytesRead += available;
      }
    },
    status() {
      if (bytesRead < 8 || header[0] !== 0x50 || header[1] !== 0x4b) {
        return 'unknown';
      }

      const isLocalZipHeader = header[2] === 0x03 && header[3] === 0x04;
      if (!isLocalZipHeader) {
        return 'unknown';
      }

      const generalPurposeBitFlag = (header[6] ?? 0) | ((header[7] ?? 0) << 8);
      return (generalPurposeBitFlag & 0x0001) === 0x0001 ? 'encrypted' : 'not_encrypted';
    },
  };
}
