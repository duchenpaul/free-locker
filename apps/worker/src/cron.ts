import type { Env } from './env';

interface CleanupFileRow {
  id: string;
  object_key: string;
}

interface ExpiredSessionRow {
  id: string;
  object_key: string;
  r2_multipart_upload_id: string;
}

const cleanupBatchSize = 10;

export async function runCleanup(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const expiredSessions = await env.DB.prepare(
    `SELECT s.id, f.object_key, s.r2_multipart_upload_id
     FROM upload_sessions s JOIN files f ON f.id = s.file_id
     WHERE s.status IN ('created', 'uploading')
       AND s.expires_at <= ?
       AND s.r2_multipart_upload_id IS NOT NULL
     LIMIT ?`,
  )
    .bind(now, cleanupBatchSize)
    .all<ExpiredSessionRow>();

  for (const session of expiredSessions.results) {
    try {
      await env.FILES_BUCKET.resumeMultipartUpload(
        session.object_key,
        session.r2_multipart_upload_id,
      ).abort();
      await env.DB.batch([
        env.DB.prepare(`UPDATE upload_sessions SET status = 'expired' WHERE id = ?`).bind(
          session.id,
        ),
        env.DB.prepare(
          `UPDATE files SET lifecycle_status = 'failed', updated_at = ?
             WHERE id = (SELECT file_id FROM upload_sessions WHERE id = ?)`,
        ).bind(now, session.id),
      ]);
    } catch {
      // A later bounded cleanup pass retries a failed R2 abort.
    }
  }

  const files = await env.DB.prepare(
    `SELECT id, object_key FROM files
     WHERE deleted_at IS NULL
       AND (
         expires_at <= ? OR successful_downloads >= max_downloads OR
         lifecycle_status IN ('revoked', 'failed', 'expired', 'exhausted')
       )
     LIMIT ?`,
  )
    .bind(now, cleanupBatchSize)
    .all<CleanupFileRow>();

  for (const file of files.results) {
    const claim = await env.DB.prepare(
      `UPDATE files SET lifecycle_status = 'cleanup_pending', updated_at = ?
       WHERE id = ? AND deleted_at IS NULL AND lifecycle_status != 'cleanup_pending'`,
    )
      .bind(now, file.id)
      .run();
    if (claim.meta.changes !== 1) {
      continue;
    }

    try {
      await env.FILES_BUCKET.delete(file.object_key);
      await env.DB.prepare(
        `UPDATE files
         SET lifecycle_status = 'deleted', deleted_at = ?, upload_ip = NULL, cleanup_last_error = NULL
         WHERE id = ?`,
      )
        .bind(new Date().toISOString(), file.id)
        .run();
    } catch {
      await env.DB.prepare(
        `UPDATE files
         SET lifecycle_status = 'failed', cleanup_attempts = cleanup_attempts + 1,
             cleanup_last_error = 'R2 deletion failed', cleanup_retry_at = ?
         WHERE id = ?`,
      )
        .bind(new Date(Date.now() + 15 * 60 * 1000).toISOString(), file.id)
        .run();
    }
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE download_grants SET status = 'expired' WHERE status = 'active' AND expires_at <= ?`,
    ).bind(now),
    env.DB.prepare(`DELETE FROM rate_limit_windows WHERE window_expires_at <= ?`).bind(now),
  ]);
}
