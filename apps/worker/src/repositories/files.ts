import type { EncryptionStatus, FileLifecycleStatus, ScanStatus } from './types';

import type { Env } from '../env';

export interface FileRecord {
  contentType: string;
  createdAt: string;
  displayFilename: string;
  encryptionStatus: EncryptionStatus;
  expiresAt: string;
  id: string;
  lifecycleStatus: FileLifecycleStatus;
  maxDownloads: number;
  objectKey: string;
  originalFilename: string;
  publicId: string;
  scanStatus: ScanStatus;
  sizeBytes: number;
  successfulDownloads: number;
  uploadIp: string | null;
}

export interface NewFileRecord {
  contentType: string;
  createdAt: string;
  displayFilename: string;
  encryptionStatus: EncryptionStatus;
  expiresAt: string;
  id: string;
  maxDownloads: number;
  objectKey: string;
  originalFilename: string;
  publicId: string;
  scanStatus: ScanStatus;
  uploadIp?: string | null;
}

interface FileRow {
  content_type: string;
  created_at: string;
  display_filename: string;
  encryption_status: EncryptionStatus;
  expires_at: string;
  id: string;
  lifecycle_status: FileLifecycleStatus;
  max_downloads: number;
  object_key: string;
  original_filename: string;
  public_id: string;
  scan_status: ScanStatus;
  size_bytes: number;
  successful_downloads: number;
  upload_ip?: string | null;
}

export interface DownloadGrantFile extends FileRecord {
  grantExpiresAt: string;
  grantId: string;
}

export interface PublicFileListingRecord {
  createdAt: string;
  displayFilename: string;
  publicId: string;
  sizeBytes: number;
  successfulDownloads: number;
  uploadIp: string | null;
}

interface PublicFileListingRow {
  created_at: string;
  display_filename: string;
  public_id: string;
  size_bytes: number;
  successful_downloads: number;
  upload_ip: string | null;
}

interface DownloadGrantFileRow extends FileRow {
  grant_expires_at: string;
  grant_id: string;
}

function mapFile(row: FileRow): FileRecord {
  return {
    contentType: row.content_type,
    createdAt: row.created_at,
    displayFilename: row.display_filename,
    encryptionStatus: row.encryption_status,
    expiresAt: row.expires_at,
    id: row.id,
    lifecycleStatus: row.lifecycle_status,
    maxDownloads: row.max_downloads,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    publicId: row.public_id,
    scanStatus: row.scan_status,
    sizeBytes: row.size_bytes,
    successfulDownloads: row.successful_downloads,
    uploadIp: row.upload_ip ?? null,
  };
}

export async function insertUploadingFile(env: Env, file: NewFileRecord): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO files (
      id, public_id, object_key, original_filename, display_filename, content_type,
      size_bytes, created_at, expires_at, max_downloads, encryption_status, upload_ip,
      scan_status, lifecycle_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'uploading', ?)`,
  )
    .bind(
      file.id,
      file.publicId,
      file.objectKey,
      file.originalFilename,
      file.displayFilename,
      file.contentType,
      file.createdAt,
      file.expiresAt,
      file.maxDownloads,
      file.encryptionStatus,
      file.uploadIp ?? null,
      file.scanStatus,
      file.createdAt,
    )
    .run();
}

export async function activateFile(
  env: Env,
  id: string,
  sizeBytes: number,
  encryptionStatus: EncryptionStatus,
  maxDownloads: number,
  updatedAt: string,
): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE files
     SET size_bytes = ?, encryption_status = ?, max_downloads = ?, lifecycle_status = 'active', updated_at = ?
     WHERE id = ? AND lifecycle_status = 'uploading'`,
  )
    .bind(sizeBytes, encryptionStatus, maxDownloads, updatedAt, id)
    .run();

  if (result.meta.changes !== 1) {
    throw new Error('Upload lifecycle state changed before activation.');
  }
}

export async function markFileFailed(env: Env, id: string, updatedAt: string): Promise<void> {
  await env.DB.prepare(`UPDATE files SET lifecycle_status = 'failed', updated_at = ? WHERE id = ?`)
    .bind(updatedAt, id)
    .run();
}

