import type {
  FileListingMode,
  PublicFileListingItem,
  PublicFileListingResponse,
} from '@free-locker/shared';

import type { AppConfig } from '../config';
import type { Env } from '../env';
import { AppError } from '../errors';
import { listPublicFiles } from '../repositories/files';

function downloadUrl(baseUrl: string, publicId: string, filename: string): string {
  return `${baseUrl}/${publicId}/${encodeURIComponent(filename)}`;
}

export function assertFileListingAvailable(mode: FileListingMode): void {
  if (mode === 'disabled') {
    throw new AppError('FILE_NOT_FOUND', 'The requested resource was not found.', 404);
  }
}

export async function getPublicFileListing(
  env: Env,
  config: AppConfig,
): Promise<PublicFileListingResponse> {
  assertFileListingAvailable(config.fileListingMode);
  const files = await listPublicFiles(env, new Date().toISOString(), config.fileListingMaxRows);

  return {
    success: true,
    mode: config.fileListingMode,
    files: files.map<PublicFileListingItem>((file) => ({
      downloadCount: file.successfulDownloads,
      downloadUrl: downloadUrl(config.baseUrl, file.publicId, file.displayFilename),
      filename: file.displayFilename,
      id: file.publicId,
      size: file.sizeBytes,
      uploadedAt: file.createdAt,
      uploadIp: file.uploadIp,
    })),
  };
}
