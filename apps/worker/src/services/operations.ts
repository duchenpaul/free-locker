import { abuseReportSchema, revokeFileSchema } from '@free-locker/shared';

import type { Env } from '../env';
import { AppError } from '../errors';
import { constantTimeEquals, createOpaqueId } from '../security';

export async function submitAbuseReport(env: Env, input: unknown): Promise<{ reportId: string }> {
  const parsed = abuseReportSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'The abuse report is invalid.', 400);
  }

  const reportId = createOpaqueId(18);
  await env.DB.prepare(
    `INSERT INTO abuse_reports (id, public_file_id, reporter_contact, reason, submitted_at, moderation_status)
     VALUES (?, ?, ?, ?, ?, 'open')`,
  )
    .bind(
      reportId,
      parsed.data.fileId,
      parsed.data.contact ?? null,
      parsed.data.reason,
      new Date().toISOString(),
    )
    .run();

  return { reportId };
}

export async function revokeFile(
  env: Env,
  publicId: string,
  authorization: string | undefined,
  input: unknown,
): Promise<void> {
  const expectedToken = env.ADMIN_TOKEN;
  const suppliedToken = authorization?.replace(/^Bearer\s+/i, '');
  if (
    expectedToken === undefined ||
    suppliedToken === undefined ||
    !constantTimeEquals(suppliedToken, expectedToken)
  ) {
    throw new AppError('UNAUTHORIZED', 'An operator authorization token is required.', 401);
  }

  const parsed = revokeFileSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'The revocation request is invalid.', 400);
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE files
     SET lifecycle_status = 'revoked', revoked_at = ?, revoked_reason = ?, updated_at = ?
     WHERE public_id = ? AND lifecycle_status NOT IN ('deleted', 'cleanup_pending')`,
  )
    .bind(now, parsed.data.reason ?? 'Operator revocation', now, publicId)
    .run();

  if (result.meta.changes !== 1) {
    throw new AppError('FILE_NOT_FOUND', 'This file is not available.', 404);
  }
}