export async function findFileByPublicId(env: Env, publicId: string): Promise<FileRecord | null> {
  const row = await env.DB.prepare(
    `SELECT id, public_id, object_key, original_filename, display_filename, content_type,
            size_bytes, created_at, expires_at, max_downloads, successful_downloads,
            encryption_status, scan_status, lifecycle_status
     FROM files WHERE public_id = ?`,
  )
    .bind(publicId)
    .first<FileRow>();

  return row === null ? null : mapFile(row);
}

export async function listPublicFiles(
  env: Env,
  now: string,
  limit: number,
): Promise<PublicFileListingRecord[]> {
  const rows = await env.DB.prepare(
    `SELECT public_id, display_filename, created_at, upload_ip, size_bytes, successful_downloads
     FROM files
     WHERE lifecycle_status = 'active'
       AND scan_status IN ('unscanned', 'clean')
       AND expires_at > ?
       AND revoked_at IS NULL
       AND successful_downloads < max_downloads
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(now, limit)
    .all<PublicFileListingRow>();

  return rows.results.map((row) => ({
    createdAt: row.created_at,
    displayFilename: row.display_filename,
    publicId: row.public_id,
    sizeBytes: row.size_bytes,
    successfulDownloads: row.successful_downloads,
    uploadIp: row.upload_ip,
  }));
}

export async function reserveDownloadGrant(
  env: Env,
  input: {
    grantExpiresAt: string;
    grantId: string;
    now: string;
    publicId: string;
    requestIpHash?: string;
  },
): Promise<boolean> {
  const insertGrant = env.DB.prepare(
    `INSERT INTO download_grants (id, file_id, created_at, expires_at, status, request_ip_hash)
       SELECT ?, id, ?, ?, 'active', ?
       FROM files
       WHERE public_id = ?
         AND lifecycle_status = 'active'
         AND scan_status IN ('unscanned', 'clean')
         AND expires_at > ?
         AND revoked_at IS NULL
         AND successful_downloads < max_downloads`,
  ).bind(
    input.grantId,
    input.now,
    input.grantExpiresAt,
    input.requestIpHash ?? null,
    input.publicId,
    input.now,
  );
  const incrementDownload = env.DB.prepare(
    `UPDATE files
       SET successful_downloads = successful_downloads + 1, updated_at = ?
       WHERE public_id = ?
         AND lifecycle_status = 'active'
         AND scan_status IN ('unscanned', 'clean')
         AND expires_at > ?
         AND revoked_at IS NULL
         AND successful_downloads < max_downloads
         AND EXISTS (
           SELECT 1 FROM download_grants
           WHERE id = ? AND file_id = files.id AND status = 'active'
         )`,
  ).bind(input.now, input.publicId, input.now, input.grantId);
  const results = await env.DB.batch([insertGrant, incrementDownload]);

  return results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1;
}

export async function findActiveGrantFile(
  env: Env,
  grantId: string,
  now: string,
): Promise<DownloadGrantFile | null> {
  const row = await env.DB.prepare(
    `SELECT
       g.id AS grant_id,
       g.expires_at AS grant_expires_at,
       f.id, f.public_id, f.object_key, f.original_filename, f.display_filename,
       f.content_type, f.size_bytes, f.created_at, f.expires_at, f.max_downloads,
       f.successful_downloads, f.encryption_status, f.scan_status, f.lifecycle_status
     FROM download_grants g
     JOIN files f ON f.id = g.file_id
     WHERE g.id = ?
       AND g.status = 'active'
       AND g.expires_at > ?
       AND f.lifecycle_status = 'active'
       AND f.scan_status IN ('unscanned', 'clean')
       AND f.expires_at > ?
       AND f.revoked_at IS NULL`,
  )
    .bind(grantId, now, now)
    .first<DownloadGrantFileRow>();

  if (row === null) {
    return null;
  }

  return {
    ...mapFile(row),
    grantExpiresAt: row.grant_expires_at,
    grantId: row.grant_id,
  };
}

export async function touchGrant(env: Env, grantId: string, now: string): Promise<void> {
  await env.DB.prepare(`UPDATE download_grants SET last_used_at = ? WHERE id = ?`)
    .bind(now, grantId)
    .run();
}
